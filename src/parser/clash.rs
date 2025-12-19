use anyhow::Result;
use serde_json::Value;

use super::Parser;

pub struct ClashParser;

impl Parser for ClashParser {
    fn target(&self) -> &'static str {
        "clash"
    }

    fn parse(&self, input: &str) -> Result<Value> {
        // Clash configs are YAML; we deserialize straight into serde_json::Value.
        let value = serde_yaml::from_str::<Value>(input)?;
        Ok(value)
    }
}
