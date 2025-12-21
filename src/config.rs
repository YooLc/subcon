use std::{fs, path::Path};

use anyhow::{Context, Result};
use serde::Deserialize;

#[derive(Debug, Deserialize)]
pub struct Pref {
    #[allow(dead_code)]
    pub version: Option<u32>,
    pub common: Common,
    #[serde(default)]
    pub custom_groups: Vec<GroupImport>,
    pub ruleset: Option<Ruleset>,
    #[serde(default)]
    pub rulesets: Vec<RulesetImport>,
    #[serde(default)]
    pub managed_config: ManagedConfig,
    #[serde(default)]
    pub network: NetworkConfig,
    pub server: Server,
    #[serde(default)]
    pub node_pref: NodePref,
}

#[derive(Debug, Deserialize)]
pub struct Common {
    pub api_access_token: Option<String>,
    #[serde(default)]
    pub default_url: Vec<String>,
    #[serde(default)]
    pub enable_insert: bool,
    #[serde(default)]
    pub insert_url: Vec<String>,
    #[serde(default)]
    pub prepend_insert_url: bool,
    #[serde(default)]
    pub sort: bool,
    pub schema: Option<String>,
    pub clash_rule_base: Option<String>,
    pub surge_rule_base: Option<String>,
}

#[derive(Debug, Deserialize, Default)]
pub struct NodePref {
    pub udp: Option<bool>,
    pub tfo: Option<bool>,
    #[serde(rename = "skip-cert-verify")]
    pub skip_cert_verify: Option<bool>,
}

#[derive(Debug, Deserialize)]
pub struct GroupImport {
    pub import: String,
}

#[derive(Debug, Deserialize)]
pub struct Ruleset {
    #[serde(default)]
    pub enabled: bool,
}

#[derive(Debug, Deserialize)]
pub struct RulesetImport {
    pub import: String,
}

#[derive(Debug, Deserialize)]
pub struct Server {
    pub listen: String,
    pub port: u16,
}

#[derive(Debug, Deserialize)]
pub struct ManagedConfig {
    #[serde(default)]
    pub write_managed_config: bool,
    #[serde(default, alias = "managed_config_prefix")]
    pub base_url: Option<String>,
    #[serde(default = "default_managed_config_interval", alias = "config_update_interval")]
    pub interval: u64,
    #[serde(default = "default_managed_config_strict", alias = "config_update_strict")]
    pub strict: bool,
}

impl Default for ManagedConfig {
    fn default() -> Self {
        Self {
            write_managed_config: false,
            base_url: None,
            interval: default_managed_config_interval(),
            strict: default_managed_config_strict(),
        }
    }
}

fn default_managed_config_interval() -> u64 {
    86_400
}

fn default_managed_config_strict() -> bool {
    false
}

#[derive(Debug, Deserialize, Clone)]
pub struct NetworkConfig {
    #[serde(default = "default_network_enable")]
    pub enable: bool,
    #[serde(default = "default_network_dir")]
    pub dir: String,
    #[serde(default = "default_network_ttl_seconds")]
    pub ttl_seconds: u64,
    #[serde(default)]
    pub allowed_domain: Vec<String>,
}

impl Default for NetworkConfig {
    fn default() -> Self {
        Self {
            enable: default_network_enable(),
            dir: default_network_dir(),
            ttl_seconds: default_network_ttl_seconds(),
            allowed_domain: Vec::new(),
        }
    }
}

fn default_network_enable() -> bool {
    true
}

fn default_network_dir() -> String {
    "conf/cache".to_string()
}

fn default_network_ttl_seconds() -> u64 {
    86_400
}

pub fn load_pref(path: impl AsRef<Path>) -> Result<Pref> {
    let path = path.as_ref();
    let text = fs::read_to_string(path)
        .with_context(|| format!("failed to read pref file {}", path.display()))?;
    let pref: Pref = toml::from_str(&text)
        .with_context(|| format!("failed to parse pref file {}", path.display()))?;
    Ok(pref)
}
