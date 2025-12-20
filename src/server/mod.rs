use std::{collections::HashMap, path::PathBuf, sync::Arc, time::Duration};

use anyhow::{Context, Result};
use axum::{
    Json, Router,
    extract::{Query, State},
    http::{StatusCode, Uri},
    response::{IntoResponse, Response},
    routing::get,
};
use clap::Parser;
use reqwest::header::USER_AGENT;
use serde::Deserialize;
use tokio::net::TcpListener;
use tower_http::classify::ServerErrorsFailureClass;
use tower_http::trace::TraceLayer;
use tracing::{info, warn};

use crate::config::{Pref, load_pref};
use crate::proxy;
use crate::schema::SchemaRegistry;
use crate::server::util::{gather_insert_paths, gather_profile_paths, resolve_path};

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
    let http_client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .context("failed to build http client")?;

    let mut targets: HashMap<String, Arc<dyn TargetRenderer>> = HashMap::new();
    targets.insert("clash".to_string(), Arc::new(clash::ClashRenderer));
    targets.insert("surge".to_string(), Arc::new(surge::SurgeRenderer));

    let state = AppState {
        pref,
        registry,
        targets,
        base_dir,
        http_client,
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
    pub http_client: reqwest::Client,
}

#[derive(Debug, Deserialize)]
struct SubQuery {
    target: String,
    token: Option<String>,
    url: Option<String>,
}

const SUBSCRIPTION_USER_AGENTS: [&str; 2] = ["Clash/v1.18.0", "mihomo/1.18.3"];

async fn handle_sub(
    State(state): State<AppState>,
    Query(params): Query<SubQuery>,
    uri: Uri,
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
        url_provided = params.url.is_some(),
        "handling /sub request"
    );

    let proxies =
        load_proxies_for_request(&state, params.url.as_deref(), include_insert).await?;

    let body = renderer.render(RenderArgs {
        state: &state,
        proxies,
        request_uri: Some(uri.to_string()),
    })?;

    Ok((
        StatusCode::OK,
        [(axum::http::header::CONTENT_TYPE, "text/yaml; charset=utf-8")],
        body,
    )
        .into_response())
}

async fn load_proxies_for_request(
    state: &AppState,
    url: Option<&str>,
    include_insert: bool,
) -> Result<Vec<crate::proxy::Proxy>, ApiError> {
    let pref = &state.pref;
    let registry = &state.registry;

    let mut proxies = if let Some(raw_url) = url {
        let parsed_url = parse_subscription_url(raw_url, &pref.common.allowed_domain)?;
        fetch_proxies_from_url(&state.http_client, registry, &parsed_url).await?
    } else {
        let profiles =
            gather_profile_paths(pref, include_insert, &state.base_dir).map_err(ApiError::internal)?;
        proxy::load_from_paths(registry, profiles)
            .context("failed to load proxies from profiles")
            .map_err(ApiError::internal)?
    };

    if url.is_some() && include_insert && pref.common.enable_insert {
        let insert_paths = gather_insert_paths(pref, &state.base_dir);
        if insert_paths.is_empty() {
            warn!("insert enabled but no insert_url provided");
        } else {
            let mut insert_proxies = proxy::load_from_paths(registry, insert_paths)
                .context("failed to load proxies from insert profiles")
                .map_err(ApiError::internal)?;
            if pref.common.prepend_insert_url {
                insert_proxies.append(&mut proxies);
                proxies = insert_proxies;
            } else {
                proxies.append(&mut insert_proxies);
            }
        }
    }

    Ok(proxies)
}

fn parse_subscription_url(
    raw: &str,
    allowed_domains: &[String],
) -> Result<reqwest::Url, ApiError> {
    let trimmed = raw.trim();
    let url = reqwest::Url::parse(trimmed).map_err(|err| {
        ApiError::new(StatusCode::BAD_REQUEST, format!("invalid url: {err}"))
    })?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            format!("unsupported url scheme {}", url.scheme()),
        ));
    }
    let host = url
        .host_str()
        .ok_or_else(|| ApiError::new(StatusCode::BAD_REQUEST, "url missing host"))?;
    if allowed_domains.is_empty() {
        return Err(ApiError::new(
            StatusCode::FORBIDDEN,
            "allowed-domain list is empty",
        ));
    }
    let host_lower = host.to_ascii_lowercase();
    let allowed = allowed_domains
        .iter()
        .any(|domain| domain.eq_ignore_ascii_case(&host_lower));
    if !allowed {
        return Err(ApiError::new(
            StatusCode::FORBIDDEN,
            format!("domain not allowed: {host}"),
        ));
    }
    Ok(url)
}

async fn fetch_proxies_from_url(
    client: &reqwest::Client,
    registry: &SchemaRegistry,
    url: &reqwest::Url,
) -> Result<Vec<crate::proxy::Proxy>, ApiError> {
    let mut last_error = None;

    for ua in SUBSCRIPTION_USER_AGENTS {
        let response = client
            .get(url.clone())
            .header(USER_AGENT, ua)
            .send()
            .await;

        let response = match response {
            Ok(resp) => resp,
            Err(err) => {
                last_error = Some(format!("request failed with UA {ua}: {err}"));
                continue;
            }
        };

        let status = response.status();
        if !status.is_success() {
            last_error = Some(format!("status {status} with UA {ua}"));
            continue;
        }

        let text = match response.text().await {
            Ok(text) => text,
            Err(err) => {
                last_error = Some(format!("failed to read response with UA {ua}: {err}"));
                continue;
            }
        };

        match proxy::load_from_text(registry, &text) {
            Ok(proxies) if !proxies.is_empty() => return Ok(proxies),
            Ok(_) => {
                last_error = Some(format!("no proxies found with UA {ua}"));
            }
            Err(err) => {
                last_error = Some(format!("failed to parse response with UA {ua}: {err}"));
            }
        }
    }

    Err(ApiError::new(
        StatusCode::BAD_GATEWAY,
        format!(
            "failed to fetch subscription: {}",
            last_error.unwrap_or_else(|| "unknown error".to_string())
        ),
    ))
}

async fn handle_404(uri: axum::http::Uri) -> impl IntoResponse {
    warn!(uri = %uri, "unmatched route");
    (StatusCode::NOT_FOUND, "not found")
}

pub struct RenderArgs<'a> {
    pub state: &'a AppState,
    pub proxies: Vec<crate::proxy::Proxy>,
    pub request_uri: Option<String>,
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
