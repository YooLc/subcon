use anyhow::Result;
use serde_json::{Map as JsonMap, Value};

use super::Exporter;
use crate::groups::ProxyGroup;
use crate::schema::TargetSchema;

pub struct ClashExporter;

impl Exporter for ClashExporter {
    fn target(&self) -> &'static str {
        "clash"
    }

    fn render(
        &self,
        protocol: &str,
        _target_schema: &TargetSchema,
        _normalized: &JsonMap<String, Value>,
        rendered: Value,
    ) -> Result<Value> {
        match protocol {
            _ => Ok(rendered),
        }
    }
}

pub fn render_proxy_group(group: &ProxyGroup) -> Value {
    let mut map = JsonMap::new();
    map.insert("name".to_string(), Value::String(group.name.clone()));
    map.insert(
        "type".to_string(),
        Value::String(group.group_type.clone()),
    );
    let mut proxies: Vec<Value> = group
        .proxies
        .iter()
        .map(|p| Value::String(normalize_proxy_name(p)))
        .collect();
    if proxies.is_empty() {
        proxies.push(Value::String("DIRECT".to_string()));
    }
    map.insert("proxies".to_string(), Value::Array(proxies));

    if let Some(url) = &group.url {
        map.insert("url".to_string(), Value::String(url.clone()));
    }
    if let Some(interval) = group.interval {
        map.insert(
            "interval".to_string(),
            Value::Number(interval.into()),
        );
    }

    Value::Object(map)
}

fn normalize_proxy_name(name: &str) -> String {
    if let Some(stripped) = name.strip_prefix("[]") {
        stripped.trim().to_string()
    } else {
        name.to_string()
    }
}
