use std::path::PathBuf;

use dirs::home_dir;

pub(super) const SOURCE_REPO_URL: &str =
    "https://github.com/InjectiveFoundation/injective-core.git";
pub(super) const SOURCE_DIR: &str = ".caribic/injective/injective-core";

pub(super) const LOCAL_CHAIN_ID: &str = "injective-777";
pub(super) const LOCAL_MONIKER: &str = "caribic-injective-local";
pub(super) const LOCAL_STATUS_URL: &str = "http://127.0.0.1:26660/status";
pub(super) const LOCAL_RPC_LADDR: &str = "tcp://0.0.0.0:26660";
pub(super) const LOCAL_GRPC_ADDRESS: &str = "0.0.0.0:9097";
pub(super) const LOCAL_API_ADDRESS: &str = "tcp://0.0.0.0:1320";
pub(super) const LOCAL_HOME_DIR: &str = ".injectived-local";
pub(super) const LOCAL_PID_FILE: &str = ".caribic/injective-local.pid";
pub(super) const LOCAL_LOG_FILE: &str = ".caribic/injective-local.log";
pub(super) const LOCAL_VALIDATOR_KEY: &str = "validator";
pub(super) const LOCAL_GENESIS_ACCOUNT_AMOUNT: &str = "100000000000000000000stake";
pub(super) const LOCAL_GENTX_AMOUNT: &str = "50000000000000000000stake";

pub(super) const TESTNET_CHAIN_ID: &str = "injective-888";
pub(super) const TESTNET_MONIKER: &str = "caribic-injective-testnet";
pub(super) const TESTNET_TRUST_RPC_URL: &str = "https://testnet.sentry.tm.injective.network";
pub(super) const TESTNET_STATUS_URL: &str = "http://127.0.0.1:26659/status";
pub(super) const TESTNET_RPC_LADDR: &str = "tcp://0.0.0.0:26659";
pub(super) const TESTNET_GRPC_ADDRESS: &str = "0.0.0.0:9096";
pub(super) const TESTNET_API_ADDRESS: &str = "tcp://0.0.0.0:1319";
pub(super) const TESTNET_GENESIS_URL: &str =
    "https://raw.githubusercontent.com/InjectiveLabs/testnet/main/testnet-1/genesis.json";
pub(super) const TESTNET_HOME_DIR: &str = ".injectived-testnet";
pub(super) const TESTNET_PID_FILE: &str = ".caribic/injective-testnet.pid";
pub(super) const TESTNET_LOG_FILE: &str = ".caribic/injective-testnet.log";
pub(super) const TESTNET_TRUST_OFFSET: u64 = 1500;
pub(super) const TESTNET_SEEDS: &str =
    "20a548c1ede8f31d13309171f76e0f4624e126b8@seed.testnet.injective.network:26656";
pub(super) const TESTNET_PERSISTENT_PEERS: &str =
    "3f472746f46493309650e5a033076689996c8881@testnet-seed.injective.network:26656,dacd5d0afce07bd5e43f33b1f5be4ad2f7f9f273@134.209.251.247:26656,8e7a64daa7793f36f68f4cb1ee2f9744a10f94ac@143.198.139.33:26656,e265d636f4f7731207a70f9fcf7b51532aae5820@68.183.176.90:26656,fc86277053c2e045790d44591e8f375f16d991f2@143.198.29.21:26656";

#[derive(Clone, Copy, Debug)]
pub(super) struct InjectiveLocalRuntime {
    pub(super) chain_id: &'static str,
    pub(super) moniker: &'static str,
    pub(super) status_url: &'static str,
    pub(super) rpc_laddr: &'static str,
    pub(super) grpc_address: &'static str,
    pub(super) api_address: &'static str,
    pub(super) home_dir: &'static str,
    pub(super) pid_file: &'static str,
    pub(super) log_file: &'static str,
    pub(super) validator_key: &'static str,
    pub(super) genesis_account_amount: &'static str,
    pub(super) gentx_amount: &'static str,
}

#[derive(Clone, Copy, Debug)]
pub(super) struct InjectiveTestnetRuntime {
    pub(super) chain_id: &'static str,
    pub(super) moniker: &'static str,
    pub(super) trust_rpc_url: &'static str,
    pub(super) status_url: &'static str,
    pub(super) rpc_laddr: &'static str,
    pub(super) grpc_address: &'static str,
    pub(super) api_address: &'static str,
    pub(super) genesis_url: &'static str,
    pub(super) home_dir: &'static str,
    pub(super) pid_file: &'static str,
    pub(super) log_file: &'static str,
    pub(super) trust_offset: u64,
    pub(super) seeds: &'static str,
    pub(super) persistent_peers: &'static str,
}

#[derive(Clone, Copy, Debug)]
pub(super) struct InjectiveRuntime {
    pub(super) source_repo_url: &'static str,
    pub(super) source_dir: &'static str,
    pub(super) local: InjectiveLocalRuntime,
    pub(super) testnet: InjectiveTestnetRuntime,
}

const LOCAL_RUNTIME: InjectiveLocalRuntime = InjectiveLocalRuntime {
    chain_id: LOCAL_CHAIN_ID,
    moniker: LOCAL_MONIKER,
    status_url: LOCAL_STATUS_URL,
    rpc_laddr: LOCAL_RPC_LADDR,
    grpc_address: LOCAL_GRPC_ADDRESS,
    api_address: LOCAL_API_ADDRESS,
    home_dir: LOCAL_HOME_DIR,
    pid_file: LOCAL_PID_FILE,
    log_file: LOCAL_LOG_FILE,
    validator_key: LOCAL_VALIDATOR_KEY,
    genesis_account_amount: LOCAL_GENESIS_ACCOUNT_AMOUNT,
    gentx_amount: LOCAL_GENTX_AMOUNT,
};

const TESTNET_RUNTIME: InjectiveTestnetRuntime = InjectiveTestnetRuntime {
    chain_id: TESTNET_CHAIN_ID,
    moniker: TESTNET_MONIKER,
    trust_rpc_url: TESTNET_TRUST_RPC_URL,
    status_url: TESTNET_STATUS_URL,
    rpc_laddr: TESTNET_RPC_LADDR,
    grpc_address: TESTNET_GRPC_ADDRESS,
    api_address: TESTNET_API_ADDRESS,
    genesis_url: TESTNET_GENESIS_URL,
    home_dir: TESTNET_HOME_DIR,
    pid_file: TESTNET_PID_FILE,
    log_file: TESTNET_LOG_FILE,
    trust_offset: TESTNET_TRUST_OFFSET,
    seeds: TESTNET_SEEDS,
    persistent_peers: TESTNET_PERSISTENT_PEERS,
};

const INJECTIVE_RUNTIME: InjectiveRuntime = InjectiveRuntime {
    source_repo_url: SOURCE_REPO_URL,
    source_dir: SOURCE_DIR,
    local: LOCAL_RUNTIME,
    testnet: TESTNET_RUNTIME,
};

pub(super) fn runtime() -> &'static InjectiveRuntime {
    &INJECTIVE_RUNTIME
}

pub(super) fn local_runtime() -> &'static InjectiveLocalRuntime {
    &INJECTIVE_RUNTIME.local
}

pub(super) fn testnet_runtime() -> &'static InjectiveTestnetRuntime {
    &INJECTIVE_RUNTIME.testnet
}

pub(super) fn resolve_home_relative_path(
    relative_path: &str,
) -> Result<PathBuf, Box<dyn std::error::Error>> {
    home_dir()
        .map(|path| path.join(relative_path))
        .ok_or_else(|| "Unable to resolve home directory".into())
}

pub(super) fn parse_port_from_url(url: &str, field_name: &str) -> Result<u16, String> {
    let parsed = reqwest::Url::parse(url)
        .map_err(|error| format!("Invalid Injective {} '{}': {}", field_name, url, error))?;
    parsed.port_or_known_default().ok_or_else(|| {
        format!(
            "Injective {} '{}' does not include a known port",
            field_name, url
        )
    })
}

pub(super) fn parse_port_from_socket_address(
    address: &str,
    field_name: &str,
) -> Result<u16, String> {
    let port_text = address
        .trim()
        .rsplit(':')
        .next()
        .ok_or_else(|| format!("Invalid Injective {} '{}'", field_name, address))?;

    port_text.parse::<u16>().map_err(|error| {
        format!(
            "Invalid Injective {} '{}' (cannot parse port): {}",
            field_name, address, error
        )
    })
}
