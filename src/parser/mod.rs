use anyhow::Result;
use serde_json::Value;

pub mod clash;

/// Parses a target-specific config format into a generic serde_json::Value.
#[allow(dead_code)]
pub trait Parser: Send + Sync {
    /// Target name this parser understands, e.g. `clash`.
    fn target(&self) -> &'static str;

    /// Parse input text into a JSON Value.
    fn parse(&self, input: &str) -> Result<Value>;
}
