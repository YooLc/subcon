use anyhow::Result;
use serde_json::{Map as JsonMap, Value};

use crate::uri;

use super::Parser;

pub struct UriParser;

impl Parser for UriParser {
    fn target(&self) -> &'static str {
        "uri"
    }

    fn parse(&self, input: &str) -> Result<Value> {
        let proxies = uri::parse_uri_lines(input)?;
        let mut map = JsonMap::new();
        map.insert("proxies".to_string(), Value::Array(proxies));
        Ok(Value::Object(map))
    }
}
