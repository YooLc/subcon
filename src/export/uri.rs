use anyhow::Result;
use serde_json::{Map as JsonMap, Value};

use super::Exporter;
use crate::schema::TargetSchema;
use crate::uri::render_uri_line;

pub struct UriExporter;

impl Exporter for UriExporter {
    fn target(&self) -> &'static str {
        "uri"
    }

    fn render(
        &self,
        protocol: &str,
        _target_schema: &TargetSchema,
        normalized: &JsonMap<String, Value>,
        _rendered: Value,
    ) -> Result<Value> {
        let line = render_uri_line(protocol, normalized)?;
        Ok(Value::String(line))
    }
}
