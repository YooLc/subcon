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
mod logging;

use anyhow::Result;
#[tokio::main]
async fn main() -> Result<()> {
    logging::init_logging();
    server::run().await
}
