use anyhow::Context;
use cardano_ibc_sp1_tendermint_prover::{serve, Config};
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()))
        .init();
    let config = Config::from_env().context("load prover-service configuration")?;
    serve(config).await
}
