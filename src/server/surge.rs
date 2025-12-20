use std::fmt::Write as FmtWrite;
use std::hash::{DefaultHasher, Hash, Hasher};

use anyhow::{Context, Result, anyhow};
use serde_json::{Map as JsonMap, Value};
use tracing::info;

use crate::config::Pref;
use crate::groups;
use crate::schema::SchemaRegistry;

use super::util::{load_group_specs_from_pref, load_rules_from_pref};
use super::{ApiError, RenderArgs};

pub struct SurgeRenderer;

impl super::TargetRenderer for SurgeRenderer {
    fn render(&self, args: RenderArgs<'_>) -> Result<String, ApiError> {
        render_surge(args).map_err(ApiError::internal)
    }
}

fn render_surge(args: RenderArgs<'_>) -> Result<String> {
    let RenderArgs {
        state,
        mut proxies,
        request_uri,
    } = args;
    let pref = &state.pref;
    let registry = &state.registry;

    let mut out = String::new();
    if let Some(line) = build_managed_config_line(pref, request_uri.as_deref())? {
        out.push_str(&line);
        out.push('\n');
    }

    let surge_base = pref
        .common
        .surge_rule_base
        .as_deref()
        .ok_or_else(|| anyhow::anyhow!("`common.surge_rule_base` must be set in pref.toml"))?;
    let base_path = super::util::resolve_path(&state.base_dir, surge_base);
    let mut base_text = std::fs::read_to_string(&base_path)
        .with_context(|| format!("failed to read base config {}", base_path.display()))?;
    if !base_text.ends_with('\n') {
        base_text.push('\n');
    }
    out.push_str(&base_text);
    out.push('\n');

    super::util::apply_node_pref(pref, registry, &mut proxies);
    proxies.retain(|proxy| !registry.target_not_implemented(&proxy.protocol, "surge"));
    if pref.common.sort {
        proxies.sort_by(|a, b| a.name.cmp(&b.name));
    }
    info!(count = proxies.len(), "proxies loaded for surge render");

    let mut wg_sections = Vec::new();

    if !proxies.is_empty() {
        out.push_str("[Proxy]\n");
        for proxy in &proxies {
            if proxy.protocol == "wireguard" {
                let section_name = deterministic_hex_section(&proxy.name);
                let (line, section_block) =
                    render_surge_wireguard_proxy_line(registry, proxy, &section_name)?;
                out.push_str(&line);
                out.push('\n');
                wg_sections.push(section_block);
            } else {
                let line = render_surge_proxy_line(registry, proxy)?;
                out.push_str(&line);
                out.push('\n');
            }
        }
        out.push('\n');
    }

    if !wg_sections.is_empty() {
        for block in wg_sections {
            out.push_str(&block);
            if !block.ends_with('\n') {
                out.push('\n');
            }
            out.push('\n');
        }
    }

    let group_specs = load_group_specs_from_pref(pref, &state.base_dir)?;
    let proxy_groups =
        groups::build_groups(&group_specs, &proxies).context("failed to build proxy groups")?;
    info!(groups = proxy_groups.len(), "proxy groups built for surge");

    if !proxy_groups.is_empty() {
        out.push_str("[Proxy Group]\n");
        for group in &proxy_groups {
            let line = render_surge_group_line(group);
            out.push_str(&line);
            out.push('\n');
        }
        out.push('\n');
    }

    let rules = load_rules_from_pref(pref, &state.base_dir)?;
    let rendered_rules: Vec<String> = rules
        .iter()
        .map(|r| {
            let mut line = r.render();
            if line == "SRC-IP-CIDR" {
                line = "IP-CIDR".to_string();
            } else if let Some(rest) = line.strip_prefix("SRC-IP-CIDR,") {
                line = format!("IP-CIDR,{rest},no-resolve");
            }
            line
        })
        .collect();
    info!(rules = rendered_rules.len(), "rules rendered for surge");

    if !rendered_rules.is_empty() {
        out.push_str("[Rule]\n");
        for line in rendered_rules {
            out.push_str(&line);
            out.push('\n');
        }
    }

    Ok(out)
}

fn build_managed_config_line(pref: &Pref, request_uri: Option<&str>) -> Result<Option<String>> {
    let managed = &pref.managed_config;
    if !managed.write_managed_config {
        return Ok(None);
    }

    let base_url = managed
        .base_url
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| anyhow!("`managed_config.base_url` must be set in pref.toml"))?;
    let uri = request_uri
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| anyhow!("request uri missing for managed config"))?;
    let base = base_url.trim_end_matches('/');
    let path = if uri.starts_with('/') {
        uri.to_string()
    } else {
        format!("/{uri}")
    };

    Ok(Some(format!(
        "#!MANAGED-CONFIG {base}{path} interval={} strict={}",
        managed.interval, managed.strict
    )))
}

fn render_surge_proxy_line(
    registry: &SchemaRegistry,
    proxy: &crate::proxy::Proxy,
) -> Result<String> {
    let rendered = registry
        .convert(&proxy.protocol, "surge", &proxy.values)
        .with_context(|| format!("failed to render surge proxy {}", proxy.name))?;
    match rendered {
        Value::String(s) => Ok(s),
        other => Err(anyhow!("surge exporter must return string, got {other}")),
    }
}

fn render_surge_wireguard_proxy_line(
    registry: &SchemaRegistry,
    proxy: &crate::proxy::Proxy,
    section_name: &str,
) -> Result<(String, String)> {
    let rendered = registry
        .convert(&proxy.protocol, "surge", &proxy.values)
        .with_context(|| format!("failed to render surge proxy {}", proxy.name))?;
    let map = rendered.as_object().cloned().unwrap_or_else(JsonMap::new);

    let mut line_parts = Vec::new();
    line_parts.push(proxy.name.clone());
    line_parts.push(" = ".to_string());
    line_parts.push("wireguard".to_string());
    line_parts.push(format!(", section-name={section_name}"));

    if let Some(underlying) = proxy
        .values
        .get("dialer-proxy")
        .or_else(|| map.get("underlying-proxy"))
        .and_then(|v| v.as_str())
    {
        line_parts.push(format!(", underlying-proxy={underlying}"));
    }

    let mut section_lines = String::new();
    let mut section_written = false;

    let mut section_map = JsonMap::new();

    if let Some(dns) = map.get("dns-server").or_else(|| proxy.values.get("dns")) {
        if let Some(first) = dns.as_array().and_then(|a| a.first()) {
            if let Some(d) = first.as_str() {
                section_map.insert("dns-server".to_string(), Value::String(d.to_string()));
            }
        } else if let Some(d) = dns.as_str() {
            section_map.insert("dns-server".to_string(), Value::String(d.to_string()));
        }
    }

    if let Some(ip) = proxy.values.get("ip").and_then(|v| v.as_str()) {
        section_map.insert("self-ip".to_string(), Value::String(ip.to_string()));
    }
    if let Some(ipv6) = proxy.values.get("ipv6").and_then(|v| v.as_str()) {
        section_map.insert("self-ip-v6".to_string(), Value::String(ipv6.to_string()));
    }
    if let Some(pk) = proxy.values.get("private-key").and_then(|v| v.as_str()) {
        section_map.insert("private-key".to_string(), Value::String(pk.to_string()));
    }

    let mut peer_parts = Vec::new();
    if let Some(pubk) = proxy.values.get("public-key").and_then(|v| v.as_str()) {
        peer_parts.push(format!("public-key = {pubk}"));
    }
    let endpoint = {
        let server = proxy.values.get("server").and_then(|v| v.as_str());
        let port = proxy.values.get("port").and_then(|v| v.as_u64());
        match (server, port) {
            (Some(srv), Some(p)) => Some(format!("{srv}:{p}")),
            _ => None,
        }
    };
    if let Some(ep) = endpoint {
        peer_parts.push(format!("endpoint = {ep}"));
    }
    if let Some(psk) = proxy
        .values
        .get("pre-shared-key")
        .or_else(|| proxy.values.get("preshared-key"))
        .and_then(|v| v.as_str())
    {
        peer_parts.push(format!("preshared-key = {psk}"));
    }
    if let Some(allowed_value) = proxy.values.get("allowed-ips") {
        let allowed = match allowed_value {
            Value::String(s) => Some(s.to_string()),
            Value::Array(arr) => {
                let parts: Vec<String> = arr
                    .iter()
                    .filter_map(|v| v.as_str().map(|s| s.to_string()))
                    .collect();
                if parts.is_empty() {
                    None
                } else {
                    Some(parts.join(", "))
                }
            }
            _ => None,
        };
        if let Some(allowed) = allowed {
            peer_parts.push(format!("allowed-ips = \"{allowed}\""));
        }
    }

    if !peer_parts.is_empty() {
        section_map.insert(
            "peer".to_string(),
            Value::String(format!("({})", peer_parts.join(", "))),
        );
    }

    if !section_map.is_empty() {
        section_lines.push_str(&format!("[WireGuard {section_name}]\n"));
        for (k, v) in &section_map {
            let val = format_surge_value(v);
            section_lines.push_str(&format!("{k}={val}\n"));
        }
        section_written = true;
    }

    let skip_keys = [
        "name",
        "type",
        "server",
        "port",
        "dns-server",
        "ip",
        "ipv6",
        "private-key",
        "public-key",
        "pre-shared-key",
        "preshared-key",
        "allowed-ips",
        "dns",
    ];
    for (k, v) in &map {
        if skip_keys.contains(&k.as_str()) {
            continue;
        }
        line_parts.push(format!(", {k}={}", format_surge_value(v)));
    }

    let line = line_parts.concat();
    let section_block = if section_written {
        section_lines
    } else {
        String::new()
    };
    Ok((line, section_block))
}

fn render_surge_group_line(group: &groups::ProxyGroup) -> String {
    let mut line = String::new();
    let mut group_type = match group.group_type.as_str() {
        "url-test" => "smart",
        other => other,
    };
    if group.proxies.is_empty() {
        group_type = "select";
    }
    let _ = write!(line, "{} = {}", group.name, group_type);
    if group.proxies.is_empty() {
        let _ = write!(line, ",DIRECT");
    } else {
        for item in &group.proxies {
            let name = item.strip_prefix("[]").unwrap_or(item);
            let _ = write!(line, ",{}", name);
        }
    }
    line
}

fn format_surge_value(v: &Value) -> String {
    match v {
        Value::Bool(b) => b.to_string(),
        Value::Number(n) => n.to_string(),
        Value::String(s) => s.to_string(),
        Value::Array(arr) => {
            let joined: Vec<String> = arr.iter().map(format_surge_value).collect();
            joined.join("|")
        }
        Value::Object(_) | Value::Null => "".to_string(),
    }
}

fn deterministic_hex_section(name: &str) -> String {
    let mut hasher = DefaultHasher::new();
    name.hash(&mut hasher);
    let n = (hasher.finish() & 0xFFFFF) as u32;
    format!("{n:05x}")
}
