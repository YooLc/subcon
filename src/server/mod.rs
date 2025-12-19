use std::{collections::HashMap, path::PathBuf, sync::Arc};

use anyhow::{Context, Result};
use axum::{
    Json, Router,
    extract::{Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::get,
};
use clap::Parser;
use serde::Deserialize;
use tokio::net::TcpListener;
use tower_http::classify::ServerErrorsFailureClass;
use tower_http::trace::TraceLayer;
use tracing::{info, warn};

use crate::config::{Pref, load_pref};
use crate::schema::SchemaRegistry;
use crate::server::util::resolve_path;

mod clash;
mod surge;
mod util;

#[derive(Parser, Debug)]
#[command(name = "subcon")]
#[command(author = "")]
#[command(version = env!("CARGO_PKG_VERSION"))]
#[command(about = "Subscription converter", long_about = None)]
struct Cli {
    /// Path to pref.toml
    #[arg(long, default_value = "conf/pref.toml")]
    pref: String,
}

pub async fn run() -> Result<()> {
    let args = Cli::parse();
    let pref_path = PathBuf::from(&args.pref);
    let base_dir = PathBuf::from(".");

    let pref = Arc::new(load_pref(&pref_path)?);
    let schema_rel = pref
        .common
        .schema
        .as_deref()
        .ok_or_else(|| anyhow::anyhow!("`common.schema` must be set in pref.toml"))?;
    let schema_path = resolve_path(&base_dir, schema_rel);

    let registry = Arc::new(SchemaRegistry::with_builtin(&schema_path)?);

    let mut targets: HashMap<String, Arc<dyn TargetRenderer>> = HashMap::new();
    targets.insert("clash".to_string(), Arc::new(clash::ClashRenderer));
    targets.insert("surge".to_string(), Arc::new(surge::SurgeRenderer));

    let state = AppState {
        pref,
        registry,
        targets,
        base_dir,
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
                        version = ?req.version(),
                        remote = %req
                            .headers()
                            .get("X-Forwarded-For")
                            .and_then(|v| v.to_str().ok())
                            .map(|s| s.to_string())
                            .or_else(|| req
                                .extensions()
                                .get::<std::net::SocketAddr>()
                                .map(|addr| addr.ip().to_string()))
                            .unwrap_or_else(|| "-".to_string())
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

    let listen_addr = format!("{}:{}", state.pref.server.listen, state.pref.server.port);
    info!("binding subscription server to {listen_addr}");
    let listener = TcpListener::bind(&listen_addr)
        .await
        .context(format!("failed to bind {listen_addr}"))?;
    info!("server started on {listen_addr}");
    axum::serve(listener, app).await?;
    Ok(())
}

#[derive(Clone)]
pub struct AppState {
    pub pref: Arc<Pref>,
    pub registry: Arc<SchemaRegistry>,
    pub targets: HashMap<String, Arc<dyn TargetRenderer>>,
    pub base_dir: PathBuf,
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
        [(axum::http::header::CONTENT_TYPE, "text/yaml; charset=utf-8")],
        body,
    )
        .into_response())
}

async fn handle_404(uri: axum::http::Uri) -> impl IntoResponse {
    warn!(uri = %uri, "unmatched route");
    (StatusCode::NOT_FOUND, "not found")
}

pub struct RenderArgs<'a> {
    pub state: &'a AppState,
    pub include_insert: bool,
}

pub trait TargetRenderer: Send + Sync {
    fn render(&self, args: RenderArgs<'_>) -> Result<String, ApiError>;
}

pub struct ApiError {
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
