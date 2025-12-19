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
    pub server: Server,
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
    pub clash_rule_base: Option<String>,
    #[allow(dead_code)]
    pub surge_rule_base: Option<String>,
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

pub fn load_pref(path: impl AsRef<Path>) -> Result<Pref> {
    let path = path.as_ref();
    let text = fs::read_to_string(path)
        .with_context(|| format!("failed to read pref file {}", path.display()))?;
    let pref: Pref = toml::from_str(&text)
        .with_context(|| format!("failed to parse pref file {}", path.display()))?;
    Ok(pref)
}
