use axum::http::StatusCode;

use super::{NetworkError, NetworkResult};

#[derive(Clone)]
pub struct Security {
    allowed_domains: Vec<String>,
}

impl Security {
    pub fn new(allowed_domains: &[String]) -> Self {
        Self {
            allowed_domains: allowed_domains
                .iter()
                .map(|domain| domain.to_ascii_lowercase())
                .collect(),
        }
    }

    pub fn validate_url(&self, url: &reqwest::Url) -> NetworkResult<()> {
        let host = url.host_str().ok_or_else(|| {
            NetworkError::new(StatusCode::BAD_REQUEST, "url missing host")
        })?;
        if self.allowed_domains.is_empty() {
            return Err(NetworkError::new(
                StatusCode::FORBIDDEN,
                "allowed-domain list is empty",
            ));
        }
        let host_lower = host.to_ascii_lowercase();
        let allowed = self
            .allowed_domains
            .iter()
            .any(|domain| domain == &host_lower);
        if !allowed {
            return Err(NetworkError::new(
                StatusCode::FORBIDDEN,
                format!("domain not allowed: {host}"),
            ));
        }
        Ok(())
    }
}
