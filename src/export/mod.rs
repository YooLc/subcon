use std::collections::HashSet;

use anyhow::Result;
use serde_json::{Map as JsonMap, Value};

use crate::schema::TargetSchema;

pub mod clash;
pub mod surge;

pub trait RenderPass: Send + Sync {
    fn render(
        &self,
        protocol: &str,
        target_schema: &TargetSchema,
        normalized: &JsonMap<String, Value>,
        rendered: Value,
    ) -> Result<Value>;
}

pub trait Exporter: Send + Sync {
    fn target(&self) -> &'static str;

    fn render(
        &self,
        protocol: &str,
        target_schema: &TargetSchema,
        normalized: &JsonMap<String, Value>,
        rendered: Value,
    ) -> Result<Value>;
}

pub struct TypeInjector;

impl RenderPass for TypeInjector {
    fn render(
        &self,
        protocol: &str,
        _target_schema: &TargetSchema,
        _normalized: &JsonMap<String, Value>,
        rendered: Value,
    ) -> Result<Value> {
        let mut map = rendered
            .as_object()
            .cloned()
            .ok_or_else(|| anyhow::anyhow!("rendered target must be an object"))?;
        map.entry("type".to_string())
            .or_insert_with(|| Value::String(protocol.to_string()));
        Ok(Value::Object(map))
    }
}

pub struct FieldPruner;

impl RenderPass for FieldPruner {
    fn render(
        &self,
        _protocol: &str,
        target_schema: &TargetSchema,
        normalized: &JsonMap<String, Value>,
        rendered: Value,
    ) -> Result<Value> {
        let mut map = rendered
            .as_object()
            .cloned()
            .ok_or_else(|| anyhow::anyhow!("rendered target must be an object"))?;

        // Remove keys not present in the template mapping.
        let allowed: HashSet<&String> = target_schema.template.keys().collect();
        map.retain(|k, _| allowed.contains(k));

        for (target_key, tmpl) in &target_schema.template {
            if let crate::schema::ValueTemplate::Field(field) = tmpl {
                if field.optional && !normalized.contains_key(&field.from) {
                    map.remove(target_key);
                    continue;
                }
                if let Some(default) = &field.default {
                    if let Some(current) = map.get(target_key) {
                        if current == default {
                            map.remove(target_key);
                        }
                    }
                }
            }
        }

        Ok(Value::Object(map))
    }
}
