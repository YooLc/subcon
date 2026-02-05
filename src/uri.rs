use anyhow::{Context, Result, anyhow, bail};
use reqwest::Url;
use serde_json::{Map as JsonMap, Value};

#[derive(Clone, Copy)]
enum UriValueKind {
    String,
    Integer,
    Boolean,
    CsvList,
}

struct UriFieldMapping {
    field: &'static str,
    kind: UriValueKind,
    export_key: &'static str,
    aliases: &'static [&'static str],
}

const URI_FIELD_MAPPINGS: &[UriFieldMapping] = &[
    UriFieldMapping {
        field: "network",
        kind: UriValueKind::String,
        export_key: "type",
        aliases: &["type", "network"],
    },
    UriFieldMapping {
        field: "sni",
        kind: UriValueKind::String,
        export_key: "sni",
        aliases: &["sni"],
    },
    UriFieldMapping {
        field: "servername",
        kind: UriValueKind::String,
        export_key: "servername",
        aliases: &["servername", "server-name"],
    },
    UriFieldMapping {
        field: "alpn",
        kind: UriValueKind::CsvList,
        export_key: "alpn",
        aliases: &["alpn"],
    },
    UriFieldMapping {
        field: "skip-cert-verify",
        kind: UriValueKind::Boolean,
        export_key: "skip-cert-verify",
        aliases: &["skip-cert-verify", "allow-insecure", "allowinsecure"],
    },
    UriFieldMapping {
        field: "client-fingerprint",
        kind: UriValueKind::String,
        export_key: "fp",
        aliases: &["fp", "client-fingerprint", "clientfingerprint"],
    },
    UriFieldMapping {
        field: "fingerprint",
        kind: UriValueKind::String,
        export_key: "fingerprint",
        aliases: &["fingerprint"],
    },
    UriFieldMapping {
        field: "flow",
        kind: UriValueKind::String,
        export_key: "flow",
        aliases: &["flow"],
    },
    UriFieldMapping {
        field: "encryption",
        kind: UriValueKind::String,
        export_key: "encryption",
        aliases: &["encryption"],
    },
    UriFieldMapping {
        field: "packet-encoding",
        kind: UriValueKind::String,
        export_key: "packet-encoding",
        aliases: &["packet-encoding", "packetencoding"],
    },
    UriFieldMapping {
        field: "alterId",
        kind: UriValueKind::Integer,
        export_key: "alterId",
        aliases: &["alter-id", "alterid"],
    },
    UriFieldMapping {
        field: "global-padding",
        kind: UriValueKind::Boolean,
        export_key: "global-padding",
        aliases: &["global-padding", "globalpadding"],
    },
    UriFieldMapping {
        field: "authenticated-length",
        kind: UriValueKind::Boolean,
        export_key: "authenticated-length",
        aliases: &["authenticated-length", "authenticatedlength"],
    },
    UriFieldMapping {
        field: "udp",
        kind: UriValueKind::Boolean,
        export_key: "udp",
        aliases: &["udp"],
    },
    UriFieldMapping {
        field: "tfo",
        kind: UriValueKind::Boolean,
        export_key: "tfo",
        aliases: &["tfo"],
    },
    UriFieldMapping {
        field: "mptcp",
        kind: UriValueKind::Boolean,
        export_key: "mptcp",
        aliases: &["mptcp"],
    },
    UriFieldMapping {
        field: "udp-over-tcp",
        kind: UriValueKind::Boolean,
        export_key: "udp-over-tcp",
        aliases: &["udp-over-tcp", "udpovertcp"],
    },
    UriFieldMapping {
        field: "udp-over-tcp-version",
        kind: UriValueKind::Integer,
        export_key: "udp-over-tcp-version",
        aliases: &["udp-over-tcp-version", "udpovertcpversion"],
    },
    UriFieldMapping {
        field: "ports",
        kind: UriValueKind::String,
        export_key: "ports",
        aliases: &["ports"],
    },
    UriFieldMapping {
        field: "up",
        kind: UriValueKind::String,
        export_key: "up",
        aliases: &["up"],
    },
    UriFieldMapping {
        field: "down",
        kind: UriValueKind::String,
        export_key: "down",
        aliases: &["down"],
    },
    UriFieldMapping {
        field: "obfs",
        kind: UriValueKind::String,
        export_key: "obfs",
        aliases: &["obfs"],
    },
    UriFieldMapping {
        field: "obfs-password",
        kind: UriValueKind::String,
        export_key: "obfs-password",
        aliases: &["obfs-password", "obfspassword"],
    },
    UriFieldMapping {
        field: "idle-session-check-interval",
        kind: UriValueKind::Integer,
        export_key: "idle-session-check-interval",
        aliases: &["idle-session-check-interval", "idlesessioncheckinterval"],
    },
    UriFieldMapping {
        field: "idle-session-timeout",
        kind: UriValueKind::Integer,
        export_key: "idle-session-timeout",
        aliases: &["idle-session-timeout", "idlesessiontimeout"],
    },
    UriFieldMapping {
        field: "min-idle-session",
        kind: UriValueKind::Integer,
        export_key: "min-idle-session",
        aliases: &["min-idle-session", "minidlesession"],
    },
    UriFieldMapping {
        field: "cipher",
        kind: UriValueKind::String,
        export_key: "cipher",
        aliases: &["cipher"],
    },
    UriFieldMapping {
        field: "plugin",
        kind: UriValueKind::String,
        export_key: "plugin",
        aliases: &["plugin"],
    },
    UriFieldMapping {
        field: "ip-version",
        kind: UriValueKind::String,
        export_key: "ip-version",
        aliases: &["ip-version", "ipversion"],
    },
    UriFieldMapping {
        field: "interface-name",
        kind: UriValueKind::String,
        export_key: "interface-name",
        aliases: &["interface-name", "interfacename"],
    },
    UriFieldMapping {
        field: "routing-mark",
        kind: UriValueKind::Integer,
        export_key: "routing-mark",
        aliases: &["routing-mark", "routingmark"],
    },
    UriFieldMapping {
        field: "dialer-proxy",
        kind: UriValueKind::String,
        export_key: "dialer-proxy",
        aliases: &["dialer-proxy", "dialerproxy"],
    },
    UriFieldMapping {
        field: "ip",
        kind: UriValueKind::String,
        export_key: "ip",
        aliases: &["ip"],
    },
    UriFieldMapping {
        field: "ipv6",
        kind: UriValueKind::String,
        export_key: "ipv6",
        aliases: &["ipv6"],
    },
    UriFieldMapping {
        field: "private-key",
        kind: UriValueKind::String,
        export_key: "private-key",
        aliases: &["private-key", "privatekey"],
    },
    UriFieldMapping {
        field: "public-key",
        kind: UriValueKind::String,
        export_key: "public-key",
        aliases: &["public-key", "publickey"],
    },
    UriFieldMapping {
        field: "pre-shared-key",
        kind: UriValueKind::String,
        export_key: "pre-shared-key",
        aliases: &["pre-shared-key", "presharedkey"],
    },
    UriFieldMapping {
        field: "reserved",
        kind: UriValueKind::String,
        export_key: "reserved",
        aliases: &["reserved"],
    },
    UriFieldMapping {
        field: "mtu",
        kind: UriValueKind::Integer,
        export_key: "mtu",
        aliases: &["mtu"],
    },
    UriFieldMapping {
        field: "remote-dns-resolve",
        kind: UriValueKind::Boolean,
        export_key: "remote-dns-resolve",
        aliases: &["remote-dns-resolve", "remotednsresolve"],
    },
    UriFieldMapping {
        field: "allowed-ips",
        kind: UriValueKind::CsvList,
        export_key: "allowed-ips",
        aliases: &["allowed-ips", "allowedips"],
    },
    UriFieldMapping {
        field: "dns",
        kind: UriValueKind::CsvList,
        export_key: "dns",
        aliases: &["dns"],
    },
    UriFieldMapping {
        field: "certificate",
        kind: UriValueKind::String,
        export_key: "certificate",
        aliases: &["certificate"],
    },
];

const URI_AUTH_SPECS: &[(&str, UriAuthSpec)] = &[
    ("vless", UriAuthSpec::Single("uuid")),
    ("vmess", UriAuthSpec::Single("uuid")),
    ("trojan", UriAuthSpec::Single("password")),
    ("anytls", UriAuthSpec::Single("password")),
    ("hysteria2", UriAuthSpec::Single("password")),
    ("shadowsocks", UriAuthSpec::MethodPassword { method: "cipher", password: "password" }),
    ("http", UriAuthSpec::UserPassword { username: "username", password: "password" }),
    ("socks5", UriAuthSpec::UserPassword { username: "username", password: "password" }),
];

#[derive(Clone, Copy)]
enum UriAuthSpec {
    None,
    Single(&'static str),
    MethodPassword { method: &'static str, password: &'static str },
    UserPassword { username: &'static str, password: &'static str },
}

pub fn is_uri_input(input: &str) -> bool {
    let mut seen = false;
    for line in input.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') || trimmed.starts_with("//") {
            continue;
        }
        seen = true;
        if !trimmed.contains("://") {
            return false;
        }
    }
    seen
}

pub fn parse_uri_lines(input: &str) -> Result<Vec<Value>> {
    let mut proxies = Vec::new();
    for (idx, line) in input.lines().enumerate() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') || trimmed.starts_with("//") {
            continue;
        }
        let proxy = parse_uri_line(trimmed)
            .with_context(|| format!("failed to parse uri at line {}", idx + 1))?;
        proxies.push(Value::Object(proxy));
    }
    Ok(proxies)
}

fn parse_uri_line(line: &str) -> Result<JsonMap<String, Value>> {
    let url = Url::parse(line).with_context(|| format!("invalid uri {line}"))?;
    let protocol = url.scheme().to_lowercase();
    let host = url
        .host_str()
        .ok_or_else(|| anyhow!("uri missing host"))?;
    let port = url.port().ok_or_else(|| anyhow!("uri missing port"))?;

    let mut map = JsonMap::new();
    map.insert("type".to_string(), Value::String(protocol.clone()));
    map.insert("server".to_string(), Value::String(host.to_string()));
    map.insert("port".to_string(), Value::Number(port.into()));

    apply_auth_fields(&protocol, url.username(), url.password(), &mut map)?;

    for (raw_key, value) in url.query_pairs() {
        let key = raw_key.as_ref();
        if normalize_key(key) == "security" {
            let security = value.to_string();
            let tls = !security.eq_ignore_ascii_case("none");
            map.insert("security".to_string(), Value::String(security));
            map.insert("tls".to_string(), Value::Bool(tls));
            continue;
        }

        if let Some(field) = resolve_field_for_key(key) {
            if let Some(parsed) = parse_value(field, &value) {
                map.insert(field.to_string(), parsed);
            }
        }
    }

    if let Some(fragment) = url.fragment() {
        let name = percent_decode(fragment);
        if !name.is_empty() {
            map.insert("name".to_string(), Value::String(name));
        }
    }

    if !map.contains_key("name") {
        map.insert(
            "name".to_string(),
            Value::String(format!("{protocol}-{host}:{port}")),
        );
    }

    Ok(map)
}

fn apply_auth_fields(
    protocol: &str,
    username: &str,
    password: Option<&str>,
    map: &mut JsonMap<String, Value>,
) -> Result<()> {
    let spec = URI_AUTH_SPECS
        .iter()
        .find(|(scheme, _)| *scheme == protocol)
        .map(|(_, spec)| *spec)
        .unwrap_or(UriAuthSpec::None);

    match spec {
        UriAuthSpec::None => Ok(()),
        UriAuthSpec::Single(field) => {
            let value = if !username.is_empty() {
                username.to_string()
            } else if let Some(pass) = password {
                pass.to_string()
            } else {
                "".to_string()
            };
            if value.is_empty() {
                bail!("uri missing auth for {protocol}");
            }
            map.insert(field.to_string(), Value::String(value));
            Ok(())
        }
        UriAuthSpec::MethodPassword { method, password: pass_field } => {
            let pass = password.ok_or_else(|| anyhow!("uri missing password for {protocol}"))?;
            if username.is_empty() {
                bail!("uri missing method for {protocol}");
            }
            map.insert(method.to_string(), Value::String(username.to_string()));
            map.insert(pass_field.to_string(), Value::String(pass.to_string()));
            Ok(())
        }
        UriAuthSpec::UserPassword { username: user_field, password: pass_field } => {
            if !username.is_empty() {
                map.insert(user_field.to_string(), Value::String(username.to_string()));
            }
            if let Some(pass) = password {
                map.insert(pass_field.to_string(), Value::String(pass.to_string()));
            }
            Ok(())
        }
    }
}

pub fn render_uri_line(protocol: &str, values: &JsonMap<String, Value>) -> Result<String> {
    let server = get_string(values, "server")?;
    let port = get_number(values, "port")?;

    let auth = build_auth(protocol, values)?;
    let mut out = String::new();
    out.push_str(protocol);
    out.push_str("://");
    if !auth.is_empty() {
        out.push_str(&percent_encode(&auth));
        out.push('@');
    }
    out.push_str(server);
    out.push(':');
    out.push_str(&port);

    let mut query_parts = Vec::new();

    if let Some(security) = values.get("security").and_then(|v| v.as_str()) {
        query_parts.push(("security", security.to_string()));
    } else if let Some(tls) = values.get("tls").and_then(|v| v.as_bool()) {
        query_parts.push(("security", if tls { "tls" } else { "none" }.to_string()));
    }

    for mapping in URI_FIELD_MAPPINGS {
        if mapping.field == "server"
            || mapping.field == "port"
            || mapping.field == "name"
            || mapping.field == "tls"
        {
            continue;
        }
        if uses_auth_field(protocol, mapping.field) {
            continue;
        }
        if let Some(value) = values.get(mapping.field) {
            if let Some(encoded) = format_value(mapping.kind, value) {
                query_parts.push((mapping.export_key, encoded));
            }
        }
    }

    if !query_parts.is_empty() {
        out.push('?');
        out.push_str(&encode_query(&query_parts));
    }

    if let Some(name) = values.get("name").and_then(|v| v.as_str()) {
        if !name.is_empty() {
            out.push('#');
            out.push_str(&percent_encode(name));
        }
    }

    Ok(out)
}

fn build_auth(protocol: &str, values: &JsonMap<String, Value>) -> Result<String> {
    let spec = URI_AUTH_SPECS
        .iter()
        .find(|(scheme, _)| *scheme == protocol)
        .map(|(_, spec)| *spec)
        .unwrap_or(UriAuthSpec::None);

    match spec {
        UriAuthSpec::None => Ok(String::new()),
        UriAuthSpec::Single(field) => get_string(values, field).map(|s| s.to_string()),
        UriAuthSpec::MethodPassword { method, password } => {
            let method_val = get_string(values, method)?;
            let pass_val = get_string(values, password)?;
            Ok(format!("{method_val}:{pass_val}"))
        }
        UriAuthSpec::UserPassword { username, password } => {
            let user = values.get(username).and_then(|v| v.as_str()).unwrap_or("");
            let pass = values.get(password).and_then(|v| v.as_str()).unwrap_or("");
            if user.is_empty() && pass.is_empty() {
                Ok(String::new())
            } else {
                Ok(format!("{user}:{pass}"))
            }
        }
    }
}

fn uses_auth_field(protocol: &str, field: &str) -> bool {
    let spec = URI_AUTH_SPECS
        .iter()
        .find(|(scheme, _)| *scheme == protocol)
        .map(|(_, spec)| *spec)
        .unwrap_or(UriAuthSpec::None);
    match spec {
        UriAuthSpec::None => false,
        UriAuthSpec::Single(f) => f == field,
        UriAuthSpec::MethodPassword { method, password } => method == field || password == field,
        UriAuthSpec::UserPassword { username, password } => username == field || password == field,
    }
}

fn resolve_field_for_key(raw_key: &str) -> Option<&'static str> {
    let normalized = normalize_key(raw_key);
    for mapping in URI_FIELD_MAPPINGS {
        if mapping.aliases.iter().any(|alias| *alias == normalized) {
            return Some(mapping.field);
        }
    }
    None
}

fn parse_value(field: &str, raw: &str) -> Option<Value> {
    let mapping = URI_FIELD_MAPPINGS
        .iter()
        .find(|m| m.field == field);
    let kind = mapping.map(|m| m.kind).unwrap_or(UriValueKind::String);
    match kind {
        UriValueKind::String => Some(Value::String(raw.to_string())),
        UriValueKind::Integer => parse_integer(raw).map(Value::Number),
        UriValueKind::Boolean => parse_bool(raw).map(Value::Bool),
        UriValueKind::CsvList => {
            let items: Vec<Value> = raw
                .split(',')
                .map(|s| s.trim())
                .filter(|s| !s.is_empty())
                .map(|s| Value::String(s.to_string()))
                .collect();
            if items.is_empty() {
                None
            } else {
                Some(Value::Array(items))
            }
        }
    }
}

fn format_value(kind: UriValueKind, value: &Value) -> Option<String> {
    match kind {
        UriValueKind::String => value.as_str().map(|s| s.to_string()),
        UriValueKind::Integer => value.as_i64().map(|v| v.to_string()),
        UriValueKind::Boolean => value.as_bool().map(|v| v.to_string()),
        UriValueKind::CsvList => value.as_array().map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str())
                .collect::<Vec<_>>()
                .join(",")
        }),
    }
}

fn normalize_key(input: &str) -> String {
    let mut out = String::new();
    let mut prev_dash = false;
    for (idx, ch) in input.chars().enumerate() {
        if ch == '_' || ch == '-' {
            if !prev_dash {
                out.push('-');
                prev_dash = true;
            }
            continue;
        }
        if ch.is_ascii_uppercase() {
            if idx > 0 && !prev_dash {
                out.push('-');
            }
            out.push(ch.to_ascii_lowercase());
            prev_dash = false;
        } else {
            out.push(ch.to_ascii_lowercase());
            prev_dash = false;
        }
    }
    out
}

fn parse_integer(raw: &str) -> Option<serde_json::Number> {
    raw.parse::<i64>().ok().map(serde_json::Number::from)
}

fn parse_bool(raw: &str) -> Option<bool> {
    match raw.trim().to_ascii_lowercase().as_str() {
        "1" | "true" | "yes" | "on" => Some(true),
        "0" | "false" | "no" | "off" => Some(false),
        _ => None,
    }
}

fn get_string<'a>(values: &'a JsonMap<String, Value>, key: &str) -> Result<&'a str> {
    values
        .get(key)
        .and_then(|v| v.as_str())
        .ok_or_else(|| anyhow!("uri export requires `{key}`"))
}

fn get_number(values: &JsonMap<String, Value>, key: &str) -> Result<String> {
    if let Some(value) = values.get(key) {
        if let Some(num) = value
            .as_i64()
            .or_else(|| value.as_u64().and_then(|v| i64::try_from(v).ok()))
        {
            return Ok(num.to_string());
        }
        if let Some(raw) = value.as_str() {
            if let Ok(parsed) = raw.parse::<i64>() {
                return Ok(parsed.to_string());
            }
        }
    }
    Err(anyhow!("uri export requires numeric `{key}`"))
}

fn percent_encode(input: &str) -> String {
    input
        .as_bytes()
        .iter()
        .map(|b| match *b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                (*b as char).to_string()
            }
            _ => format!("%{:02X}", b),
        })
        .collect::<Vec<_>>()
        .join("")
}

fn percent_decode(input: &str) -> String {
    let mut out = String::new();
    let bytes = input.as_bytes();
    let mut idx = 0;
    while idx < bytes.len() {
        if bytes[idx] == b'%' && idx + 2 < bytes.len() {
            if let Ok(hex) = std::str::from_utf8(&bytes[idx + 1..idx + 3]) {
                if let Ok(val) = u8::from_str_radix(hex, 16) {
                    out.push(val as char);
                    idx += 3;
                    continue;
                }
            }
        }
        out.push(bytes[idx] as char);
        idx += 1;
    }
    out
}

fn encode_query(parts: &[(&str, String)]) -> String {
    let mut out = String::new();
    for (idx, (key, value)) in parts.iter().enumerate() {
        if idx > 0 {
            out.push('&');
        }
        out.push_str(&percent_encode(key));
        out.push('=');
        out.push_str(&percent_encode(value));
    }
    out
}
