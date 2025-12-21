use std::{
    collections::HashMap,
    path::{Component, Path, PathBuf},
};

use anyhow::Context;
use axum::{
    Json, Router,
    body::Body,
    extract::{Path as AxumPath, State},
    http::{HeaderMap, HeaderValue, StatusCode, header},
    middleware::Next,
    response::{IntoResponse, Response},
    routing::{get, post},
};
use serde::{Deserialize, Serialize};
use tokio::fs;
use tracing::{info, warn};

use crate::config::Pref;
use crate::logging;
use crate::paths::resolve_path;
use crate::server::util::load_group_specs_from_pref;

use super::{ApiError, AppState, build_runtime};

pub fn router(state: AppState) -> Router<AppState> {
    Router::new()
        .route("/ping", get(get_ping))
        .route("/config", get(get_config))
        .route("/profiles", get(list_profiles))
        .route("/profiles/{name}", get(get_profile).put(update_profile))
        .route("/rules", get(list_rules))
        .route("/rules/{name}", get(get_rule).put(update_rule))
        .route("/schema", get(list_schema))
        .route("/schema/{*path}", get(get_schema).put(update_schema))
        .route("/logs", get(get_logs))
        .route("/groups", get(get_groups))
        .route("/cache", get(get_cache))
        .route("/control/reload", post(control_reload))
        .route("/control/restart", post(control_restart))
        .layer(axum::middleware::from_fn_with_state(state, api_auth))
        .layer(axum::middleware::from_fn(api_no_cache))
}

#[derive(Serialize)]
struct ConfigResponse {
    version: String,
    pref_path: String,
    pref: String,
    schema_dir: String,
    profiles_dir: String,
    rules_dir: String,
    rulesets: Vec<String>,
    managed_base_url: Option<String>,
    server: ServerInfo,
}

#[derive(Serialize)]
struct ServerInfo {
    listen: String,
    port: u16,
}

#[derive(Serialize)]
struct FileListResponse {
    items: Vec<FileEntry>,
}

#[derive(Serialize)]
struct FileEntry {
    name: String,
    path: String,
    #[serde(default)]
    in_use: bool,
    #[serde(default)]
    usage: Vec<String>,
}

#[derive(Serialize)]
struct FileContentResponse {
    name: String,
    path: String,
    content: String,
}

#[derive(Deserialize)]
struct UpdateFileRequest {
    content: String,
}

#[derive(Serialize)]
struct UpdateFileResponse {
    ok: bool,
    path: String,
    bytes: usize,
}

#[derive(Serialize)]
struct LogResponse {
    items: Vec<String>,
}

#[derive(Deserialize)]
struct LogQuery {
    limit: Option<usize>,
}

#[derive(Serialize)]
struct ControlResponse {
    ok: bool,
    message: String,
}

#[derive(Serialize)]
struct GroupResponse {
    items: Vec<GroupEntry>,
}

#[derive(Serialize)]
struct GroupEntry {
    name: String,
    group_type: String,
    rules: Vec<String>,
    url: Option<String>,
    interval: Option<u64>,
    rulesets: Vec<String>,
}

#[derive(Serialize)]
struct CacheResponse {
    items: Vec<CacheEntry>,
}

#[derive(Serialize)]
struct CacheEntry {
    url: String,
    ttl_seconds: u64,
}

#[derive(Serialize)]
struct PingResponse {
    ok: bool,
}

async fn api_no_cache(req: axum::http::Request<Body>, next: Next) -> Response {
    let mut res = next.run(req).await;
    let headers = res.headers_mut();
    headers.insert(
        axum::http::header::CACHE_CONTROL,
        HeaderValue::from_static("no-store, no-cache, must-revalidate"),
    );
    headers.insert(
        axum::http::header::PRAGMA,
        HeaderValue::from_static("no-cache"),
    );
    res
}

async fn api_auth(
    State(state): State<AppState>,
    req: axum::http::Request<Body>,
    next: Next,
) -> Response {
    let runtime = state.runtime.read().await.clone();
    let expected = runtime.pref.common.api_access_token.as_deref().unwrap_or("");
    if expected.is_empty() {
        return ApiError::new(StatusCode::FORBIDDEN, "api token not configured").into_response();
    }
    let provided = extract_token(req.headers()).unwrap_or_default();
    if provided != expected {
        return ApiError::new(StatusCode::FORBIDDEN, "invalid api token").into_response();
    }
    if !is_same_origin(req.headers()) {
        return ApiError::new(StatusCode::FORBIDDEN, "origin not allowed").into_response();
    }
    next.run(req).await
}

fn extract_token(headers: &HeaderMap) -> Option<String> {
    if let Some(value) = headers.get(header::AUTHORIZATION).and_then(|v| v.to_str().ok()) {
        let mut parts = value.split_whitespace();
        if let (Some(scheme), Some(token)) = (parts.next(), parts.next()) {
            if scheme.eq_ignore_ascii_case("bearer") {
                return Some(token.to_string());
            }
        }
    }
    headers
        .get("x-subcon-token")
        .and_then(|v| v.to_str().ok())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn is_same_origin(headers: &HeaderMap) -> bool {
    let host = match headers.get(header::HOST).and_then(|v| v.to_str().ok()) {
        Some(host) if !host.is_empty() => host,
        _ => return false,
    };
    let allowed = allowed_origins(host, headers);

    if let Some(origin) = headers.get(header::ORIGIN).and_then(|v| v.to_str().ok()) {
        return allowed.iter().any(|item| item == origin);
    }
    if let Some(referer) = headers.get(header::REFERER).and_then(|v| v.to_str().ok()) {
        if let Ok(url) = reqwest::Url::parse(referer) {
            let origin = url.origin().ascii_serialization();
            return allowed.iter().any(|item| item == &origin);
        }
        return false;
    }
    if let Some(site) = headers
        .get("sec-fetch-site")
        .and_then(|v| v.to_str().ok())
    {
        return site.eq_ignore_ascii_case("same-origin")
            || site.eq_ignore_ascii_case("same-site");
    }
    false
}

fn allowed_origins(host: &str, headers: &HeaderMap) -> Vec<String> {
    if let Some(proto) = forwarded_proto(headers) {
        return vec![format!("{proto}://{host}")];
    }
    vec![format!("http://{host}"), format!("https://{host}")]
}

fn forwarded_proto(headers: &HeaderMap) -> Option<String> {
    if let Some(value) = headers
        .get("x-forwarded-proto")
        .and_then(|v| v.to_str().ok())
    {
        let proto = value.split(',').next().unwrap_or("").trim();
        if !proto.is_empty() {
            return Some(proto.to_string());
        }
    }
    if let Some(value) = headers
        .get("forwarded")
        .and_then(|v| v.to_str().ok())
    {
        for part in value.split(';') {
            let part = part.trim();
            if let Some(proto) = part.strip_prefix("proto=") {
                let proto = proto.trim_matches('"');
                if !proto.is_empty() {
                    return Some(proto.to_string());
                }
            }
        }
    }
    None
}

async fn get_ping() -> Result<Json<PingResponse>, ApiError> {
    Ok(Json(PingResponse { ok: true }))
}

async fn get_config(State(state): State<AppState>) -> Result<Json<ConfigResponse>, ApiError> {
    let runtime = state.runtime.read().await.clone();
    let pref = &runtime.pref;
    let pref_text = fs::read_to_string(&state.pref_path)
        .await
        .map_err(ApiError::internal)?;
    let schema_dir = resolve_schema_dir(pref, &state.base_dir)?;
    let profiles_dir = resolve_profiles_dir(&state.base_dir);
    let rules_dir = resolve_rules_dir(&state.base_dir);
    let rulesets = pref
        .rulesets
        .iter()
        .map(|entry| resolve_path(&state.base_dir, &entry.import).display().to_string())
        .collect();
    let server = ServerInfo {
        listen: pref.server.listen.clone(),
        port: pref.server.port,
    };

    Ok(Json(ConfigResponse {
        version: env!("CARGO_PKG_VERSION").to_string(),
        pref_path: state.pref_path.display().to_string(),
        pref: pref_text,
        schema_dir: schema_dir.display().to_string(),
        profiles_dir: profiles_dir.display().to_string(),
        rules_dir: rules_dir.display().to_string(),
        rulesets,
        managed_base_url: pref.managed_config.base_url.clone(),
        server,
    }))
}

async fn list_profiles(State(state): State<AppState>) -> Result<Json<FileListResponse>, ApiError> {
    let runtime = state.runtime.read().await.clone();
    let root = resolve_profiles_dir(&state.base_dir);
    let mut entries = list_files_flat(&root, &["yaml", "yml"]).await?;

    let usage = build_profile_usage(&runtime.pref, &state.base_dir);
    for entry in &mut entries {
        let path = root.join(&entry.name);
        let key = path
            .canonicalize()
            .unwrap_or(path);
        if let Some(tags) = usage.get(&key) {
            entry.in_use = true;
            entry.usage = tags.clone();
        }
    }

    Ok(Json(FileListResponse { items: entries }))
}

async fn get_profile(
    State(state): State<AppState>,
    AxumPath(name): AxumPath<String>,
) -> Result<Json<FileContentResponse>, ApiError> {
    let root = resolve_profiles_dir(&state.base_dir);
    let file = resolve_single_file(&root, &name, &["yaml", "yml"])?;
    let content = read_file(&file).await?;
    Ok(Json(FileContentResponse {
        name,
        path: file.display().to_string(),
        content,
    }))
}

async fn update_profile(
    State(state): State<AppState>,
    AxumPath(name): AxumPath<String>,
    Json(body): Json<UpdateFileRequest>,
) -> Result<Json<UpdateFileResponse>, ApiError> {
    let root = resolve_profiles_dir(&state.base_dir);
    let file = resolve_single_file(&root, &name, &["yaml", "yml"])?;
    let bytes = write_file(&file, &body.content).await?;
    info!(path = %file.display(), bytes, "profile updated");
    Ok(Json(UpdateFileResponse {
        ok: true,
        path: file.display().to_string(),
        bytes,
    }))
}

async fn list_rules(State(state): State<AppState>) -> Result<Json<FileListResponse>, ApiError> {
    let root = resolve_rules_dir(&state.base_dir);
    let entries = list_files_flat(&root, &["list"]).await?;
    Ok(Json(FileListResponse { items: entries }))
}

async fn get_rule(
    State(state): State<AppState>,
    AxumPath(name): AxumPath<String>,
) -> Result<Json<FileContentResponse>, ApiError> {
    let root = resolve_rules_dir(&state.base_dir);
    let file = resolve_single_file(&root, &name, &["list"])?;
    let content = read_file(&file).await?;
    Ok(Json(FileContentResponse {
        name,
        path: file.display().to_string(),
        content,
    }))
}

async fn update_rule(
    State(state): State<AppState>,
    AxumPath(name): AxumPath<String>,
    Json(body): Json<UpdateFileRequest>,
) -> Result<Json<UpdateFileResponse>, ApiError> {
    let root = resolve_rules_dir(&state.base_dir);
    let file = resolve_single_file(&root, &name, &["list"])?;
    let bytes = write_file(&file, &body.content).await?;
    info!(path = %file.display(), bytes, "rules file updated");
    Ok(Json(UpdateFileResponse {
        ok: true,
        path: file.display().to_string(),
        bytes,
    }))
}

async fn list_schema(State(state): State<AppState>) -> Result<Json<FileListResponse>, ApiError> {
    let runtime = state.runtime.read().await.clone();
    let root = resolve_schema_dir(&runtime.pref, &state.base_dir)?;
    let entries = list_files_recursive(&root, &["yaml", "yml"]).await?;
    Ok(Json(FileListResponse { items: entries }))
}

async fn get_schema(
    State(state): State<AppState>,
    AxumPath(path): AxumPath<String>,
) -> Result<Json<FileContentResponse>, ApiError> {
    let runtime = state.runtime.read().await.clone();
    let root = resolve_schema_dir(&runtime.pref, &state.base_dir)?;
    let file = resolve_nested_file(&root, &path, &["yaml", "yml"])?;
    let content = read_file(&file).await?;
    Ok(Json(FileContentResponse {
        name: path,
        path: file.display().to_string(),
        content,
    }))
}

async fn update_schema(
    State(state): State<AppState>,
    AxumPath(path): AxumPath<String>,
    Json(body): Json<UpdateFileRequest>,
) -> Result<Json<UpdateFileResponse>, ApiError> {
    let runtime = state.runtime.read().await.clone();
    let root = resolve_schema_dir(&runtime.pref, &state.base_dir)?;
    let file = resolve_nested_file(&root, &path, &["yaml", "yml"])?;
    let bytes = write_file(&file, &body.content).await?;
    info!(path = %file.display(), bytes, "schema updated");
    Ok(Json(UpdateFileResponse {
        ok: true,
        path: file.display().to_string(),
        bytes,
    }))
}

async fn get_logs(
    State(_state): State<AppState>,
    axum::extract::Query(query): axum::extract::Query<LogQuery>,
) -> Result<Json<LogResponse>, ApiError> {
    let items = logging::get_logs(query.limit);
    Ok(Json(LogResponse { items }))
}

#[derive(Deserialize)]
struct RulesetsToml {
    #[serde(default)]
    rulesets: Vec<RulesetSpec>,
}

#[derive(Deserialize)]
struct RulesetSpec {
    group: String,
    ruleset: RulesetRef,
}

#[derive(Deserialize)]
#[serde(untagged)]
enum RulesetRef {
    Single(String),
    Multiple(Vec<String>),
}

impl RulesetRef {
    fn into_vec(self) -> Vec<String> {
        match self {
            Self::Single(value) => vec![value],
            Self::Multiple(values) => values,
        }
    }
}

async fn get_groups(State(state): State<AppState>) -> Result<Json<GroupResponse>, ApiError> {
    let runtime = state.runtime.read().await.clone();
    let pref = &runtime.pref;
    let specs = load_group_specs_from_pref(pref, &state.base_dir).map_err(ApiError::internal)?;
    let ruleset_map = load_ruleset_groups(pref, &state.base_dir).await?;

    let items = specs
        .into_iter()
        .map(|spec| {
            let name = spec.name;
            let rulesets = ruleset_map.get(&name).cloned().unwrap_or_default();
            GroupEntry {
                name,
                group_type: spec.group_type,
                rules: spec.rule,
                url: spec.url,
                interval: spec.interval,
                rulesets,
            }
        })
        .collect();

    Ok(Json(GroupResponse { items }))
}

async fn get_cache(State(state): State<AppState>) -> Result<Json<CacheResponse>, ApiError> {
    let runtime = state.runtime.read().await.clone();
    let items = runtime
        .network
        .list_cache()
        .await
        .into_iter()
        .map(|entry| CacheEntry {
            url: entry.url,
            ttl_seconds: entry.ttl_seconds,
        })
        .collect();
    Ok(Json(CacheResponse { items }))
}

async fn load_ruleset_groups(
    pref: &Pref,
    base_dir: &Path,
) -> Result<HashMap<String, Vec<String>>, ApiError> {
    let mut map: HashMap<String, Vec<String>> = HashMap::new();
    for entry in &pref.rulesets {
        let path = resolve_path(base_dir, &entry.import);
        let text = fs::read_to_string(&path).await.map_err(ApiError::internal)?;
        let parsed: RulesetsToml = toml::from_str(&text)
            .with_context(|| format!("failed to parse {}", path.display()))
            .map_err(ApiError::internal)?;
        for ruleset in parsed.rulesets {
            let items = ruleset.ruleset.into_vec();
            map.entry(ruleset.group)
                .or_default()
                .extend(items);
        }
    }
    Ok(map)
}

async fn control_reload(State(state): State<AppState>) -> Result<Json<ControlResponse>, ApiError> {
    let runtime = build_runtime(&state.pref_path, &state.base_dir).map_err(ApiError::internal)?;
    let mut guard = state.runtime.write().await;
    *guard = runtime;
    info!("runtime configuration reloaded");
    Ok(Json(ControlResponse {
        ok: true,
        message: "configuration reloaded".to_string(),
    }))
}

async fn control_restart(State(_state): State<AppState>) -> Result<Json<ControlResponse>, ApiError> {
    tokio::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_millis(200)).await;
        warn!("process restart requested via API");
        std::process::exit(0);
    });
    Ok(Json(ControlResponse {
        ok: true,
        message: "restart requested".to_string(),
    }))
}

fn resolve_profiles_dir(base_dir: &Path) -> PathBuf {
    pick_existing_dir(base_dir.join("conf/profiles"), system_path("conf/profiles"))
}

fn resolve_rules_dir(base_dir: &Path) -> PathBuf {
    pick_existing_dir(base_dir.join("conf/rules"), system_path("conf/rules"))
}

fn resolve_schema_dir(pref: &Pref, base_dir: &Path) -> Result<PathBuf, ApiError> {
    let schema_rel = pref
        .common
        .schema
        .as_deref()
        .ok_or_else(|| ApiError::new(StatusCode::BAD_REQUEST, "`common.schema` not set"))?;
    Ok(resolve_path(base_dir, schema_rel))
}

fn system_path(path: &str) -> PathBuf {
    PathBuf::from("/etc/subcon").join(path)
}

fn pick_existing_dir(primary: PathBuf, fallback: PathBuf) -> PathBuf {
    if primary.exists() {
        primary
    } else if fallback.exists() {
        fallback
    } else {
        primary
    }
}

fn build_profile_usage(pref: &Pref, base_dir: &Path) -> HashMap<PathBuf, Vec<String>> {
    let mut usage = HashMap::new();
    for (label, items) in [
        ("default", &pref.common.default_url),
        ("insert", &pref.common.insert_url),
    ] {
        for raw in items {
            if is_remote(raw) {
                continue;
            }
            let resolved = resolve_path(base_dir, raw);
            let key = resolved.canonicalize().unwrap_or(resolved);
            usage.entry(key).or_insert_with(Vec::new).push(label.to_string());
        }
    }
    usage
}

fn is_remote(raw: &str) -> bool {
    raw.starts_with("http://") || raw.starts_with("https://")
}

async fn list_files_flat(root: &Path, exts: &[&str]) -> Result<Vec<FileEntry>, ApiError> {
    if !root.exists() {
        return Err(ApiError::new(
            StatusCode::NOT_FOUND,
            format!("directory {} not found", root.display()),
        ));
    }
    let mut entries = Vec::new();
    let mut dir = fs::read_dir(root).await.map_err(ApiError::internal)?;
    while let Some(entry) = dir.next_entry().await.map_err(ApiError::internal)? {
        let path = entry.path();
        if path.is_file() && has_extension(&path, exts) {
            let name = path
                .file_name()
                .and_then(|s| s.to_str())
                .unwrap_or_default()
                .to_string();
            entries.push(FileEntry {
                name,
                path: path.display().to_string(),
                in_use: false,
                usage: Vec::new(),
            });
        }
    }
    entries.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(entries)
}

async fn list_files_recursive(root: &Path, exts: &[&str]) -> Result<Vec<FileEntry>, ApiError> {
    if !root.exists() {
        return Err(ApiError::new(
            StatusCode::NOT_FOUND,
            format!("directory {} not found", root.display()),
        ));
    }
    let mut entries = Vec::new();
    let mut stack = vec![root.to_path_buf()];
    while let Some(current) = stack.pop() {
        let mut dir = fs::read_dir(&current).await.map_err(ApiError::internal)?;
        while let Some(entry) = dir.next_entry().await.map_err(ApiError::internal)? {
            let path = entry.path();
            if path.is_dir() {
                stack.push(path);
            } else if path.is_file() && has_extension(&path, exts) {
                let name = path
                    .strip_prefix(root)
                    .unwrap_or(&path)
                    .to_string_lossy()
                    .to_string();
                entries.push(FileEntry {
                    name,
                    path: path.display().to_string(),
                    in_use: false,
                    usage: Vec::new(),
                });
            }
        }
    }
    entries.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(entries)
}

async fn read_file(path: &Path) -> Result<String, ApiError> {
    fs::read_to_string(path).await.map_err(|err| {
        if err.kind() == std::io::ErrorKind::NotFound {
            ApiError::new(StatusCode::NOT_FOUND, "file not found")
        } else {
            ApiError::internal(err)
        }
    })
}

async fn write_file(path: &Path, content: &str) -> Result<usize, ApiError> {
    if let Some(parent) = path.parent() {
        if !parent.exists() {
            fs::create_dir_all(parent).await.map_err(ApiError::internal)?;
        }
    }
    fs::write(path, content).await.map_err(ApiError::internal)?;
    Ok(content.as_bytes().len())
}

fn resolve_single_file(root: &Path, name: &str, exts: &[&str]) -> Result<PathBuf, ApiError> {
    let rel = sanitize_single_path(name)?;
    ensure_extension(&rel, exts)?;
    let file = root.join(rel);
    ensure_within_root(root, &file)?;
    Ok(file)
}

fn resolve_nested_file(root: &Path, name: &str, exts: &[&str]) -> Result<PathBuf, ApiError> {
    let rel = sanitize_relative_path(name)?;
    ensure_extension(&rel, exts)?;
    let file = root.join(rel);
    ensure_within_root(root, &file)?;
    Ok(file)
}

fn sanitize_single_path(name: &str) -> Result<PathBuf, ApiError> {
    let rel = sanitize_relative_path(name)?;
    if rel.components().count() != 1 {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "nested paths are not allowed",
        ));
    }
    Ok(rel)
}

fn sanitize_relative_path(name: &str) -> Result<PathBuf, ApiError> {
    if name.trim().is_empty() {
        return Err(ApiError::new(StatusCode::BAD_REQUEST, "path is empty"));
    }
    let rel = PathBuf::from(name);
    for component in rel.components() {
        match component {
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                return Err(ApiError::new(
                    StatusCode::BAD_REQUEST,
                    "path traversal is not allowed",
                ));
            }
            Component::CurDir | Component::Normal(_) => {}
        }
    }
    Ok(rel)
}

fn ensure_extension(path: &Path, exts: &[&str]) -> Result<(), ApiError> {
    let ext = path.extension().and_then(|s| s.to_str()).unwrap_or("");
    if exts.iter().any(|e| ext.eq_ignore_ascii_case(e)) {
        Ok(())
    } else {
        Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            format!("unsupported file extension .{ext}"),
        ))
    }
}

fn has_extension(path: &Path, exts: &[&str]) -> bool {
    path.extension()
        .and_then(|s| s.to_str())
        .map(|ext| exts.iter().any(|e| ext.eq_ignore_ascii_case(e)))
        .unwrap_or(false)
}

fn ensure_within_root(root: &Path, path: &Path) -> Result<(), ApiError> {
    let root_norm = root
        .canonicalize()
        .unwrap_or_else(|_| root.to_path_buf());
    let path_norm = path
        .canonicalize()
        .unwrap_or_else(|_| path.to_path_buf());
    if path_norm.starts_with(&root_norm) {
        Ok(())
    } else {
        Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "path outside allowed root",
        ))
    }
}
