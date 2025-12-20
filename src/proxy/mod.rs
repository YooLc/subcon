use std::{fs, path::Path};
use std::path::PathBuf;

use anyhow::{Context, Result, anyhow};
use serde_json::{Map as JsonMap, Value};

use crate::schema::SchemaRegistry;

#[derive(Debug, Clone)]
pub struct Proxy {
    pub name: String,
    pub protocol: String,
    pub values: JsonMap<String, Value>,
}

impl Proxy {
    pub fn to_target(&self, registry: &SchemaRegistry, target: &str) -> Result<Value> {
        registry.convert(&self.protocol, target, &self.values)
    }
}

pub fn load_from_profile(registry: &SchemaRegistry, path: impl AsRef<Path>) -> Result<Vec<Proxy>> {
    let path = path.as_ref();
    let text = fs::read_to_string(path)
        .with_context(|| format!("failed to read profile {}", path.display()))?;
    load_from_text(registry, &text)
        .with_context(|| format!("failed to parse profile {}", path.display()))
}

pub fn load_from_text(registry: &SchemaRegistry, text: &str) -> Result<Vec<Proxy>> {
    let parsed = registry
        .parse("clash", text)
        .context("failed to parse clash profile")?;
    extract_proxies(&parsed)
}

#[allow(dead_code)]
pub fn load_from_dir(registry: &SchemaRegistry, dir: impl AsRef<Path>) -> Result<Vec<Proxy>> {
    let dir = dir.as_ref();
    let paths = collect_profile_files(dir)?;
    load_from_paths(registry, paths)
}

pub fn load_from_paths(registry: &SchemaRegistry, paths: Vec<PathBuf>) -> Result<Vec<Proxy>> {
    let mut proxies: Vec<Proxy> = Vec::new();
    for path in paths {
        proxies.extend(load_from_profile(registry, path)?);
    }
    Ok(proxies)
}

fn parse_proxy(value: &Value) -> Result<Proxy> {
    let map = value
        .as_object()
        .cloned()
        .ok_or_else(|| anyhow!("each proxy must be a map"))?;

    let name = map
        .get("name")
        .and_then(|v| v.as_str())
        .ok_or_else(|| anyhow!("proxy missing `name`"))?
        .to_string();

    let protocol = map
        .get("type")
        .and_then(|v| v.as_str())
        .ok_or_else(|| anyhow!("proxy `{}` missing `type`", name))?;

    let protocol = normalize_protocol(protocol);

    Ok(Proxy {
        name,
        protocol,
        values: map,
    })
}

fn extract_proxies(parsed: &Value) -> Result<Vec<Proxy>> {
    let (field, proxies_value) = match parsed.get("proxies") {
        Some(v) => ("proxies", v),
        None => match parsed.get("proxy") {
            Some(v) => ("proxy", v),
            None => return Ok(Vec::new()),
        },
    };

    match proxies_value {
        Value::Array(items) => items.iter().map(parse_proxy).collect(),
        Value::Object(_) => Ok(vec![parse_proxy(proxies_value)?]),
        Value::Null => Ok(Vec::new()),
        _ => Err(anyhow!("clash profile `{}` must be an array or map", field)),
    }
}

fn normalize_protocol(protocol: &str) -> String {
    match protocol {
        "ss" => "shadowsocks".to_string(),
        other => other.to_string(),
    }
}

pub fn collect_profile_files(dir: &Path) -> Result<Vec<PathBuf>> {
    let mut paths: Vec<_> = fs::read_dir(dir)
        .with_context(|| format!("failed to read profiles directory {}", dir.display()))?
        .filter_map(|entry| {
            let entry = match entry {
                Ok(e) => e,
                Err(_) => return None,
            };
            let path = entry.path();
            match path.extension().and_then(|s| s.to_str()) {
                Some("yml") | Some("yaml") => Some(path),
                _ => None,
            }
        })
        .collect();

    paths.sort();
    Ok(paths)
}
