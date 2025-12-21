mod export;
mod groups;
mod parser;
mod schema;
mod proxy;
mod rules;
mod config;
mod network;
mod server;
mod paths;

use anyhow::Result;
use tracing_subscriber::{fmt, EnvFilter};

#[tokio::main]
async fn main() -> Result<()> {
    fmt()
        .with_env_filter(EnvFilter::from_default_env().add_directive("info".parse().unwrap()))
        .init();
    server::run().await
}
