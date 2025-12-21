use std::{
    fmt,
    fs,
    path::{Path, PathBuf},
};

use anyhow::{Context, Result, anyhow};
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
    pub ruleset: RulesetRef,
}

#[derive(Debug, Deserialize)]
#[serde(untagged)]
pub enum RulesetRef {
    Single(String),
    Multiple(Vec<String>),
}

impl RulesetRef {
    fn into_vec(self) -> Vec<String> {
        match self {
            Self::Single(value) => vec![value],
            Self::Multiple(values) => values,
        }
    }
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
    Url(String),
}

impl RuleSource {
    fn parse(raw: &str, base_dir: &Path) -> Self {
        if let Some(inline) = raw.strip_prefix("[]") {
            return Self::Inline(inline.to_string());
        }

        if raw.starts_with("http://") || raw.starts_with("https://") {
            return Self::Url(raw.to_string());
        }

        let path = PathBuf::from(raw);
        if path.is_absolute() {
            Self::File(path)
        } else {
            Self::File(base_dir.join(path))
        }
    }
}

#[allow(dead_code)]
pub fn load_rules(
    rulesets_path: impl AsRef<Path>,
    rules_base_dir: impl AsRef<Path>,
) -> Result<Vec<Rule>> {
    load_rules_with_fetcher(rulesets_path, rules_base_dir, |url| {
        Err(anyhow!("remote ruleset not supported: {url}"))
    })
}

pub fn load_rules_with_fetcher<F>(
    rulesets_path: impl AsRef<Path>,
    rules_base_dir: impl AsRef<Path>,
    fetcher: F,
) -> Result<Vec<Rule>>
where
    F: Fn(&str) -> Result<String>,
{
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
        for entry in ruleset.ruleset.into_vec() {
            let ruleset_trimmed = entry.trim();
            if ruleset_trimmed.eq_ignore_ascii_case("[]FINAL") {
                final_groups.push(group.clone());
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
                RuleSource::Url(url) => {
                    let text = fetcher(&url)
                        .with_context(|| format!("failed to fetch ruleset {}", url))?;
                    for (idx, line) in text.lines().enumerate() {
                        let line_no = idx + 1;
                        match parse_rule_line(line, &group) {
                            Ok(Some(rule)) => rules.push(rule),
                            Ok(None) => {}
                            Err(err) => {
                                return Err(err).with_context(|| {
                                    format!(
                                        "failed to parse rule at {}:{} (group `{}`)",
                                        url, line_no, group
                                    )
                                })
                            }
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

const IP_RULE_TYPES: [&str; 9] = [
    "IP-CIDR",
    "IP-CIDR6",
    "IP-SUFFIX",
    "IP-ASN",
    "GEOIP",
    "SRC-GEOIP",
    "SRC-IP-ASN",
    "SRC-IP-CIDR",
    "SRC-IP-SUFFIX",
];

const DOMAIN_RULE_TYPES: [&str; 6] = [
    "DOMAIN",
    "DOMAIN-SUFFIX",
    "DOMAIN-KEYWORD",
    "DOMAIN-WILDCARD",
    "DOMAIN-REGEX",
    "GEOSITE",
];

pub fn reorder_rules_domain_before_ip(rules: &[Rule]) -> Vec<Rule> {
    let mut ip_rules = Vec::new();
    let mut domain_rules = Vec::new();

    for rule in rules {
        if is_ip_rule(rule) {
            ip_rules.push(rule.clone());
        } else if is_domain_rule(rule) {
            domain_rules.push(rule.clone());
        }
    }

    if ip_rules.is_empty() || domain_rules.is_empty() {
        return rules.to_vec();
    }

    let mut ip_iter = ip_rules.into_iter();
    let mut domain_iter = domain_rules.into_iter();
    let mut output = Vec::with_capacity(rules.len());

    for rule in rules {
        if is_ip_rule(rule) || is_domain_rule(rule) {
            if let Some(next) = domain_iter.next() {
                output.push(next);
            } else if let Some(next) = ip_iter.next() {
                output.push(next);
            } else {
                output.push(rule.clone());
            }
        } else {
            output.push(rule.clone());
        }
    }

    output
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

    let parts = split_rule_parts(trimmed);
    if parts.is_empty() || parts[0].is_empty() {
        return Ok(None);
    }

    let raw_type = &parts[0];
    if !is_supported_rule_type(raw_type) {
        warn!(rule_type = %raw_type, "unsupported rule type skipped");
        return Ok(None);
    }
    let rule_type = RuleType::new(raw_type);
    let mut flags = RuleFlags::default();
    let mut content_parts: Vec<String> = parts.iter().skip(1).cloned().collect();
    while let Some(last) = content_parts.last() {
        if last.is_empty() {
            content_parts.pop();
            continue;
        }
        match last.to_ascii_lowercase().as_str() {
            "no-resolve" => {
                flags.no_resolve = true;
                content_parts.pop();
            }
            _ => break,
        }
    }

    let content = if content_parts.is_empty() {
        None
    } else {
        Some(content_parts.join(","))
    };

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

fn split_rule_parts(line: &str) -> Vec<String> {
    let mut parts = Vec::new();
    let mut current = String::new();
    let mut depth = 0usize;

    for ch in line.chars() {
        match ch {
            '(' => {
                depth = depth.saturating_add(1);
                current.push(ch);
            }
            ')' => {
                if depth > 0 {
                    depth -= 1;
                }
                current.push(ch);
            }
            ',' if depth == 0 => {
                parts.push(current.trim().to_string());
                current.clear();
            }
            _ => current.push(ch),
        }
    }

    parts.push(current.trim().to_string());
    parts
}

fn is_ip_rule(rule: &Rule) -> bool {
    IP_RULE_TYPES
        .iter()
        .any(|ty| ty.eq_ignore_ascii_case(&rule.rule_type.0))
}

fn is_domain_rule(rule: &Rule) -> bool {
    DOMAIN_RULE_TYPES
        .iter()
        .any(|ty| ty.eq_ignore_ascii_case(&rule.rule_type.0))
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

    #[test]
    fn reorder_domain_before_ip_preserves_others() {
        let rule_set = Rule {
            rule_type: RuleType::new("RULE-SET"),
            content: Some("ruleset".to_string()),
            group: "G".to_string(),
            flags: RuleFlags::default(),
        };
        let domain = Rule {
            rule_type: RuleType::new("DOMAIN-SUFFIX"),
            content: Some("example.com".to_string()),
            group: "G".to_string(),
            flags: RuleFlags::default(),
        };
        let ip = Rule {
            rule_type: RuleType::new("IP-CIDR"),
            content: Some("1.1.1.1/32".to_string()),
            group: "G".to_string(),
            flags: RuleFlags::default(),
        };

        let rules = vec![ip.clone(), rule_set.clone(), domain.clone()];
        let reordered = reorder_rules_domain_before_ip(&rules);

        assert_eq!(reordered[0], domain);
        assert_eq!(reordered[1], rule_set);
        assert_eq!(reordered[2], ip);
    }

    #[test]
    fn parse_rule_with_nested_commas() {
        let rule = parse_rule_line(
            "AND,((DOMAIN-KEYWORD,example),(DOMAIN-SUFFIX,example.com))",
            "G",
        )
        .unwrap()
        .unwrap();
        assert_eq!(rule.rule_type.to_string(), "AND");
        assert_eq!(
            rule.content.as_deref(),
            Some("((DOMAIN-KEYWORD,example),(DOMAIN-SUFFIX,example.com))")
        );
        assert_eq!(
            rule.render(),
            "AND,((DOMAIN-KEYWORD,example),(DOMAIN-SUFFIX,example.com)),G"
        );
    }
}
