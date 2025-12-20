use std::{
    collections::{BTreeMap, HashMap, HashSet},
    fs,
    path::{Path, PathBuf},
};

use anyhow::{Context, Result, anyhow, bail};
use serde::Deserialize;
use serde_json::{Map as JsonMap, Value};
use serde_saphyr as serde_yaml;
use tracing::warn;

use crate::export::{Exporter, FieldPruner, RenderPass, TypeInjector};
use crate::parser::Parser;

pub mod trojan;
pub mod shadowsocks;

/// Protocol-specific hook for validation or other pre-render checks.
pub trait ProtocolModule: Send + Sync {
    fn protocol(&self) -> &'static str;

    fn validate(&self, _normalized: &JsonMap<String, Value>) -> Result<()> {
        Ok(())
    }
}

#[allow(dead_code)]
#[derive(Debug, Deserialize, Clone)]
pub struct ProtocolSchema {
    pub protocol: String,
    #[serde(default)]
    pub includes: Vec<String>,
    #[serde(default)]
    pub fields: BTreeMap<String, FieldSpec>,
    #[serde(default)]
    pub targets: BTreeMap<String, TargetSchema>,
}

#[allow(dead_code)]
#[derive(Debug, Deserialize, Clone)]
pub struct FieldSpec {
    #[serde(rename = "type")]
    pub ty: FieldType,
}

#[derive(Debug, Deserialize, Clone, Copy)]
#[serde(rename_all = "lowercase")]
pub enum FieldType {
    String,
    Integer,
    Boolean,
    List,
    Map,
}

#[allow(dead_code)]
#[derive(Debug, Deserialize, Clone)]
pub struct TargetSchema {
    #[serde(default)]
    pub template: BTreeMap<String, ValueTemplate>,
    #[serde(default)]
    pub ordered_keys: Option<Vec<String>>,
    #[serde(default, rename = "not-implemented")]
    pub not_implemented: Option<bool>,
}

#[derive(Debug, Deserialize, Clone)]
pub struct FieldRef {
    pub from: String,
    #[serde(default)]
    pub optional: bool,
    pub default: Option<Value>,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(untagged)]
pub enum ValueTemplate {
    Field(FieldRef),
    Object(BTreeMap<String, ValueTemplate>),
    Sequence(Vec<ValueTemplate>),
    Literal(Value),
}

impl ProtocolSchema {
    fn absorb(&mut self, other: &ProtocolSchema, override_existing: bool) {
        for (field_name, field) in &other.fields {
            if override_existing || !self.fields.contains_key(field_name) {
                self.fields.insert(field_name.clone(), field.clone());
            }
        }

        for (target_name, target) in &other.targets {
            match self.targets.get_mut(target_name) {
                Some(existing) => existing.absorb(target, override_existing),
                None => {
                    self.targets.insert(target_name.clone(), target.clone());
                }
            }
        }
    }

    pub fn load_from_file(path: impl AsRef<Path>) -> Result<Self> {
        let file = fs::File::open(&path)
            .with_context(|| format!("failed to open schema file {}", path.as_ref().display()))?;
        serde_yaml::from_reader(file)
            .with_context(|| format!("failed to parse schema file {}", path.as_ref().display()))
    }

    pub fn normalize(&self, values: &JsonMap<String, Value>) -> Result<JsonMap<String, Value>> {
        let mut normalized = JsonMap::new();

        for (field_name, spec) in &self.fields {
            if let Some(value) = values.get(field_name) {
                spec.validate(field_name, value)?;
                normalized.insert(field_name.clone(), value.clone());
            }
        }

        for (key, value) in values {
            normalized
                .entry(key.clone())
                .or_insert_with(|| value.clone());
        }

        Ok(normalized)
    }

    pub fn render_target(
        &self,
        target_schema: &TargetSchema,
        normalized: &JsonMap<String, Value>,
    ) -> Result<Value> {
        let mut rendered = render_object(&target_schema.template, normalized)?
            .unwrap_or_else(|| Value::Object(JsonMap::new()));

        if let Value::Object(ref mut map) = rendered {
            map.entry("type".to_string())
                .or_insert_with(|| Value::String(self.protocol.clone()));
            Ok(Value::Object(map.clone()))
        } else {
            Err(anyhow!(
                "target `{}` of `{}` must render to an object",
                target_schema
                    .template
                    .keys()
                    .next()
                    .map(|k| k.as_str())
                    .unwrap_or("<unknown>"),
                self.protocol
            ))
        }
    }

    fn validate_templates(&self) -> Result<()> {
        for (target_name, target) in &self.targets {
            validate_template_map(
                &target.template,
                &self.fields,
                &format!("target `{}` of `{}`", target_name, self.protocol),
            )?;
        }
        Ok(())
    }
}

impl FieldSpec {
    fn validate(&self, name: &str, value: &Value) -> Result<()> {
        if self.ty.matches(value) {
            Ok(())
        } else {
            Err(anyhow!(
                "field `{}` expected type {:?}, got {}",
                name,
                self.ty,
                describe_value(value)
            ))
        }
    }

    fn validate_value(&self, name: &str, value: &Value) -> Result<()> {
        self.validate(name, value)
    }
}

impl FieldType {
    fn matches(self, value: &Value) -> bool {
        match self {
            FieldType::String => value.is_string(),
            FieldType::Integer => value.as_i64().is_some() || value.as_u64().is_some(),
            FieldType::Boolean => value.is_boolean(),
            FieldType::List => value.is_array(),
            FieldType::Map => value.is_object(),
        }
    }
}

impl TargetSchema {
    fn absorb(&mut self, other: &TargetSchema, override_existing: bool) {
        if override_existing {
            if other.ordered_keys.is_some() {
                self.ordered_keys = other.ordered_keys.clone();
            }
            if other.not_implemented.is_some() {
                self.not_implemented = other.not_implemented;
            }
        } else {
            if self.ordered_keys.is_none() {
                self.ordered_keys = other.ordered_keys.clone();
            }
            if self.not_implemented.is_none() {
                self.not_implemented = other.not_implemented;
            }
        }

        for (key, value) in &other.template {
            if override_existing || !self.template.contains_key(key) {
                self.template.insert(key.clone(), value.clone());
            }
        }
    }
}

fn render_object(
    template: &BTreeMap<String, ValueTemplate>,
    ctx: &JsonMap<String, Value>,
) -> Result<Option<Value>> {
    let mut out = JsonMap::new();

    for (key, tmpl) in template {
        if let Some(rendered) = render_template(tmpl, ctx)? {
            out.insert(key.clone(), rendered);
        }
    }

    Ok(Some(Value::Object(out)))
}

fn render_sequence(items: &[ValueTemplate], ctx: &JsonMap<String, Value>) -> Result<Option<Value>> {
    let mut rendered_items = Vec::new();

    for item in items {
        if let Some(rendered) = render_template(item, ctx)? {
            rendered_items.push(rendered);
        }
    }

    if rendered_items.is_empty() {
        return Ok(None);
    }

    Ok(Some(Value::Array(rendered_items)))
}

fn render_template(
    template: &ValueTemplate,
    ctx: &JsonMap<String, Value>,
) -> Result<Option<Value>> {
    match template {
        ValueTemplate::Literal(value) => Ok(Some(value.clone())),
        ValueTemplate::Field(field) => {
            let value = ctx.get(&field.from).cloned();
            match value {
                Some(val) => {
                    if field
                        .default
                        .as_ref()
                        .map_or(false, |default| &val == default)
                    {
                        return Ok(None);
                    }
                    Ok(Some(val))
                }
                None => {
                    if field.default.is_some() {
                        return Ok(None);
                    }
                    if field.optional {
                        Ok(None)
                    } else {
                        Err(anyhow!("missing required field `{}`", field.from))
                    }
                }
            }
        }
        ValueTemplate::Object(map) => render_object(map, ctx),
        ValueTemplate::Sequence(items) => render_sequence(items, ctx),
    }
}

fn validate_template_map(
    map: &BTreeMap<String, ValueTemplate>,
    fields: &BTreeMap<String, FieldSpec>,
    ctx: &str,
) -> Result<()> {
    for (_, tmpl) in map {
        validate_template(tmpl, fields, ctx)?;
    }
    Ok(())
}

fn validate_template(
    template: &ValueTemplate,
    fields: &BTreeMap<String, FieldSpec>,
    ctx: &str,
) -> Result<()> {
    match template {
        ValueTemplate::Field(field) => {
            let spec = fields
                .get(&field.from)
                .ok_or_else(|| anyhow!("{ctx} references unknown field `{}`", field.from))?;
            if let Some(default) = &field.default {
                spec.validate_value(&field.from, default)?;
            }
            Ok(())
        }
        ValueTemplate::Object(map) => validate_template_map(map, fields, ctx),
        ValueTemplate::Sequence(items) => {
            for item in items {
                validate_template(item, fields, ctx)?;
            }
            Ok(())
        }
        ValueTemplate::Literal(_) => Ok(()),
    }
}

fn describe_value(value: &Value) -> &'static str {
    if value.is_null() {
        "null"
    } else if value.is_boolean() {
        "boolean"
    } else if value.is_i64() || value.is_u64() || value.is_f64() {
        "number"
    } else if value.is_string() {
        "string"
    } else if value.is_array() {
        "list"
    } else if value.is_object() {
        "map"
    } else {
        "unknown"
    }
}

pub struct SchemaRegistry {
    protocols: HashMap<String, ProtocolSchema>,
    modules: HashMap<String, Box<dyn ProtocolModule>>,
    exporters: HashMap<String, Box<dyn Exporter>>,
    default_exporters: HashMap<String, Box<dyn Exporter>>,
    parsers: HashMap<String, Box<dyn Parser>>,
    prologues: Vec<Box<dyn RenderPass>>,
}

impl SchemaRegistry {
    pub fn load_from_dir(path: impl AsRef<Path>) -> Result<Self> {
        let dir = path.as_ref();
        let raw_protocols = load_protocol_files(dir)?;
        let protocols = resolve_protocols(raw_protocols)?;

        Ok(Self {
            protocols,
            modules: HashMap::new(),
            exporters: HashMap::new(),
            default_exporters: HashMap::new(),
            parsers: HashMap::new(),
            prologues: Vec::new(),
        })
    }

    pub fn with_builtin(path: impl AsRef<Path>) -> Result<Self> {
        let mut registry = Self::load_from_dir(path)?;
        registry.register_builtin_modules();
        registry.register_builtin_default_exporters();
        registry.register_builtin_parsers();
        registry.register_builtin_prologues();
        Ok(registry)
    }

    pub fn register_module(&mut self, module: Box<dyn ProtocolModule>) {
        self.modules.insert(module.protocol().to_string(), module);
    }

    #[allow(dead_code)]
    pub fn register_exporter(&mut self, exporter: Box<dyn Exporter>) {
        self.exporters
            .insert(exporter.target().to_string(), exporter);
    }

    pub fn register_default_exporter(&mut self, exporter: Box<dyn Exporter>) {
        self.default_exporters
            .insert(exporter.target().to_string(), exporter);
    }

    pub fn register_parser(&mut self, parser: Box<dyn Parser>) {
        self.parsers.insert(parser.target().to_string(), parser);
    }

    pub fn register_prologue(&mut self, pass: Box<dyn RenderPass>) {
        self.prologues.push(pass);
    }

    fn register_builtin_modules(&mut self) {
        let available: Vec<String> = self.protocols.keys().cloned().collect();
        if available.iter().any(|p| p == "trojan") {
            self.register_module(Box::new(trojan::TrojanModule));
        }
        if available.iter().any(|p| p == "shadowsocks") {
            self.register_module(Box::new(shadowsocks::ShadowsocksModule));
        }
    }

    fn register_builtin_default_exporters(&mut self) {
        self.register_default_exporter(Box::new(crate::export::clash::ClashExporter));
        self.register_default_exporter(Box::new(crate::export::surge::SurgeExporter));
    }

    fn register_builtin_parsers(&mut self) {
        self.register_parser(Box::new(crate::parser::clash::ClashParser));
    }

    fn register_builtin_prologues(&mut self) {
        self.register_prologue(Box::new(FieldPruner));
        self.register_prologue(Box::new(TypeInjector));
    }

    pub fn get(&self, protocol: &str) -> Option<&ProtocolSchema> {
        self.protocols.get(protocol)
    }

    pub fn target_not_implemented(&self, protocol: &str, target: &str) -> bool {
        self.protocols
            .get(protocol)
            .and_then(|schema| schema.targets.get(target))
            .and_then(|schema| schema.not_implemented)
            .unwrap_or(false)
    }

    fn module(&self, protocol: &str) -> Option<&dyn ProtocolModule> {
        self.modules.get(protocol).map(|m| m.as_ref())
    }

    fn exporter(&self, target: &str) -> Option<&dyn Exporter> {
        self.exporters.get(target).map(|e| e.as_ref())
    }

    fn default_exporter(&self, target: &str) -> Option<&dyn Exporter> {
        self.default_exporters.get(target).map(|e| e.as_ref())
    }

    #[allow(dead_code)]
    fn parser(&self, target: &str) -> Option<&dyn Parser> {
        self.parsers.get(target).map(|p| p.as_ref())
    }

    pub fn convert(
        &self,
        protocol: &str,
        target: &str,
        values: &JsonMap<String, Value>,
    ) -> Result<Value> {
        let schema = self
            .get(protocol)
            .with_context(|| format!("protocol `{}` is not registered", protocol))?;
        let target_schema = schema.targets.get(target).with_context(|| {
            format!(
                "protocol `{}` does not support target `{target}`",
                schema.protocol
            )
        })?;
        if target_schema.not_implemented.unwrap_or(false) {
            return Err(anyhow!(
                "protocol `{}` target `{target}` is not implemented",
                schema.protocol
            ));
        }

        let normalized = schema.normalize(values)?;
        let module = self.module(protocol);
        if let Some(module) = module {
            module.validate(&normalized)?;
        }

        let mut rendered = schema.render_target(target_schema, &normalized)?;

        for pass in &self.prologues {
            rendered = pass.render(protocol, target_schema, &normalized, rendered)?;
        }

        if let Some(exporter) = self.exporter(target) {
            exporter.render(protocol, target_schema, &normalized, rendered)
        } else if let Some(exporter) = self.default_exporter(target) {
            exporter.render(protocol, target_schema, &normalized, rendered)
        } else {
            Ok(rendered)
        }
    }

    #[allow(dead_code)]
    pub fn parse(&self, target: &str, input: &str) -> Result<Value> {
        let parser = self
            .parser(target)
            .with_context(|| format!("parser for target `{target}` is not registered"))?;
        parser.parse(input)
    }
}

fn load_protocol_files(dir: &Path) -> Result<HashMap<String, ProtocolSchema>> {
    let mut protocols = HashMap::new();
    let mut protocol_paths: HashMap<String, PathBuf> = HashMap::new();

    let mut stack = vec![dir.to_path_buf()];
    while let Some(current) = stack.pop() {
        for entry in fs::read_dir(&current)
            .with_context(|| format!("failed to read schema directory {}", current.display()))?
        {
            let entry = entry?;
            let path = entry.path();
            if path.is_dir() {
                stack.push(path);
                continue;
            }
            if path.extension().and_then(|s| s.to_str()) != Some("yaml") {
                continue;
            }

            let schema = ProtocolSchema::load_from_file(&path)?;
            if let Some(existing) = protocol_paths.get(&schema.protocol) {
                warn!(
                    protocol = %schema.protocol,
                    path = %path.display(),
                    existing = %existing.display(),
                    "duplicate protocol schema ignored"
                );
                continue;
            }
            protocol_paths.insert(schema.protocol.clone(), path.clone());
            protocols.insert(schema.protocol.clone(), schema);
        }
    }

    if protocols.is_empty() {
        return Err(anyhow!("no protocol schemas found under {}", dir.display()));
    }

    Ok(protocols)
}

fn resolve_protocols(
    raw: HashMap<String, ProtocolSchema>,
) -> Result<HashMap<String, ProtocolSchema>> {
    let mut resolved = HashMap::new();
    let mut resolving = HashSet::new();

    let names: Vec<String> = raw.keys().cloned().collect();
    for name in names {
        resolve_protocol(&name, &raw, &mut resolving, &mut resolved)?;
    }

    Ok(resolved)
}

fn resolve_protocol(
    name: &str,
    raw: &HashMap<String, ProtocolSchema>,
    resolving: &mut HashSet<String>,
    cache: &mut HashMap<String, ProtocolSchema>,
) -> Result<ProtocolSchema> {
    if let Some(resolved) = cache.get(name) {
        return Ok(resolved.clone());
    }

    if !resolving.insert(name.to_string()) {
        bail!("circular include detected for protocol `{}`", name);
    }

    let schema = raw
        .get(name)
        .with_context(|| format!("protocol `{}` referenced but not found", name))?;

    let mut combined = ProtocolSchema {
        protocol: schema.protocol.clone(),
        includes: Vec::new(),
        fields: BTreeMap::new(),
        targets: BTreeMap::new(),
    };

    for include in &schema.includes {
        let parent = resolve_protocol(include, raw, resolving, cache)?;
        combined.absorb(&parent, false);
    }

    combined.absorb(schema, true);
    combined.includes.clear();
    combined.validate_templates()?;
    resolving.remove(name);
    cache.insert(name.to_string(), combined.clone());
    Ok(combined)
}
