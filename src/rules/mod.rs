use std::{
    fmt,
    fs,
    path::{Path, PathBuf},
};

use anyhow::{Context, Result};
use serde::Deserialize;
use tracing::warn;

#[derive(Debug, Deserialize)]
struct RulesetsToml {
    #[serde(default)]
    rulesets: Vec<RulesetSpec>,
}

#[derive(Debug, Deserialize)]
pub struct RulesetSpec {
    pub group: String,
    pub ruleset: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct RuleFlags {
    pub no_resolve: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RuleType(String);

impl RuleType {
    pub fn new(value: impl Into<String>) -> Self {
        Self(value.into())
    }
}

impl fmt::Display for RuleType {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Rule {
    pub rule_type: RuleType,
    pub content: Option<String>,
    pub group: String,
    pub flags: RuleFlags,
}

impl Rule {
    pub fn render(&self) -> String {
        let mut parts = Vec::new();
        parts.push(self.rule_type.to_string());
        if let Some(content) = &self.content {
            parts.push(content.clone());
        }
        parts.push(self.group.clone());

        if self.flags.no_resolve {
            parts.push("no-resolve".to_string());
        }

        parts.join(",")
    }
}

enum RuleSource {
    Inline(String),
    File(PathBuf),
}

impl RuleSource {
    fn parse(raw: &str, base_dir: &Path) -> Self {
        if let Some(inline) = raw.strip_prefix("[]") {
            return Self::Inline(inline.to_string());
        }

        let path = PathBuf::from(raw);
        if path.is_absolute() {
            Self::File(path)
        } else {
            Self::File(base_dir.join(path))
        }
    }
}

pub fn load_rules(
    rulesets_path: impl AsRef<Path>,
    rules_base_dir: impl AsRef<Path>,
) -> Result<Vec<Rule>> {
    let rulesets_path = rulesets_path.as_ref();
    let rules_base_dir = rules_base_dir.as_ref();

    let content = fs::read_to_string(rulesets_path)
        .with_context(|| format!("failed to read rulesets file {}", rulesets_path.display()))?;
    let parsed: RulesetsToml = toml::from_str(&content)
        .with_context(|| format!("failed to parse {}", rulesets_path.display()))?;

    let mut rules = Vec::new();

    let mut final_groups: Vec<String> = Vec::new();

    for ruleset in parsed.rulesets {
        let group = ruleset.group;
        let ruleset_trimmed = ruleset.ruleset.trim();
        if ruleset_trimmed.eq_ignore_ascii_case("[]FINAL") {
            final_groups.push(group);
            continue;
        }

        let source = RuleSource::parse(ruleset_trimmed, rules_base_dir);
        match source {
            RuleSource::Inline(rule_text) => {
                if let Some(rule) = parse_rule_line(&rule_text, &group)
                    .with_context(|| format!("failed to parse inline rule `{rule_text}`"))?
                {
                    rules.push(rule);
                }
            }
            RuleSource::File(path) => {
                let text = fs::read_to_string(&path)
                    .with_context(|| format!("failed to read ruleset {}", path.display()))?;
                for (idx, line) in text.lines().enumerate() {
                    let line_no = idx + 1;
                    match parse_rule_line(line, &group) {
                        Ok(Some(rule)) => rules.push(rule),
                        Ok(None) => {}
                        Err(err) => {
                            return Err(err).with_context(|| {
                                format!(
                                    "failed to parse rule at {}:{} (group `{}`)",
                                    path.display(),
                                    line_no,
                                    group
                                )
                            })
                        }
                    }
                }
            }
        }
    }

    for group in final_groups {
        rules.push(Rule {
            rule_type: RuleType::new("FINAL"),
            content: None,
            group,
            flags: RuleFlags::default(),
        });
    }

    Ok(rules)
}

fn parse_rule_line(line: &str, group: &str) -> Result<Option<Rule>> {
    let stripped = if let Some(idx) = line.find("//") {
        &line[..idx]
    } else {
        line
    };
    let trimmed = stripped.trim_end();
    let trimmed = trimmed.trim_start();
    if trimmed.is_empty() || trimmed.starts_with('#') {
        return Ok(None);
    }

    let parts: Vec<String> = trimmed.split(',').map(|p| p.trim().to_string()).collect();
    if parts.is_empty() || parts[0].is_empty() {
        return Ok(None);
    }

    let raw_type = &parts[0];
    if !is_supported_rule_type(raw_type) {
        warn!(rule_type = %raw_type, "unsupported rule type skipped");
        return Ok(None);
    }
    let rule_type = RuleType::new(raw_type);
    let content = parts
        .get(1)
        .and_then(|s| if s.is_empty() { None } else { Some(s.clone()) });

    if content.is_none() && parts.len() == 1 {
        // Allow type-only rules like FINAL.
    }

    let mut flags = RuleFlags::default();
    for param in parts.iter().skip(2) {
        if param.is_empty() {
            continue;
        }
        match param.to_ascii_lowercase().as_str() {
            "no-resolve" => flags.no_resolve = true,
            _ => {}
        }
    }

    Ok(Some(Rule {
        rule_type,
        content,
        group: group.to_string(),
        flags,
    }))
}

fn is_supported_rule_type(raw: &str) -> bool {
    match raw.to_ascii_uppercase().as_str() {
        "DOMAIN" |
        "DOMAIN-SUFFIX" |
        "DOMAIN-KEYWORD" |
        "DOMAIN-WILDCARD" |
        "DOMAIN-REGEX" |
        "GEOSITE" |
        "IP-CIDR" |
        "IP-CIDR6" |
        "IP-SUFFIX" |
        "IP-ASN" |
        "GEOIP" |
        "SRC-GEOIP" |
        "SRC-IP-ASN" |
        "SRC-IP-CIDR" |
        "SRC-IP-SUFFIX" |
        "DST-PORT" |
        "SRC-PORT" |
        "IN-PORT" |
        "IN-TYPE" |
        "IN-USER" |
        "IN-NAME" |
        "PROCESS-PATH" |
        "PROCESS-PATH-REGEX" |
        "PROCESS-NAME" |
        "PROCESS-NAME-REGEX" |
        "UID" |
        "NETWORK" |
        "DSCP" |
        "RULE-SET" |
        "AND" |
        "OR" |
        "NOT" |
        "SUB-RULE" |
        "MATCH" => true,
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_rule_with_flag() {
        let rule = parse_rule_line("IP-CIDR,1.1.1.1/32,no-resolve", "Test")
            .unwrap()
            .unwrap();
        assert_eq!(rule.rule_type.to_string(), "IP-CIDR");
        assert_eq!(rule.content.as_deref(), Some("1.1.1.1/32"));
        assert!(rule.flags.no_resolve);
        assert_eq!(rule.render(), "IP-CIDR,1.1.1.1/32,Test,no-resolve");
    }

    #[test]
    fn parse_rule_with_comment() {
        let rule = parse_rule_line("DOMAIN-SUFFIX,example.com // comment here", "G")
            .unwrap()
            .unwrap();
        assert_eq!(rule.rule_type.to_string(), "DOMAIN-SUFFIX");
        assert_eq!(rule.content.as_deref(), Some("example.com"));
        assert_eq!(rule.render(), "DOMAIN-SUFFIX,example.com,G");
    }

    #[test]
    fn parse_type_only_rule() {
        let rule = parse_rule_line("FINAL", "Fallback").unwrap();
        assert!(rule.is_none(), "unsupported rule type should be skipped");
    }
}
