pub(super) const DISPLAY_NAME: &str = "stellar";

pub(super) const NETWORK_LOCAL_NAME: &str = "local";
pub(super) const NETWORK_LOCAL_DESCRIPTION: &str =
    "Local Stellar quickstart Docker container (Soroban RPC + Horizon + Friendbot on port 8000)";

pub(super) const LOCAL_CHAIN_ID: &str = "stellar-local";
pub(super) const LOCAL_PORT: u16 = 8000;
pub(super) const LOCAL_SOROBAN_RPC_URL: &str = "http://127.0.0.1:8000/soroban/rpc";
pub(super) const LOCAL_HORIZON_URL: &str = "http://127.0.0.1:8000";

/// Docker image for the local Stellar quickstart devnet.
///
/// `testing` tag ships with Soroban (Protocol 22+) and enables `--enable rpc,horizon,lab`.
pub(super) const DOCKER_IMAGE: &str = "docker.io/stellar/quickstart:testing";
pub(super) const CONTAINER_NAME: &str = "stellar-local";
