pub(super) const SOURCE_REPO_URL: &str =
    "https://github.com/InjectiveFoundation/injective-core.git";
pub(super) const SOURCE_DIR: &str = ".caribic/injective/injective-core";
pub(super) const LOCAL_DOCKER_IMAGE: &str = "injectivelabs/injective-core:v1.18.0";

pub(super) const LOCAL_CHAIN_ID: &str = "injective-777";
pub(super) const LOCAL_MONIKER: &str = "caribic-injective-local";
pub(super) const LOCAL_STATUS_URL: &str = "http://127.0.0.1:26660/status";
pub(super) const LOCAL_RPC_PORT: u16 = 26660;
pub(super) const LOCAL_GRPC_PORT: u16 = 9097;
pub(super) const LOCAL_HOME_DIR: &str = ".injectived-local";
pub(super) const LOCAL_VALIDATOR_KEY: &str = "validator";
pub(super) const LOCAL_VALIDATOR_MNEMONIC: &str =
    "bottom loan skill merry east cradle onion journey palm apology verb edit desert impose absurd oil bubble sweet glove shallow size build burst effort";
pub(super) const LOCAL_GENESIS_ACCOUNT_AMOUNT: &str =
    "100000000000000000000stake,100000000000000000000inj";
pub(super) const LOCAL_GENTX_AMOUNT: &str = "50000000000000000000stake";

pub(super) const TESTNET_CHAIN_ID: &str = "injective-888";
pub(super) const TESTNET_MONIKER: &str = "caribic-injective-testnet";
pub(super) const TESTNET_TRUST_RPC_URL: &str = "https://testnet.sentry.tm.injective.network";
pub(super) const TESTNET_FALLBACK_TRUST_RPC_URLS: [&str; 2] = [
    "https://injective-testnet-rpc.polkachu.com",
    "https://k8s.testnet.tm.injective.network",
];
pub(super) const TESTNET_STATUS_URL: &str = "http://127.0.0.1:26659/status";
pub(super) const TESTNET_RPC_LADDR: &str = "tcp://0.0.0.0:26659";
pub(super) const TESTNET_GRPC_ADDRESS: &str = "0.0.0.0:9096";
pub(super) const TESTNET_API_ADDRESS: &str = "tcp://0.0.0.0:1319";
pub(super) const TESTNET_GENESIS_URL: &str =
    "https://injective-snapshots.s3.amazonaws.com/testnet/genesis.json";
pub(super) const TESTNET_HOME_DIR: &str = ".injectived-testnet";
pub(super) const TESTNET_PID_FILE: &str = ".caribic/injective-testnet.pid";
pub(super) const TESTNET_LOG_FILE: &str = ".caribic/injective-testnet.log";
// Injective testnet peers often advertise snapshots that lag several hundred-thousand
// blocks behind latest height; use a larger trust offset so state-sync can verify
// available snapshots instead of selecting a trust height newer than them.
pub(super) const TESTNET_TRUST_OFFSET: u64 = 500_000;
pub(super) const TESTNET_SEEDS: &str =
    "12bee87dc66d7a42b0d7223251bc54aa5678b5f0@150.136.41.99:26656,473da43c3ce39dd1fa5dac85ea2c66ef0671ab71@67.213.127.205:26656,58fddbdb9414637c8a748d98dc58cf95ac998052@150.136.66.61:26656,492264962400eceee2b3a6b20737b888b5fe6feb@23.227.221.57:26656,24e3d9f290791b8a9ab5a00e4b73475d7abef611@15.204.65.64:26656,fc2d53927edb2e5dce520d42d1520d54df8e9039@150.136.78.138:26656,08541d6a65c17e1608f286e3314dacc0cb5bc243@23.88.69.101:26656,7f3a249c11d53b7bd828f59f19a144dd6025d822@129.213.25.42:26656";
pub(super) const TESTNET_PERSISTENT_PEERS: &str =
    "12bee87dc66d7a42b0d7223251bc54aa5678b5f0@150.136.41.99:26656,473da43c3ce39dd1fa5dac85ea2c66ef0671ab71@67.213.127.205:26656,58fddbdb9414637c8a748d98dc58cf95ac998052@150.136.66.61:26656,492264962400eceee2b3a6b20737b888b5fe6feb@23.227.221.57:26656,24e3d9f290791b8a9ab5a00e4b73475d7abef611@15.204.65.64:26656,fc2d53927edb2e5dce520d42d1520d54df8e9039@150.136.78.138:26656,08541d6a65c17e1608f286e3314dacc0cb5bc243@23.88.69.101:26656,7f3a249c11d53b7bd828f59f19a144dd6025d822@129.213.25.42:26656";
