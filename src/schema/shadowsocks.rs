use anyhow::{Result, bail};
use serde_json::{Map as JsonMap, Value};

use super::ProtocolModule;

pub struct ShadowsocksModule;

impl ProtocolModule for ShadowsocksModule {
    fn protocol(&self) -> &'static str {
        "shadowsocks"
    }

    fn validate(&self, normalized: &JsonMap<String, Value>) -> Result<()> {
        if let Some(port) = normalized.get("port").and_then(|v| v.as_i64()) {
            if !(1..=65535).contains(&port) {
                bail!("shadowsocks port out of range: {port}");
            }
        }

        if let Some(version) = normalized
            .get("udp-over-tcp-version")
            .and_then(|v| v.as_i64())
        {
            if version <= 0 {
                bail!("shadowsocks udp-over-tcp-version must be positive, got {version}");
            }
        }

        Ok(())
    }
}
