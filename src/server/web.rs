use axum::{
    body::Body,
    http::{HeaderValue, Method, Request, StatusCode, header},
    response::{IntoResponse, Response},
};
use include_dir::{Dir, include_dir};
use mime_guess::from_path;
use tracing::warn;

static WEB_DIR: Dir<'_> = include_dir!("$CARGO_MANIFEST_DIR/src/web/out");

pub async fn handle_web(req: Request<Body>) -> impl IntoResponse {
    if !matches!(*req.method(), Method::GET | Method::HEAD) {
        return (StatusCode::NOT_FOUND, "not found").into_response();
    }

    let mut path = req.uri().path().trim_start_matches('/').to_string();
    if path.is_empty() {
        path = "index.html".to_string();
    } else if path.ends_with('/') {
        path.push_str("index.html");
    }

    if let Some(response) = serve_path(&path) {
        return response;
    }

    if !path.contains('.') {
        // Try to serve as a directory with index.html
        let index_path = format!("{}/index.html", path);
        if let Some(response) = serve_path(&index_path) {
            return response;
        }

        // Fall back to serving root index.html for SPA routing
        if let Some(response) = serve_path("index.html") {
            return response;
        }
    }

    warn!(uri = %req.uri(), "static asset not found");
    (StatusCode::NOT_FOUND, "not found").into_response()
}

fn serve_path(path: &str) -> Option<Response> {
    let file = WEB_DIR.get_file(path)?;
    let mime = from_path(path).first_or_octet_stream();
    let mut response = Response::new(Body::from(file.contents().to_vec()));
    let headers = response.headers_mut();
    headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_str(mime.as_ref()).ok()?,
    );
    headers.insert(
        header::CACHE_CONTROL,
        HeaderValue::from_str(cache_control_for(path)).ok()?,
    );
    Some(response)
}

fn cache_control_for(path: &str) -> &'static str {
    if path.ends_with(".html") {
        return "public, max-age=600, must-revalidate";
    }
    if path.starts_with("_next/")
        || path.starts_with("assets/")
        || path.ends_with(".js")
        || path.ends_with(".css")
        || path.ends_with(".map")
        || path.ends_with(".png")
        || path.ends_with(".jpg")
        || path.ends_with(".jpeg")
        || path.ends_with(".svg")
        || path.ends_with(".webp")
        || path.ends_with(".woff2")
        || path.ends_with(".woff")
        || path.ends_with(".ttf")
    {
        return "public, max-age=31536000, immutable";
    }
    "public, max-age=3600"
}
