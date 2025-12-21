use anyhow::{Context, Result};
use serde::Serialize;
use serde::ser::SerializeMap;
use serde_json::{Map as JsonMap, Value};
use serde_saphyr as serde_yaml;
use serde_saphyr::FlowMap;
use tracing::info;

use crate::groups;
use crate::paths::resolve_path;
use super::util::{load_group_specs_from_pref, load_rules_from_pref};
use super::{ApiError, RenderArgs};

pub struct ClashRenderer;

impl super::TargetRenderer for ClashRenderer {
    fn render(&self, args: RenderArgs<'_>) -> Result<String, ApiError> {
        render_clash(args).map_err(ApiError::internal)
    }
}

fn render_clash(args: RenderArgs<'_>) -> Result<String> {
    let RenderArgs { state, mut proxies, .. } = args;
    let pref = &state.pref;
    let registry = &state.registry;

    let clash_base = pref
        .common
        .clash_rule_base
        .as_deref()
        .ok_or_else(|| anyhow::anyhow!("`common.clash_rule_base` must be set in pref.toml"))?;
    let base_path = resolve_path(&state.base_dir, clash_base);
    let base_text = std::fs::read_to_string(&base_path)
        .with_context(|| format!("failed to read base config {}", base_path.display()))?;
    let mut base = serde_yaml::from_str::<Value>(&base_text)
        .with_context(|| format!("failed to parse base config {}", base_path.display()))?
        .as_object()
        .cloned()
        .context("base clash config must be a YAML map")?;

    base.remove("proxies");
    base.remove("proxy-groups");
    base.remove("rules");

    super::util::apply_node_pref(pref, registry, &mut proxies);
    proxies.retain(|proxy| !registry.target_not_implemented(&proxy.protocol, "clash"));
    if pref.common.sort {
        proxies.sort_by(|a, b| a.name.cmp(&b.name));
    }

    let clash_proxies: Vec<FlowMap<ProxyForYaml>> = proxies
        .iter()
        .map(|p| {
            let rendered = p.to_target(registry, "clash")?;
            let map = rendered
                .as_object()
                .cloned()
                .context("clash proxy must render to a map")?;
            Ok(FlowMap(ProxyForYaml::new(map)))
        })
        .collect::<Result<_>>()?;

    let group_specs = load_group_specs_from_pref(pref, &state.base_dir)?;
    let proxy_groups =
        groups::build_groups(&group_specs, &proxies).context("failed to build proxy groups")?;
    info!(groups = proxy_groups.len(), "proxy groups built");

    let clash_groups: Vec<Value> = proxy_groups
        .iter()
        .map(crate::export::clash::render_proxy_group)
        .collect();

    let rules = load_rules_from_pref(pref, &state.network, &state.base_dir)?;
    let rendered_rules: Vec<Value> = rules
        .iter()
        .map(|r| {
            let mut line = r.render();
            if line.starts_with("FINAL") {
                if let Some(rest) = line.strip_prefix("FINAL") {
                    line = format!("MATCH{rest}");
                }
            }
            Value::String(line)
        })
        .collect();
    info!(rules = rendered_rules.len(), "rules rendered");

    let output = ClashOutput {
        base,
        proxies: clash_proxies,
        proxy_groups: clash_groups,
        rules: rendered_rules,
    };

    let final_yaml = serde_yaml::to_string(&output)?;
    Ok(strip_rule_quotes(&final_yaml))
}

#[derive(Serialize)]
struct ClashOutput {
    #[serde(flatten)]
    base: JsonMap<String, Value>,
    proxies: Vec<FlowMap<ProxyForYaml>>,
    #[serde(rename = "proxy-groups")]
    proxy_groups: Vec<Value>,
    rules: Vec<Value>,
}

#[derive(Clone)]
struct ProxyForYaml {
    map: JsonMap<String, Value>,
}

impl ProxyForYaml {
    fn new(map: JsonMap<String, Value>) -> Self {
        Self { map }
    }
}

impl Serialize for ProxyForYaml {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        let mut map_ser = serializer.serialize_map(Some(self.map.len()))?;
        for key in ["name", "type", "server", "password"] {
            if let Some(val) = self.map.get(key) {
                map_ser.serialize_entry(key, val)?;
            }
        }
        for (k, v) in &self.map {
            if matches!(k.as_str(), "name" | "type" | "server" | "password") {
                continue;
            }
            map_ser.serialize_entry(k, v)?;
        }
        map_ser.end()
    }
}

fn strip_rule_quotes(yaml: &str) -> String {
    let mut out = String::with_capacity(yaml.len());
    let mut in_rules = false;

    for line in yaml.lines() {
        if line.starts_with("rules:") {
            in_rules = true;
            out.push_str(line);
            out.push('\n');
            continue;
        }

        if in_rules {
            let trimmed = line.trim_start();
            if trimmed.starts_with('-') {
                let indent_len = line.len() - trimmed.len();
                let prefix = &line[..indent_len];
                let rest = trimmed.strip_prefix("- ").unwrap_or(trimmed);
                if let Some(body) = rest
                    .strip_prefix('"')
                    .and_then(|s| s.strip_suffix('"'))
                {
                    out.push_str(prefix);
                    out.push_str("- ");
                    out.push_str(body);
                    out.push('\n');
                    continue;
                }
            } else if !line.starts_with(' ') && !line.is_empty() {
                in_rules = false;
            }
        }

        out.push_str(line);
        out.push('\n');
    }

    out
}
