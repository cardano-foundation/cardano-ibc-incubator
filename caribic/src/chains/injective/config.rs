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
