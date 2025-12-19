use anyhow::{Context, Result, anyhow, bail};
use serde_json::{Map as JsonMap, Value};

use super::Exporter;
use crate::schema::TargetSchema;

pub struct SurgeExporter;

impl Exporter for SurgeExporter {
    fn target(&self) -> &'static str {
        "surge"
    }

    fn render(
        &self,
        protocol: &str,
        _target_schema: &TargetSchema,
        normalized: &JsonMap<String, Value>,
        rendered: Value,
    ) -> Result<Value> {
        let mut rendered_map = rendered
            .as_object()
            .cloned()
            .context("surge rendering expects object from template")?;

        match protocol {
            "hysteria2" => normalize_hysteria2(&mut rendered_map)?,
            "shadowsocks" => normalize_shadowsocks(&mut rendered_map)?,
            _ => {}
        }

        let name = normalized
            .get("name")
            .and_then(|v| v.as_str())
            .ok_or_else(|| anyhow!("surge export requires `name`"))?;
        let server = get_string(&rendered_map, "server")?;
        let port = get_number(&rendered_map, "port")?;

        render_common_line(name, server, port, &rendered_map)
    }
}

fn render_common_line(
    name: &str,
    server: String,
    port: String,
    rendered_map: &JsonMap<String, Value>,
) -> Result<Value> {
    let type_value = get_string(rendered_map, "type")?;
    let prefix = format!("{name} = {type_value}, {server}, {port}");

    let base_keys = ["name", "type", "server", "port"];
    let mut rest_keys: Vec<String> = rendered_map
        .keys()
        .filter(|k| !base_keys.contains(&k.as_str()))
        .cloned()
        .collect();
    rest_keys.sort();

    let mut parts = Vec::with_capacity(1 + rest_keys.len());
    parts.push(prefix);

    for key in rest_keys {
        if let Some(value) = rendered_map.get(&key) {
            parts.push(format_value(&key, value));
        }
    }

    Ok(Value::String(parts.join(", ")))
}

fn normalize_hysteria2(map: &mut JsonMap<String, Value>) -> Result<()> {
    let keys: Vec<String> = map.keys().cloned().collect();
    for key in keys {
        if let Some(val) = map.get(&key).cloned() {
            if let Some(bw) = parse_bandwidth(&val)? {
                map.insert(key, Value::Number(bw));
            }
        }
    }
    Ok(())
}

fn normalize_shadowsocks(map: &mut JsonMap<String, Value>) -> Result<()> {
    map.insert("type".to_string(), Value::String("ss".to_string()));

    if let Some(cipher) = map.remove("cipher") {
        map.insert("encrypt-method".to_string(), cipher);
    }

    let plugin = map.remove("plugin");
    let plugin_opts = map.remove("plugin-opts");

    if let Some(plugin_value) = plugin {
        let plugin_name = plugin_value
            .as_str()
            .ok_or_else(|| anyhow!("shadowsocks plugin must be a string"))?;
        let opts = parse_opts(plugin_opts)?;

        match plugin_name {
            "obfs" => apply_obfs(opts, map)?,
            other => bail!("surge exporter does not support shadowsocks plugin `{other}`"),
        }
    }

    Ok(())
}

fn apply_obfs(opts: JsonMap<String, Value>, map: &mut JsonMap<String, Value>) -> Result<()> {
    let mode = opts
        .get("mode")
        .and_then(|v| v.as_str())
        .ok_or_else(|| anyhow!("shadowsocks obfs plugin requires `mode` (http/tls)"))?;

    map.insert("obfs".to_string(), Value::String(mode.to_string()));

    if let Some(host) = opts.get("host").and_then(|v| v.as_str()) {
        map.insert("obfs-host".to_string(), Value::String(host.to_string()));
    }

    if let Some(uri) = opts
        .get("uri")
        .or_else(|| opts.get("path"))
        .and_then(|v| v.as_str())
    {
        map.insert("obfs-uri".to_string(), Value::String(uri.to_string()));
    }

    Ok(())
}

fn parse_opts(value: Option<Value>) -> Result<JsonMap<String, Value>> {
    match value {
        Some(Value::Object(map)) => Ok(map),
        Some(_) => Err(anyhow!("shadowsocks plugin-opts must be a map")),
        None => Ok(JsonMap::new()),
    }
}

fn parse_bandwidth(value: &Value) -> Result<Option<serde_json::Number>> {
    let s = match value {
        Value::String(s) => s.trim(),
        Value::Number(n) => return Ok(Some(n.clone())),
        _ => return Ok(None),
    };

    let mut chars = s.chars().peekable();
    let mut number = String::new();
    while let Some(&c) = chars.peek() {
        if c.is_ascii_digit() || c == '.' {
            number.push(c);
            chars.next();
        } else {
            break;
        }
    }
    let unit: String = chars.collect::<String>().trim().to_ascii_lowercase();
    let base: f64 = match number.parse() {
        Ok(n) => n,
        Err(_) => return Ok(None),
    };

    let mbps = match unit.as_str() {
        "gbps" | "g" | "gbit" => base * 1000.0,
        "mbps" | "m" | "mbit" | "" => base,
        "kbps" | "k" | "kbit" => base / 1000.0,
        "bps" => base / 1_000_000.0,
        _ => return Ok(None),
    };

    Ok(serde_json::Number::from_f64(mbps))
}

fn format_value(key: &str, value: &Value) -> String {
    match value {
        Value::Bool(b) => format!("{key}={}", b),
        Value::Number(n) => format!("{key}={}", n),
        Value::String(s) => format!("{key}={s}"),
        other => format!("{key}={}", other),
    }
}

fn get_string(map: &JsonMap<String, Value>, key: &str) -> Result<String> {
    map.get(key)
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| anyhow!("surge export requires `{key}`"))
}

fn get_number(map: &JsonMap<String, Value>, key: &str) -> Result<String> {
    let num = map
        .get(key)
        .and_then(|v| v.as_i64().or_else(|| v.as_u64().map(|p| p as i64)))
        .ok_or_else(|| anyhow!("surge export requires numeric `{key}`"))?;
    Ok(num.to_string())
}
