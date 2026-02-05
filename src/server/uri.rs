use anyhow::{Context, Result, anyhow};
use serde_json::Value;
use tracing::info;

use crate::schema::SchemaRegistry;

use super::{ApiError, RenderArgs};

pub struct UriRenderer;

impl super::TargetRenderer for UriRenderer {
    fn render(&self, args: RenderArgs<'_>) -> Result<String, ApiError> {
        render_uri(args).map_err(ApiError::internal)
    }
}

fn render_uri(args: RenderArgs<'_>) -> Result<String> {
    let RenderArgs {
        runtime,
        mut proxies,
        ..
    } = args;
    let pref = &runtime.pref;
    let registry = &runtime.registry;

    super::util::apply_node_pref(pref, registry, &mut proxies);
    proxies.retain(|proxy| !registry.target_not_implemented(&proxy.protocol, "uri"));
    if pref.common.sort {
        proxies.sort_by(|a, b| a.name.cmp(&b.name));
    }
    info!(count = proxies.len(), "proxies loaded for uri render");

    let mut lines = Vec::with_capacity(proxies.len());
    for proxy in &proxies {
        let rendered = render_uri_proxy(registry, proxy)?;
        lines.push(rendered);
    }

    if lines.is_empty() {
        Ok(String::new())
    } else {
        Ok(format!("{}\n", lines.join("\n")))
    }
}

fn render_uri_proxy(
    registry: &SchemaRegistry,
    proxy: &crate::proxy::Proxy,
) -> Result<String> {
    let rendered = registry
        .convert(&proxy.protocol, "uri", &proxy.values)
        .with_context(|| format!("failed to render uri proxy {}", proxy.name))?;
    match rendered {
        Value::String(s) => Ok(s),
        other => Err(anyhow!("uri exporter must return string, got {other}")),
    }
}
