use anyhow::{Result, bail};
use serde_json::{Map as JsonMap, Value};

use super::ProtocolModule;

pub struct TrojanModule;

impl ProtocolModule for TrojanModule {
    fn protocol(&self) -> &'static str {
        "trojan"
    }

    fn validate(&self, normalized: &JsonMap<String, Value>) -> Result<()> {
        if let Some(port) = normalized.get("port").and_then(|v| v.as_i64()) {
            if !(1..=65535).contains(&port) {
                bail!("trojan port out of range: {}", port);
            }
        }
        Ok(())
    }
}
