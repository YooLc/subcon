use anyhow::Result;
use serde_json::{Map as JsonMap, Value};

use super::Exporter;
use crate::schema::TargetSchema;

pub struct ClashExporter;

impl Exporter for ClashExporter {
    fn target(&self) -> &'static str {
        "clash"
    }

    fn render(
        &self,
        protocol: &str,
        _target_schema: &TargetSchema,
        _normalized: &JsonMap<String, Value>,
        rendered: Value,
    ) -> Result<Value> {
        match protocol {
            _ => Ok(rendered),
        }
    }
}
