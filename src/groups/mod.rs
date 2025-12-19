use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::Path;

use anyhow::{Context, Result, bail};
use fancy_regex::Regex;
use serde::Deserialize;

use crate::proxy::Proxy;

#[derive(Debug, Deserialize)]
struct GroupsToml {
    #[serde(default)]
    groups: Vec<GroupSpec>,
}

#[derive(Debug, Deserialize, Clone)]
pub struct GroupSpec {
    pub name: String,
    #[serde(rename = "type")]
    pub group_type: String,
    #[serde(default)]
    pub rule: Vec<String>,
    pub url: Option<String>,
    pub interval: Option<u64>,
}

#[derive(Debug, Clone)]
pub struct ProxyGroup {
    pub name: String,
    pub group_type: String,
    pub proxies: Vec<String>,
    pub url: Option<String>,
    pub interval: Option<u64>,
}

pub fn load_group_specs(path: impl AsRef<Path>) -> Result<Vec<GroupSpec>> {
    let path = path.as_ref();
    let content = fs::read_to_string(path)
        .with_context(|| format!("failed to read groups file {}", path.display()))?;
    let parsed: GroupsToml =
        toml::from_str(&content).with_context(|| format!("failed to parse {}", path.display()))?;
    Ok(parsed.groups)
}

pub fn build_groups(specs: &[GroupSpec], proxies: &[Proxy]) -> Result<Vec<ProxyGroup>> {
    let proxy_names: Vec<String> = proxies.iter().map(|p| p.name.clone()).collect();
    let proxy_lookup: HashSet<String> = proxy_names.iter().cloned().collect();
    let spec_map: HashMap<String, GroupSpec> =
        specs.iter().map(|s| (s.name.clone(), s.clone())).collect();

    let mut groups = Vec::new();
    let mut resolved_names = HashSet::new();

    let mut allowed_groups: HashSet<String> = spec_map.keys().cloned().collect::<HashSet<String>>();
    allowed_groups.insert("DIRECT".to_string());
    allowed_groups.insert("REJECT".to_string());

    for spec in specs {
        if resolved_names.contains(&spec.name) {
            continue;
        }
        let group = build_group(spec, &allowed_groups, &proxy_names, &proxy_lookup)?;
        resolved_names.insert(group.name.clone());
        groups.push(group);
    }

    Ok(groups)
}

fn build_group(
    spec: &GroupSpec,
    allowed_groups: &HashSet<String>,
    proxy_names: &[String],
    proxy_lookup: &HashSet<String>,
) -> Result<ProxyGroup> {
    let mut proxies = Vec::new();
    let mut seen = HashSet::new();

    for rule in &spec.rule {
        if let Some(target_group) = rule.strip_prefix("[]") {
            let target = target_group.trim();
            if target.is_empty() {
                bail!("empty group reference in `{}`", spec.name);
            }
            if !allowed_groups.contains(target) {
                bail!(
                    "group `{}` references unknown group `{}`",
                    spec.name,
                    target
                );
            }
            push_unique(&mut proxies, &mut seen, rule);
            continue;
        }

        if proxy_lookup.contains(rule) {
            push_unique(&mut proxies, &mut seen, rule);
            continue;
        }

        let pattern = Regex::new(rule).with_context(|| {
            format!(
                "failed to compile regex `{}` for group `{}`",
                rule, spec.name
            )
        })?;

        let mut matches = Vec::new();
        for name in proxy_names {
            match pattern.is_match(name) {
                Ok(true) => matches.push(name.clone()),
                Ok(false) => {}
                Err(err) => {
                    return Err(err).with_context(|| {
                        format!(
                            "failed to apply regex `{}` in group `{}` against proxy `{}`",
                            rule, spec.name, name
                        )
                    });
                }
            }
        }

        if !matches.is_empty() {
            push_all_unique(&mut proxies, &mut seen, &matches);
        }
    }

    Ok(ProxyGroup {
        name: spec.name.clone(),
        group_type: spec.group_type.clone(),
        proxies,
        url: spec.url.clone(),
        interval: spec.interval,
    })
}

fn push_unique(out: &mut Vec<String>, seen: &mut HashSet<String>, value: &str) {
    if seen.insert(value.to_string()) {
        out.push(value.to_string());
    }
}

fn push_all_unique(out: &mut Vec<String>, seen: &mut HashSet<String>, values: &[String]) {
    for value in values {
        push_unique(out, seen, value);
    }
}
