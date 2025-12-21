use std::{path::Path, time::Duration};

use anyhow::{Context, Result, bail};
use axum::http::StatusCode;
use reqwest::header::USER_AGENT;

use crate::config::NetworkConfig;

mod cache;
mod security;

use cache::CacheStore;
pub use cache::CacheSnapshot;
use security::Security;

#[derive(Clone)]
pub struct Network {
    client: reqwest::Client,
    cache: CacheStore,
    security: Security,
    cache_enabled: bool,
}

impl Network {
    pub fn new(config: &NetworkConfig, base_dir: &Path) -> Result<Self> {
        let cache = CacheStore::new(config, base_dir)?;
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(30))
            .build()
            .context("failed to build http client")?;
        let security = Security::new(&config.allowed_domain);

        Ok(Self {
            client,
            cache,
            security,
            cache_enabled: config.enable,
        })
    }

    pub async fn get_or_fetch_with<T, F>(
        &self,
        url: &reqwest::Url,
        user_agents: &[&str],
        no_cache: bool,
        parse: F,
    ) -> NetworkResult<T>
    where
        F: Fn(&str) -> Result<T>,
    {
        self.security.validate_url(url)?;

        let use_cache = self.cache_enabled && !no_cache;
        let should_store = self.cache_enabled;

        if use_cache {
            if let Some(text) = self.cache.read(url.as_str()).await.map_err(NetworkError::internal)?
            {
                return parse(&text).map_err(NetworkError::internal);
            }
        }

        if user_agents.is_empty() {
            return Err(NetworkError::new(
                StatusCode::INTERNAL_SERVER_ERROR,
                "no user agents configured for network fetch",
            ));
        }

        let mut last_error = None;

        for ua in user_agents {
            let text = match self.fetch_text(url, ua).await {
                Ok(text) => text,
                Err(err) => {
                    last_error = Some(format!("request failed with UA {ua}: {err}"));
                    continue;
                }
            };

            match parse(&text) {
                Ok(value) => {
                    if should_store {
                        self.cache
                            .store(url, &text)
                            .await
                            .map_err(NetworkError::internal)?;
                    }
                    return Ok(value);
                }
                Err(err) => {
                    last_error = Some(format!("failed to parse response with UA {ua}: {err}"));
                }
            }
        }

        Err(NetworkError::new(
            StatusCode::BAD_GATEWAY,
            format!(
                "failed to fetch subscription: {}",
                last_error.unwrap_or_else(|| "unknown error".to_string())
            ),
        ))
    }

    async fn fetch_text(&self, url: &reqwest::Url, user_agent: &str) -> Result<String> {
        let response = self
            .client
            .get(url.clone())
            .header(USER_AGENT, user_agent)
            .send()
            .await
            .context("request failed")?;

        let status = response.status();
        if !status.is_success() {
            bail!("status {status}");
        }

        let text = response.text().await.context("failed to read response")?;
        Ok(text)
    }

    pub async fn list_cache(&self) -> Vec<CacheSnapshot> {
        self.cache.list_entries().await
    }
}

pub type NetworkResult<T> = std::result::Result<T, NetworkError>;

#[derive(Debug)]
pub struct NetworkError {
    pub status: StatusCode,
    message: String,
}

impl NetworkError {
    fn new(status: StatusCode, message: impl Into<String>) -> Self {
        Self {
            status,
            message: message.into(),
        }
    }

    fn internal(err: anyhow::Error) -> Self {
        Self::new(StatusCode::INTERNAL_SERVER_ERROR, err.to_string())
    }
}

impl std::fmt::Display for NetworkError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.message)
    }
}

impl std::error::Error for NetworkError {}
