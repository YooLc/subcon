use std::collections::HashSet;
use std::path::{Path, PathBuf};

use anyhow::{Context, Result, anyhow, bail};
use reqwest::Url;
use tracing::warn;

use crate::config::Pref;
use crate::network::Network;
use crate::{groups, rules};

pub fn resolve_path(base_dir: &Path, input: &str) -> PathBuf {
    let candidate = PathBuf::from(input);
    if candidate.is_absolute() {
        candidate
    } else {
        base_dir.join(candidate)
    }
}

/// Collect profile paths in order with de-duplication and optional inserts.
pub fn gather_profile_paths(
    pref: &Pref,
    include_insert: bool,
    base_dir: &Path,
) -> Result<Vec<PathBuf>> {
    let mut paths = Vec::new();
    let mut seen = HashSet::new();

    let defaults: Vec<_> = pref
        .common
        .default_url
        .iter()
        .map(|p| resolve_path(base_dir, p))
        .collect();

    let mut inserts: Vec<_> = Vec::new();
    if include_insert && pref.common.enable_insert {
        inserts = pref
            .common
            .insert_url
            .iter()
            .map(|p| resolve_path(base_dir, p))
            .collect();
    }

    if pref.common.prepend_insert_url {
        paths.extend(inserts.clone());
        paths.extend(defaults);
    } else {
        paths.extend(defaults);
        paths.extend(inserts.clone());
    }

    if include_insert && pref.common.enable_insert && inserts.is_empty() {
        warn!("insert enabled but no insert_url provided");
    }

    let mut deduped = Vec::new();
    for p in paths {
        if seen.insert(p.clone()) {
            deduped.push(p);
        }
    }

    Ok(deduped)
}

/// Collect insert profile paths with de-duplication.
pub fn gather_insert_paths(pref: &Pref, base_dir: &Path) -> Vec<PathBuf> {
    let mut paths = Vec::new();
    let mut seen = HashSet::new();

    for p in &pref.common.insert_url {
        let path = resolve_path(base_dir, p);
        if seen.insert(path.clone()) {
            paths.push(path);
        }
    }

    paths
}

/// Apply node_pref overrides to proxies if the schema supports those fields.
pub fn apply_node_pref(
    pref: &Pref,
    registry: &crate::schema::SchemaRegistry,
    proxies: &mut [crate::proxy::Proxy],
) {
    let np = &pref.node_pref;
    for proxy in proxies {
        if let Some(schema) = registry.get(&proxy.protocol) {
            let fields = &schema.fields;
            if let Some(val) = np.udp {
                if fields.contains_key("udp") {
                    proxy
                        .values
                        .insert("udp".to_string(), serde_json::Value::Bool(val));
                }
            }
            if let Some(val) = np.tfo {
                if fields.contains_key("tfo") {
                    proxy
                        .values
                        .insert("tfo".to_string(), serde_json::Value::Bool(val));
                }
            }
            if let Some(val) = np.skip_cert_verify {
                if fields.contains_key("skip-cert-verify") {
                    proxy
                        .values
                        .insert("skip-cert-verify".to_string(), serde_json::Value::Bool(val));
                }
            }
        }
    }
}

pub fn load_group_specs_from_pref(pref: &Pref, base_dir: &Path) -> Result<Vec<groups::GroupSpec>> {
    let mut specs = Vec::new();
    for entry in &pref.custom_groups {
        let path = resolve_path(base_dir, &entry.import);
        let mut loaded = groups::load_group_specs(path)?;
        specs.append(&mut loaded);
    }
    Ok(specs)
}

const RULESET_USER_AGENTS: [&str; 1] = [concat!("subcon/", env!("CARGO_PKG_VERSION"))];

pub fn load_rules_from_pref(
    pref: &Pref,
    network: &Network,
    base_dir: &Path,
) -> Result<Vec<rules::Rule>> {
    let mut all_rules = Vec::new();
    if pref.ruleset.as_ref().map(|r| r.enabled).unwrap_or(false) {
        for entry in &pref.rulesets {
            let path = resolve_path(base_dir, &entry.import);
            let mut loaded = rules::load_rules_with_fetcher(&path, base_dir, |url| {
                fetch_ruleset_text(network, url)
            })?;
            all_rules.append(&mut loaded);
        }
    }
    Ok(rules::reorder_rules_domain_before_ip(&all_rules))
}

fn fetch_ruleset_text(network: &Network, url: &str) -> Result<String> {
    let parsed = Url::parse(url)
        .with_context(|| format!("invalid ruleset url {url}"))?;
    if !matches!(parsed.scheme(), "http" | "https") {
        bail!("unsupported ruleset url scheme {}", parsed.scheme());
    }

    let fetch = async {
        network
            .get_or_fetch_with(&parsed, &RULESET_USER_AGENTS, false, |text| {
                Ok(text.to_string())
            })
            .await
    };

    let result = if let Ok(handle) = tokio::runtime::Handle::try_current() {
        tokio::task::block_in_place(|| handle.block_on(fetch))
    } else {
        let runtime = tokio::runtime::Runtime::new()
            .context("failed to create tokio runtime")?;
        runtime.block_on(fetch)
    };

    result
        .map_err(|err| anyhow!(err.to_string()))
        .with_context(|| format!("failed to fetch ruleset {}", url))
}
