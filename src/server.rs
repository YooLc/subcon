use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::Arc,
};

use anyhow::{Context, Result};
use axum::{
    extract::{Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::get,
    Json, Router,
};
use serde::ser::SerializeMap;
use serde::Deserialize;
use serde::Serialize;
use serde_json::{Map as JsonMap, Value};
use serde_saphyr as serde_yaml;
use serde_saphyr::FlowMap;
use tokio::net::TcpListener;
use tracing::{info, warn};
use tower_http::classify::ServerErrorsFailureClass;
use tower_http::trace::TraceLayer;

use crate::config::{load_pref, Pref};
use crate::groups;
use crate::proxy;
use crate::rules;
use crate::schema::SchemaRegistry;

pub async fn run() -> Result<()> {
    let pref = Arc::new(load_pref("conf/pref.toml")?);
    let registry = Arc::new(SchemaRegistry::with_builtin("schema")?);

    let mut targets: HashMap<String, Arc<dyn TargetRenderer>> = HashMap::new();
    targets.insert("clash".to_string(), Arc::new(ClashRenderer {}));
    targets.insert(
        "surge".to_string(),
        Arc::new(NotImplementedRenderer { name: "surge" }),
    );

    let state = AppState {
        pref,
        registry,
        targets,
    };

    let app = Router::new()
        .route("/sub", get(handle_sub))
        .fallback(handle_404)
        .layer(
            TraceLayer::new_for_http()
                .make_span_with(|req: &axum::http::Request<_>| {
                    tracing::info_span!(
                        "http_request",
                        method = %req.method(),
                        version = ?req.version()
                    )
                })
                .on_request(|req: &axum::http::Request<_>, _span: &tracing::Span| {
                    info!(uri = %req.uri(), "incoming request");
                })
                .on_response(
                    |res: &axum::http::Response<_>, latency: std::time::Duration, _span: &tracing::Span| {
                        let status = res.status();
                        if status.is_client_error() || status.is_server_error() {
                            warn!(status = %status, latency_ms = latency.as_millis(), "http response");
                        } else {
                            info!(status = %status, latency_ms = latency.as_millis(), "http response");
                        }
                    },
                )
                .on_failure(
                    |failure_class: ServerErrorsFailureClass,
                     latency: std::time::Duration,
                     _span: &tracing::Span| {
                        match failure_class {
                            ServerErrorsFailureClass::StatusCode(status) => {
                                warn!(status = %status, latency_ms = latency.as_millis(), "http failure");
                            }
                            ServerErrorsFailureClass::Error(error) => {
                                warn!(error = %error, latency_ms = latency.as_millis(), "http failure");
                            }
                        }
                    },
                ),
        )
        .with_state(state.clone());

    let listen_addr = format!(
        "{}:{}",
        state.pref.server.listen, state.pref.server.port
    );
    info!("binding subscription server to {listen_addr}");
    let listener = TcpListener::bind(&listen_addr)
        .await
        .with_context(|| format!("failed to bind {listen_addr}"))?;
    info!("server started on {listen_addr}");
    axum::serve(listener, app).await?;
    Ok(())
}

async fn handle_404(uri: axum::http::Uri) -> impl IntoResponse {
    warn!(uri = %uri, "unmatched route");
    (StatusCode::NOT_FOUND, "not found")
}

#[derive(Clone)]
struct AppState {
    pref: Arc<Pref>,
    registry: Arc<SchemaRegistry>,
    targets: HashMap<String, Arc<dyn TargetRenderer>>,
}

#[derive(Debug, Deserialize)]
struct SubQuery {
    target: String,
    token: Option<String>,
}

async fn handle_sub(
    State(state): State<AppState>,
    Query(params): Query<SubQuery>,
) -> Result<Response, ApiError> {
    let renderer = match state.targets.get(&params.target) {
        Some(r) => r,
        None => {
            warn!(target = %params.target, "unsupported target");
            return Err(ApiError::new(
                StatusCode::BAD_REQUEST,
                format!("unsupported target {}", params.target),
            ));
        }
    };

    let include_insert = params
        .token
        .as_ref()
        .zip(state.pref.common.api_access_token.as_ref())
        .map(|(provided, expected)| provided == expected)
        .unwrap_or(false);

    info!(
        target = %params.target,
        include_insert,
        "handling /sub request"
    );

    let body = renderer.render(RenderArgs {
        state: &state,
        include_insert,
    })?;

    Ok((
        StatusCode::OK,
        [(
            axum::http::header::CONTENT_TYPE,
            "text/yaml; charset=utf-8",
        )],
        body,
    )
        .into_response())
}

struct RenderArgs<'a> {
    state: &'a AppState,
    include_insert: bool,
}

trait TargetRenderer: Send + Sync {
    fn render(&self, args: RenderArgs<'_>) -> Result<String, ApiError>;
}

struct NotImplementedRenderer {
    name: &'static str,
}

impl TargetRenderer for NotImplementedRenderer {
    fn render(&self, _args: RenderArgs<'_>) -> Result<String, ApiError> {
        Err(ApiError::new(
            StatusCode::NOT_IMPLEMENTED,
            format!("target `{}` not implemented yet", self.name),
        ))
    }
}

struct ClashRenderer;

impl TargetRenderer for ClashRenderer {
    fn render(&self, args: RenderArgs<'_>) -> Result<String, ApiError> {
        render_clash(args).map_err(ApiError::internal)
    }
}

fn render_clash(args: RenderArgs<'_>) -> Result<String> {
    let pref = &args.state.pref;
    let registry = &args.state.registry;

    let base_path = Path::new("conf").join(
        pref.common
            .clash_rule_base
            .as_deref()
            .unwrap_or("base/clash.yml"),
    );
    let base_text = std::fs::read_to_string(&base_path)
        .with_context(|| format!("failed to read base config {}", base_path.display()))?;
    let mut base = serde_yaml::from_str::<Value>(&base_text)
        .with_context(|| format!("failed to parse base config {}", base_path.display()))?
        .as_object()
        .cloned()
        .context("base clash config must be a YAML map")?;

    base.remove("proxies");
    base.remove("proxy-groups");
    base.remove("rules");

    let profiles = gather_profile_paths(pref, args.include_insert)?;
    let proxies = proxy::load_from_paths(registry, profiles)
        .context("failed to load proxies from profiles")?;
    info!(count = proxies.len(), "proxies loaded for clash render");

    let clash_proxies: Vec<FlowMap<ProxyForYaml>> = proxies
        .iter()
        .map(|p| {
            let rendered = p.to_target(registry, "clash")?;
            let map = rendered
                .as_object()
                .cloned()
                .context("clash proxy must render to a map")?;
            Ok(FlowMap(ProxyForYaml::new(map)))
        })
        .collect::<Result<_>>()?;

    let group_specs = load_group_specs_from_pref(pref)?;
    let proxy_groups = groups::build_groups(&group_specs, &proxies)
        .context("failed to build proxy groups")?;

    let clash_groups: Vec<Value> = proxy_groups
        .iter()
        .map(crate::export::clash::render_proxy_group)
        .collect();
    info!(groups = clash_groups.len(), "proxy groups built");

    let rules = load_rules_from_pref(pref)?;
    let rendered_rules: Vec<Value> = rules
        .iter()
        .map(|r| Value::String(r.render()))
        .collect();
    info!(rules = rendered_rules.len(), "rules rendered");

    let output = ClashOutput {
        base,
        proxies: clash_proxies,
        proxy_groups: clash_groups,
        rules: rendered_rules,
    };

    let final_yaml = serde_yaml::to_string(&output)?;
    Ok(final_yaml)
}

fn gather_profile_paths(pref: &Pref, include_insert: bool) -> Result<Vec<PathBuf>> {
    let mut paths = Vec::new();
    let base_dir = Path::new("conf");

    let defaults: Vec<PathBuf> = if pref.common.default_url.is_empty() {
        proxy::collect_profile_files(&base_dir.join("profiles"))?
    } else {
        pref.common
            .default_url
            .iter()
            .map(|p| base_dir.join(p))
            .collect()
    };

    let mut inserts: Vec<PathBuf> = Vec::new();
    if include_insert && pref.common.enable_insert {
        inserts = pref
            .common
            .insert_url
            .iter()
            .map(|p| base_dir.join(p))
            .collect();
    }

    if pref.common.prepend_insert_url {
        paths.extend(inserts.clone());
        paths.extend(defaults);
    } else {
        paths.extend(defaults);
        paths.extend(inserts.clone());
    }

    if include_insert && pref.common.enable_insert && inserts.is_empty() {
        warn!("insert enabled but no insert_url provided");
    }

    Ok(paths)
}

fn load_group_specs_from_pref(pref: &Pref) -> Result<Vec<groups::GroupSpec>> {
    let base_dir = Path::new("conf");
    let mut specs = Vec::new();
    for entry in &pref.custom_groups {
        let path = base_dir.join(&entry.import);
        let mut loaded = groups::load_group_specs(path)?;
        specs.append(&mut loaded);
    }
    Ok(specs)
}

fn load_rules_from_pref(pref: &Pref) -> Result<Vec<rules::Rule>> {
    let mut all_rules = Vec::new();
    if pref.ruleset.as_ref().map(|r| r.enabled).unwrap_or(false) {
        let base_dir = Path::new("conf");
        for entry in &pref.rulesets {
            let path = base_dir.join(&entry.import);
            let mut loaded = rules::load_rules(&path, base_dir)?;
            all_rules.append(&mut loaded);
        }
    }
    Ok(all_rules)
}

#[derive(Serialize)]
struct ClashOutput {
    #[serde(flatten)]
    base: JsonMap<String, Value>,
    proxies: Vec<FlowMap<ProxyForYaml>>,
    #[serde(rename = "proxy-groups")]
    proxy_groups: Vec<Value>,
    rules: Vec<Value>,
}

#[derive(Clone)]
struct ProxyForYaml {
    map: JsonMap<String, Value>,
}

impl ProxyForYaml {
    fn new(map: JsonMap<String, Value>) -> Self {
        Self { map }
    }
}

impl Serialize for ProxyForYaml {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        let mut map_ser = serializer.serialize_map(Some(self.map.len()))?;
        for key in ["name", "type", "server", "password"] {
            if let Some(val) = self.map.get(key) {
                map_ser.serialize_entry(key, val)?;
            }
        }
        for (k, v) in &self.map {
            if matches!(k.as_str(), "name" | "type" | "server" | "password") {
                continue;
            }
            map_ser.serialize_entry(k, v)?;
        }
        map_ser.end()
    }
}

struct ApiError {
    status: StatusCode,
    message: String,
}

impl ApiError {
    fn new(status: StatusCode, message: impl Into<String>) -> Self {
        Self {
            status,
            message: message.into(),
        }
    }

    fn internal(err: anyhow::Error) -> Self {
        let msg = format!("{err:?}");
        warn!(error = %msg, "internal error during render");
        Self {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            message: msg,
        }
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        if self.status.is_client_error() {
            warn!(status = %self.status, message = %self.message, "client error");
        }
        let body = Json(serde_json::json!({
            "error": self.message,
        }));
        (self.status, body).into_response()
    }
}
