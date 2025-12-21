use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::Arc,
    time::{Duration, SystemTime},
};

use anyhow::{Context, Result};
use sha2::{Digest, Sha256};
use tokio::sync::Mutex;
use tracing::info;

use crate::config::NetworkConfig;

#[derive(Clone)]
pub struct CacheStore {
    dir: PathBuf,
    ttl: Duration,
    entries: Arc<Mutex<HashMap<String, CacheEntry>>>,
}

#[derive(Clone)]
struct CacheEntry {
    expires_at: SystemTime,
    sha256: String,
    path: PathBuf,
}

impl CacheStore {
    pub fn new(config: &NetworkConfig, base_dir: &Path) -> Result<Self> {
        let dir = resolve_path(base_dir, &config.dir);
        if dir.exists() {
            std::fs::remove_dir_all(&dir)
                .with_context(|| format!("failed to clear cache dir {}", dir.display()))?;
        }
        std::fs::create_dir_all(&dir)
            .with_context(|| format!("failed to create cache dir {}", dir.display()))?;

        Ok(Self {
            dir,
            ttl: Duration::from_secs(config.ttl_seconds),
            entries: Arc::new(Mutex::new(HashMap::new())),
        })
    }

    pub async fn read(&self, url: &str) -> Result<Option<String>> {
        let entry = match self.get_valid_entry(url).await {
            Some(entry) => entry,
            None => return Ok(None),
        };

        let bytes = match tokio::fs::read(&entry.path).await {
            Ok(bytes) => bytes,
            Err(_) => {
                self.evict(url).await;
                return Ok(None);
            }
        };

        let hash = sha256_hex(&bytes);
        if hash != entry.sha256 {
            self.evict(url).await;
            return Ok(None);
        }

        let text = match String::from_utf8(bytes) {
            Ok(text) => text,
            Err(_) => {
                self.evict(url).await;
                return Ok(None);
            }
        };

        let ttl_secs = entry
            .expires_at
            .duration_since(SystemTime::now())
            .unwrap_or_default()
            .as_secs();
        info!(url, ttl_seconds = ttl_secs, "cache hit");

        Ok(Some(text))
    }

    pub async fn store(&self, url: &reqwest::Url, text: &str) -> Result<()> {
        let bytes = text.as_bytes();
        let content_hash = sha256_hex(bytes);
        let path = self.cache_path_for_url(url);
        let tmp_path = path.with_extension("tmp");

        tokio::fs::write(&tmp_path, bytes)
            .await
            .with_context(|| format!("failed to write cache file {}", tmp_path.display()))?;
        tokio::fs::rename(&tmp_path, &path)
            .await
            .with_context(|| format!("failed to finalize cache file {}", path.display()))?;

        let entry = CacheEntry {
            expires_at: SystemTime::now() + self.ttl,
            sha256: content_hash,
            path,
        };

        let mut entries = self.entries.lock().await;
        entries.insert(url.as_str().to_string(), entry);
        Ok(())
    }

    async fn get_valid_entry(&self, url: &str) -> Option<CacheEntry> {
        let (entry, expired) = {
            let mut entries = self.entries.lock().await;
            match entries.get(url).cloned() {
                Some(entry) if entry.expires_at > SystemTime::now() => (Some(entry), None),
                Some(entry) => {
                    entries.remove(url);
                    (None, Some(entry))
                }
                None => (None, None),
            }
        };

        if let Some(entry) = expired {
            let _ = tokio::fs::remove_file(&entry.path).await;
        }

        entry
    }

    async fn evict(&self, url: &str) {
        let entry = {
            let mut entries = self.entries.lock().await;
            entries.remove(url)
        };
        if let Some(entry) = entry {
            let _ = tokio::fs::remove_file(&entry.path).await;
        }
    }

    fn cache_path_for_url(&self, url: &reqwest::Url) -> PathBuf {
        let key = sha256_hex(url.as_str().as_bytes());
        self.dir.join(format!("{key}.cache"))
    }
}

fn sha256_hex(data: &[u8]) -> String {
    let digest = Sha256::digest(data);
    format!("{digest:x}")
}

fn resolve_path(base_dir: &Path, input: &str) -> PathBuf {
    let candidate = PathBuf::from(input);
    if candidate.is_absolute() {
        candidate
    } else {
        base_dir.join(candidate)
    }
}
