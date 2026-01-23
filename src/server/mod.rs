use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::Arc,
};

use anyhow::{Context, Result};
use axum::{
    Json, Router,
    body::Body,
    extract::{Query, State},
    http::{HeaderMap, HeaderName, HeaderValue, Request, StatusCode, Uri, header},
    middleware::Next,
    response::{IntoResponse, Response},
    routing::get,
};
use clap::Parser;
use serde::Deserialize;
use tokio::{net::TcpListener, sync::RwLock};
use tracing::{info, warn};

use crate::config::{Pref, load_pref};
use crate::network::Network;
use crate::paths::resolve_path;
use crate::proxy;
use crate::schema::SchemaRegistry;
use crate::server::util::{gather_insert_paths, gather_profile_paths};

mod api;
mod clash;
mod surge;
mod util;
mod web;

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
    let base_dir = PathBuf::from(".");
    let pref_path = resolve_path(&base_dir, &args.pref);

    let mut targets: HashMap<String, Arc<dyn TargetRenderer>> = HashMap::new();
    targets.insert("clash".to_string(), Arc::new(clash::ClashRenderer));
    targets.insert("surge".to_string(), Arc::new(surge::SurgeRenderer));

    let runtime = build_runtime(&pref_path, &base_dir)?;

    let listen_addr = format!(
        "{}:{}",
        runtime.pref.server.listen, runtime.pref.server.port
    );

    let state = AppState {
        runtime: Arc::new(RwLock::new(runtime)),
        targets,
        pref_path,
        base_dir,
    };

    let app = Router::new()
        .route("/sub", get(handle_sub))
        .nest("/api", api::router(state.clone()))
        .fallback(web::handle_web)
        .layer(axum::middleware::from_fn(log_requests))
        .with_state(state.clone());

    info!("binding subscription server to {listen_addr}");
    let listener = TcpListener::bind(&listen_addr)
        .await
        .context(format!("failed to bind {listen_addr}"))?;
    info!("server started on {listen_addr}");
    axum::serve(listener, app).await?;
    Ok(())
}

async fn log_requests(req: Request<Body>, next: Next) -> Response {
    let path = req.uri().path().to_string();
    let method = req.method().to_string();
    let start = std::time::Instant::now();
    let res = next.run(req).await;
    if !path.starts_with("/api") && !path.starts_with("/_next") {
        let status = res.status();
        let latency = start.elapsed();
        if status.is_client_error() || status.is_server_error() {
            warn!(
                method = %method,
                path = %path,
                status = %status,
                latency_ms = latency.as_millis(),
                "http response"
            );
        } else {
            info!(
                method = %method,
                path = %path,
                status = %status,
                latency_ms = latency.as_millis(),
                "http response"
            );
        }
    }
    res
}

#[derive(Clone)]
pub struct AppState {
    runtime: Arc<RwLock<RuntimeState>>,
    targets: HashMap<String, Arc<dyn TargetRenderer>>,
    pref_path: PathBuf,
    base_dir: PathBuf,
}

#[derive(Clone)]
pub struct RuntimeState {
    pub pref: Arc<Pref>,
    pub registry: Arc<SchemaRegistry>,
    pub network: Network,
}

fn build_runtime(pref_path: &Path, base_dir: &Path) -> Result<RuntimeState> {
    let pref = load_pref(pref_path)?;
    let schema_rel = pref
        .common
        .schema
        .as_deref()
        .ok_or_else(|| anyhow::anyhow!("`common.schema` must be set in pref.toml"))?;
    let schema_path = resolve_path(base_dir, schema_rel);

    let registry = SchemaRegistry::with_builtin(&schema_path)?;
    let network = Network::new(&pref.network, base_dir)?;

    Ok(RuntimeState {
        pref: Arc::new(pref),
        registry: Arc::new(registry),
        network,
    })
}

#[derive(Debug, Deserialize)]
struct SubQuery {
    target: String,
    token: Option<String>,
    url: Option<String>,
}

const SUBSCRIPTION_USER_AGENTS: [&str; 2] = ["Clash/v1.18.0", "mihomo/1.19.17"];
const SUBSCRIPTION_PASSTHROUGH_HEADERS: [&str; 6] = [
    "profile-title",
    "profile-update-interval",
    "profile-web-page-url",
    "subscription-refill-date",
    "subscription-userinfo",
    "support-url",
];

struct SubFetchResult {
    proxies: Vec<crate::proxy::Proxy>,
    forwarded_headers: Vec<(HeaderName, HeaderValue)>,
}

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

    let runtime = state.runtime.read().await.clone();
    let include_insert = params
        .token
        .as_ref()
        .zip(runtime.pref.common.api_access_token.as_ref())
        .map(|(provided, expected)| provided == expected)
        .unwrap_or(false);
    info!(
        target = %params.target,
        include_insert,
        url_provided = params.url.is_some(),
        "handling /sub request"
    );

    let sub_result = load_proxies_for_request(
        &runtime,
        &state.base_dir,
        params.url.as_deref(),
        include_insert,
    )
    .await?;

    let body = renderer.render(RenderArgs {
        runtime: &runtime,
        base_dir: &state.base_dir,
        proxies: sub_result.proxies,
        request_uri: Some(uri.to_string()),
    })?;

    let mut response = (
        StatusCode::OK,
        [(header::CONTENT_TYPE, "text/yaml; charset=utf-8")],
        body,
    )
        .into_response();
    if !sub_result.forwarded_headers.is_empty() {
        let headers = response.headers_mut();
        for (name, value) in sub_result.forwarded_headers {
            headers.append(name, value);
        }
    }
    Ok(response)
}

async fn load_proxies_for_request(
    runtime: &RuntimeState,
    base_dir: &Path,
    url: Option<&str>,
    include_insert: bool,
) -> Result<SubFetchResult, ApiError> {
    let pref = &runtime.pref;
    let registry = &runtime.registry;

    let (mut proxies, forwarded_headers) = if let Some(raw_url) = url {
        let parsed_url = parse_subscription_url(raw_url)?;
        let fetch = fetch_proxies_from_url(&runtime.network, registry, &parsed_url).await?;
        (fetch.proxies, fetch.forwarded_headers)
    } else {
        let profiles =
            gather_profile_paths(pref, include_insert, base_dir).map_err(ApiError::internal)?;
        let proxies = proxy::load_from_paths(registry, profiles)
            .context("failed to load proxies from profiles")
            .map_err(ApiError::internal)?;
        (proxies, Vec::new())
    };

    if url.is_some() && include_insert && pref.common.enable_insert {
        let insert_paths = gather_insert_paths(pref, base_dir);
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

    Ok(SubFetchResult {
        proxies,
        forwarded_headers,
    })
}

fn parse_subscription_url(raw: &str) -> Result<reqwest::Url, ApiError> {
    let trimmed = raw.trim();
    let url = reqwest::Url::parse(trimmed)
        .map_err(|err| ApiError::new(StatusCode::BAD_REQUEST, format!("invalid url: {err}")))?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            format!("unsupported url scheme {}", url.scheme()),
        ));
    }
    url.host_str()
        .ok_or_else(|| ApiError::new(StatusCode::BAD_REQUEST, "url missing host"))?;
    Ok(url)
}

async fn fetch_proxies_from_url(
    network: &Network,
    registry: &SchemaRegistry,
    url: &reqwest::Url,
) -> Result<SubFetchResult, ApiError> {
    let result = network
        .get_or_fetch_with_headers(url, &SUBSCRIPTION_USER_AGENTS, false, |text| {
            let proxies = proxy::load_from_text(registry, text)?;
            if proxies.is_empty() {
                anyhow::bail!("no proxies found");
            }
            Ok(proxies)
        })
        .await
        .map_err(|err| ApiError::new(err.status, err.to_string()))?;

    Ok(SubFetchResult {
        proxies: result.value,
        forwarded_headers: collect_subscription_headers(&result.headers),
    })
}

fn collect_subscription_headers(headers: &HeaderMap) -> Vec<(HeaderName, HeaderValue)> {
    let mut forwarded = Vec::new();
    for key in SUBSCRIPTION_PASSTHROUGH_HEADERS {
        let name = HeaderName::from_static(key);
        for value in headers.get_all(&name).iter() {
            forwarded.push((name.clone(), value.clone()));
        }
    }
    forwarded
}

pub struct RenderArgs<'a> {
    pub runtime: &'a RuntimeState,
    pub base_dir: &'a Path,
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

    fn internal(err: impl Into<anyhow::Error>) -> Self {
        let msg = format!("{:?}", err.into());
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
