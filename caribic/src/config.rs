use crate::logger::{error, get_verbosity, log, verbose, Verbosity};
use console::style;
use dirs::home_dir;
use fs_extra::dir::create_all;
use lazy_static::lazy_static;
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::{stdin, stdout, Write};
use std::path::Path;
use std::process;
use std::sync::Mutex;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Config {
    pub project_root: String,
    #[serde(default)]
    pub chains: Chains,
    #[serde(default)]
    pub optional_chains: OptionalChains,
    pub mithril: Mithril,
    #[serde(default)]
    pub health: Health,
    #[serde(default)]
    pub demo: Demo,
    pub cardano: Cardano,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Chains {
    #[serde(default)]
    pub cardano: CardanoChain,
    #[serde(default)]
    pub entrypoint: EntrypointChain,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct OptionalChains {
    #[serde(default)]
    pub injective: Injective,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Injective {
    #[serde(default = "default_injective_source_repo_url")]
    pub source_repo_url: String,
    #[serde(default = "default_injective_source_dir")]
    pub source_dir: String,
    #[serde(default)]
    pub local: InjectiveLocal,
    #[serde(default)]
    pub testnet: InjectiveTestnet,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct InjectiveLocal {
    #[serde(default = "default_injective_local_chain_id")]
    pub chain_id: String,
    #[serde(default = "default_injective_local_moniker")]
    pub moniker: String,
    #[serde(default = "default_injective_local_status_url")]
    pub status_url: String,
    #[serde(default = "default_injective_local_rpc_laddr")]
    pub rpc_laddr: String,
    #[serde(default = "default_injective_local_grpc_address")]
    pub grpc_address: String,
    #[serde(default = "default_injective_local_api_address")]
    pub api_address: String,
    #[serde(default = "default_injective_local_home_dir")]
    pub home_dir: String,
    #[serde(default = "default_injective_local_pid_file")]
    pub pid_file: String,
    #[serde(default = "default_injective_local_log_file")]
    pub log_file: String,
    #[serde(default = "default_injective_local_validator_key")]
    pub validator_key: String,
    #[serde(default = "default_injective_local_genesis_account_amount")]
    pub genesis_account_amount: String,
    #[serde(default = "default_injective_local_gentx_amount")]
    pub gentx_amount: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct InjectiveTestnet {
    #[serde(default = "default_injective_testnet_chain_id")]
    pub chain_id: String,
    #[serde(default = "default_injective_testnet_moniker")]
    pub moniker: String,
    #[serde(default = "default_injective_testnet_trust_rpc_url")]
    pub trust_rpc_url: String,
    #[serde(default = "default_injective_testnet_status_url")]
    pub status_url: String,
    #[serde(default = "default_injective_testnet_rpc_laddr")]
    pub rpc_laddr: String,
    #[serde(default = "default_injective_testnet_grpc_address")]
    pub grpc_address: String,
    #[serde(default = "default_injective_testnet_api_address")]
    pub api_address: String,
    #[serde(default = "default_injective_testnet_genesis_url")]
    pub genesis_url: String,
    #[serde(default = "default_injective_testnet_home_dir")]
    pub home_dir: String,
    #[serde(default = "default_injective_testnet_pid_file")]
    pub pid_file: String,
    #[serde(default = "default_injective_testnet_log_file")]
    pub log_file: String,
    #[serde(default = "default_injective_testnet_trust_offset")]
    pub trust_offset: u64,
    #[serde(default = "default_injective_testnet_seeds")]
    pub seeds: String,
    #[serde(default = "default_injective_testnet_persistent_peers")]
    pub persistent_peers: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CardanoChain {
    #[serde(default = "default_cardano_chain_id")]
    pub chain_id: String,
    #[serde(default = "default_cardano_message_port_id")]
    pub message_port_id: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct EntrypointChain {
    #[serde(default = "default_entrypoint_chain_id")]
    pub chain_id: String,
    #[serde(default = "default_entrypoint_message_port_id")]
    pub message_port_id: String,
}

fn default_cardano_chain_id() -> String {
    "cardano-devnet".to_string()
}

fn default_cardano_message_port_id() -> String {
    "transfer".to_string()
}

fn default_entrypoint_chain_id() -> String {
    "entrypoint".to_string()
}

fn default_entrypoint_message_port_id() -> String {
    "transfer".to_string()
}

fn default_injective_source_repo_url() -> String {
    "https://github.com/InjectiveFoundation/injective-core.git".to_string()
}

fn default_injective_source_dir() -> String {
    ".caribic/injective/injective-core".to_string()
}

fn default_injective_local_chain_id() -> String {
    "injective-777".to_string()
}

fn default_injective_local_moniker() -> String {
    "caribic-injective-local".to_string()
}

fn default_injective_local_status_url() -> String {
    "http://127.0.0.1:26660/status".to_string()
}

fn default_injective_local_rpc_laddr() -> String {
    "tcp://0.0.0.0:26660".to_string()
}

fn default_injective_local_grpc_address() -> String {
    "0.0.0.0:9097".to_string()
}

fn default_injective_local_api_address() -> String {
    "tcp://0.0.0.0:1320".to_string()
}

fn default_injective_local_home_dir() -> String {
    ".injectived-local".to_string()
}

fn default_injective_local_pid_file() -> String {
    ".caribic/injective-local.pid".to_string()
}

fn default_injective_local_log_file() -> String {
    ".caribic/injective-local.log".to_string()
}

fn default_injective_local_validator_key() -> String {
    "validator".to_string()
}

fn default_injective_local_genesis_account_amount() -> String {
    "100000000000000000000stake".to_string()
}

fn default_injective_local_gentx_amount() -> String {
    "50000000000000000000stake".to_string()
}

fn default_injective_testnet_chain_id() -> String {
    "injective-888".to_string()
}

fn default_injective_testnet_moniker() -> String {
    "caribic-injective-testnet".to_string()
}

fn default_injective_testnet_trust_rpc_url() -> String {
    "https://testnet.sentry.tm.injective.network".to_string()
}

fn default_injective_testnet_status_url() -> String {
    "http://127.0.0.1:26659/status".to_string()
}

fn default_injective_testnet_rpc_laddr() -> String {
    "tcp://0.0.0.0:26659".to_string()
}

fn default_injective_testnet_grpc_address() -> String {
    "0.0.0.0:9096".to_string()
}

fn default_injective_testnet_api_address() -> String {
    "tcp://0.0.0.0:1319".to_string()
}

fn default_injective_testnet_genesis_url() -> String {
    "https://raw.githubusercontent.com/InjectiveLabs/testnet/main/testnet-1/genesis.json"
        .to_string()
}

fn default_injective_testnet_home_dir() -> String {
    ".injectived-testnet".to_string()
}

fn default_injective_testnet_pid_file() -> String {
    ".caribic/injective-testnet.pid".to_string()
}

fn default_injective_testnet_log_file() -> String {
    ".caribic/injective-testnet.log".to_string()
}

fn default_injective_testnet_trust_offset() -> u64 {
    1500
}

fn default_injective_testnet_seeds() -> String {
    "20a548c1ede8f31d13309171f76e0f4624e126b8@seed.testnet.injective.network:26656".to_string()
}

fn default_injective_testnet_persistent_peers() -> String {
    "3f472746f46493309650e5a033076689996c8881@testnet-seed.injective.network:26656,dacd5d0afce07bd5e43f33b1f5be4ad2f7f9f273@134.209.251.247:26656,8e7a64daa7793f36f68f4cb1ee2f9744a10f94ac@143.198.139.33:26656,e265d636f4f7731207a70f9fcf7b51532aae5820@68.183.176.90:26656,fc86277053c2e045790d44591e8f375f16d991f2@143.198.29.21:26656".to_string()
}

impl Default for CardanoChain {
    fn default() -> Self {
        CardanoChain {
            chain_id: default_cardano_chain_id(),
            message_port_id: default_cardano_message_port_id(),
        }
    }
}

impl Default for EntrypointChain {
    fn default() -> Self {
        EntrypointChain {
            chain_id: default_entrypoint_chain_id(),
            message_port_id: default_entrypoint_message_port_id(),
        }
    }
}

impl Default for Chains {
    fn default() -> Self {
        Chains {
            cardano: CardanoChain::default(),
            entrypoint: EntrypointChain::default(),
        }
    }
}

impl Default for InjectiveLocal {
    fn default() -> Self {
        InjectiveLocal {
            chain_id: default_injective_local_chain_id(),
            moniker: default_injective_local_moniker(),
            status_url: default_injective_local_status_url(),
            rpc_laddr: default_injective_local_rpc_laddr(),
            grpc_address: default_injective_local_grpc_address(),
            api_address: default_injective_local_api_address(),
            home_dir: default_injective_local_home_dir(),
            pid_file: default_injective_local_pid_file(),
            log_file: default_injective_local_log_file(),
            validator_key: default_injective_local_validator_key(),
            genesis_account_amount: default_injective_local_genesis_account_amount(),
            gentx_amount: default_injective_local_gentx_amount(),
        }
    }
}

impl Default for InjectiveTestnet {
    fn default() -> Self {
        InjectiveTestnet {
            chain_id: default_injective_testnet_chain_id(),
            moniker: default_injective_testnet_moniker(),
            trust_rpc_url: default_injective_testnet_trust_rpc_url(),
            status_url: default_injective_testnet_status_url(),
            rpc_laddr: default_injective_testnet_rpc_laddr(),
            grpc_address: default_injective_testnet_grpc_address(),
            api_address: default_injective_testnet_api_address(),
            genesis_url: default_injective_testnet_genesis_url(),
            home_dir: default_injective_testnet_home_dir(),
            pid_file: default_injective_testnet_pid_file(),
            log_file: default_injective_testnet_log_file(),
            trust_offset: default_injective_testnet_trust_offset(),
            seeds: default_injective_testnet_seeds(),
            persistent_peers: default_injective_testnet_persistent_peers(),
        }
    }
}

impl Default for Injective {
    fn default() -> Self {
        Injective {
            source_repo_url: default_injective_source_repo_url(),
            source_dir: default_injective_source_dir(),
            local: InjectiveLocal::default(),
            testnet: InjectiveTestnet::default(),
        }
    }
}

impl Default for OptionalChains {
    fn default() -> Self {
        OptionalChains {
            injective: Injective::default(),
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Mithril {
    pub enabled: bool,
    #[serde(default = "default_mithril_aggregator_url")]
    pub aggregator_url: String,
    pub genesis_verification_key: String,
    pub genesis_secret_key: String,
    pub chain_observer_type: String,
    pub cardano_node_dir: String,
    pub cardano_node_version: String,
    pub aggregator_image: String,
    pub client_image: String,
    pub signer_image: String,
}

fn default_mithril_aggregator_url() -> String {
    "http://127.0.0.1:8080".to_string()
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Health {
    #[serde(default = "default_cosmos_status_url")]
    pub cosmos_status_url: String,
    #[serde(default = "default_cosmos_max_retries")]
    pub cosmos_max_retries: u32,
    #[serde(default = "default_cosmos_retry_interval_ms")]
    pub cosmos_retry_interval_ms: u64,
    #[serde(default = "default_gateway_max_retries")]
    pub gateway_max_retries: u32,
    #[serde(default = "default_gateway_retry_interval_ms")]
    pub gateway_retry_interval_ms: u64,
}

fn default_cosmos_status_url() -> String {
    "http://127.0.0.1:26657/status".to_string()
}

fn default_cosmos_max_retries() -> u32 {
    60
}

fn default_cosmos_retry_interval_ms() -> u64 {
    10000
}

fn default_gateway_max_retries() -> u32 {
    60
}

fn default_gateway_retry_interval_ms() -> u64 {
    1000
}

impl Default for Health {
    fn default() -> Self {
        Health {
            cosmos_status_url: default_cosmos_status_url(),
            cosmos_max_retries: default_cosmos_max_retries(),
            cosmos_retry_interval_ms: default_cosmos_retry_interval_ms(),
            gateway_max_retries: default_gateway_max_retries(),
            gateway_retry_interval_ms: default_gateway_retry_interval_ms(),
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Demo {
    #[serde(default = "default_demo_mithril_artifact_max_retries")]
    pub mithril_artifact_max_retries: usize,
    #[serde(default = "default_demo_mithril_artifact_retry_delay_secs")]
    pub mithril_artifact_retry_delay_secs: u64,
    #[serde(default)]
    pub message_exchange: MessageExchangeDemo,
}

fn default_demo_mithril_artifact_max_retries() -> usize {
    240
}

fn default_demo_mithril_artifact_retry_delay_secs() -> u64 {
    5
}

impl Default for Demo {
    fn default() -> Self {
        Demo {
            mithril_artifact_max_retries: default_demo_mithril_artifact_max_retries(),
            mithril_artifact_retry_delay_secs: default_demo_mithril_artifact_retry_delay_secs(),
            message_exchange: MessageExchangeDemo::default(),
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct MessageExchangeDemo {
    #[serde(default = "default_message_consolidated_report_max_retries")]
    pub consolidated_report_max_retries: usize,
    #[serde(default = "default_message_consolidated_report_retry_delay_secs")]
    pub consolidated_report_retry_delay_secs: u64,
    #[serde(default = "default_message_channel_discovery_max_retries")]
    pub channel_discovery_max_retries: usize,
    #[serde(default = "default_message_channel_discovery_after_create_max_retries")]
    pub channel_discovery_max_retries_after_create: usize,
    #[serde(default = "default_message_channel_discovery_retry_delay_secs")]
    pub channel_discovery_retry_delay_secs: u64,
    #[serde(default = "default_message_connection_discovery_max_retries")]
    pub connection_discovery_max_retries: usize,
    #[serde(default = "default_message_connection_discovery_retry_delay_secs")]
    pub connection_discovery_retry_delay_secs: u64,
    #[serde(default = "default_message_mithril_readiness_progress_interval_secs")]
    pub mithril_readiness_progress_interval_secs: u64,
    #[serde(default = "default_message_relay_max_retries")]
    pub relay_max_retries: usize,
    #[serde(default = "default_message_relay_retry_delay_secs")]
    pub relay_retry_delay_secs: u64,
}

fn default_message_consolidated_report_max_retries() -> usize {
    40
}

fn default_message_consolidated_report_retry_delay_secs() -> u64 {
    3
}

fn default_message_channel_discovery_max_retries() -> usize {
    20
}

fn default_message_channel_discovery_after_create_max_retries() -> usize {
    120
}

fn default_message_channel_discovery_retry_delay_secs() -> u64 {
    3
}

fn default_message_connection_discovery_max_retries() -> usize {
    20
}

fn default_message_connection_discovery_retry_delay_secs() -> u64 {
    3
}

fn default_message_mithril_readiness_progress_interval_secs() -> u64 {
    30
}

fn default_message_relay_max_retries() -> usize {
    20
}

fn default_message_relay_retry_delay_secs() -> u64 {
    3
}

impl Default for MessageExchangeDemo {
    fn default() -> Self {
        MessageExchangeDemo {
            consolidated_report_max_retries: default_message_consolidated_report_max_retries(),
            consolidated_report_retry_delay_secs:
                default_message_consolidated_report_retry_delay_secs(),
            channel_discovery_max_retries: default_message_channel_discovery_max_retries(),
            channel_discovery_max_retries_after_create:
                default_message_channel_discovery_after_create_max_retries(),
            channel_discovery_retry_delay_secs: default_message_channel_discovery_retry_delay_secs(
            ),
            connection_discovery_max_retries: default_message_connection_discovery_max_retries(),
            connection_discovery_retry_delay_secs:
                default_message_connection_discovery_retry_delay_secs(),
            mithril_readiness_progress_interval_secs:
                default_message_mithril_readiness_progress_interval_secs(),
            relay_max_retries: default_message_relay_max_retries(),
            relay_retry_delay_secs: default_message_relay_retry_delay_secs(),
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Cardano {
    pub services: Services,
    pub bootstrap_addresses: Vec<BootstrapAddress>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct BootstrapAddress {
    pub address: String,
    pub amount: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Services {
    pub db_sync: bool,
    pub kupo: bool,
    pub ogmios: bool,
    pub cardano_node: bool,
    pub postgres: bool,
}

pub async fn create_config_file(config_path: &str) -> Config {
    let mut default_config = Config::default();

    if get_verbosity() == Verbosity::Verbose
        || get_verbosity() == Verbosity::Info
        || get_verbosity() == Verbosity::Standard
    {
        println!("Config file not found at: {}", config_path);
        let mut input = String::new();
        log(&format!(
            "Do you want to create it now? ({}es/no): ",
            style("y").bold().underlined()
        ));
        stdout().flush().unwrap();
        stdin().read_line(&mut input).unwrap();

        if let Some(home_path) = home_dir() {
            if input.trim().eq_ignore_ascii_case("yes")
                || input.trim().eq_ignore_ascii_case("y")
                || input.trim().is_empty()
            {
                let default_project_root =
                    format!("{}/cardano-ibc-incubator", home_path.as_path().display());
                log(&format!(
                    "Enter the project root path for 'cardano-ibc-incubator' (default: {}):",
                    default_project_root
                ));

                let mut project_root = String::new();
                stdin().read_line(&mut project_root).unwrap();
                let mut project_root = if project_root.trim().is_empty() {
                    default_project_root
                } else {
                    project_root.trim().to_string()
                };

                if project_root.starts_with("~") {
                    project_root = project_root.replace("~", home_path.to_str().unwrap());
                }
                let project_root_path = Path::new(&project_root);

                if !project_root_path.exists() {
                    error(&format!(
                        "Project root does not exist: {}",
                        project_root_path.display()
                    ));
                    log("Clone the repository first, for example:");
                    log("  git clone --recurse-submodules https://github.com/cardano-foundation/cardano-ibc-incubator.git");
                    process::exit(1);
                }

                default_config.project_root = project_root.clone();
                default_config.mithril.cardano_node_dir =
                    format!("{}/chains/cardano/devnet", project_root);
                verbose(&format!(
                    "Project root path set to: {}",
                    default_config.project_root
                ));
            } else {
                error("Config file not found. Exiting.");
                process::exit(0);
            }
        } else {
            error("Failed to resolve home directory. Exiting.");
            process::exit(0);
        }
    } else {
        error("No config file has been found. Creating a new config does not work with log levels warning, error or quiet.");
        process::exit(0);
    }

    verbose(&format!("caribic config file: {:#?}", default_config));

    default_config
}

impl Config {
    fn resolve_repo_project_root_from_default_config_path(config_path: &Path) -> Option<String> {
        let file_name = config_path.file_name()?.to_str()?;
        if file_name != "default-config.json" {
            return None;
        }

        // Expected layout: <repo-root>/caribic/config/default-config.json
        let config_dir = config_path.parent()?;
        if config_dir.file_name()?.to_str()? != "config" {
            return None;
        }
        let caribic_dir = config_dir.parent()?;
        if caribic_dir.file_name()?.to_str()? != "caribic" {
            return None;
        }

        let repo_root = caribic_dir.parent()?;
        Some(repo_root.to_string_lossy().to_string())
    }

    fn apply_runtime_path_overrides(mut config: Self, config_path: &Path) -> Self {
        if let Some(repo_root) =
            Self::resolve_repo_project_root_from_default_config_path(config_path)
        {
            config.project_root = repo_root.clone();
            config.mithril.cardano_node_dir = format!("{}/chains/cardano/devnet", repo_root);
        }

        config
    }

    fn default() -> Self {
        let mut default_config = Config {
            project_root: "/root/cardano-ibc-incubator".to_string(),
            chains: Chains::default(),
            optional_chains: OptionalChains::default(),
            mithril: {
                Mithril {
                    enabled: true,
                    aggregator_url: default_mithril_aggregator_url(),
                    genesis_verification_key: "5b33322c3235332c3138362c3230312c3137372c31312c3131372c3133352c3138372c3136372c3138312c3138382c32322c35392c3230362c3130352c3233312c3135302c3231352c33302c37382c3231322c37362c31362c3235322c3138302c37322c3133342c3133372c3234372c3136312c36385d".to_string(),
                    genesis_secret_key: "5b3131382c3138342c3232342c3137332c3136302c3234312c36312c3134342c36342c39332c3130362c3232392c38332c3133342c3138392c34302c3138392c3231302c32352c3138342c3136302c3134312c3233372c32362c3136382c35342c3233392c3230342c3133392c3131392c31332c3139395d".to_string(),
                    chain_observer_type: "pallas".to_string(),
                    cardano_node_dir: "/root/cardano-ibc-incubator/chains/cardano/devnet".to_string(),
                    cardano_node_version: "9.1.4".to_string(),
                    aggregator_image: "ghcr.io/input-output-hk/mithril-aggregator:2450.0-c6c7eba".to_string(),
                    signer_image: "ghcr.io/input-output-hk/mithril-signer:2450.0-c6c7eba".to_string(),
                    client_image: "ghcr.io/input-output-hk/mithril-client:2450.0-c6c7eba".to_string(),
                }
            },
            health: Health::default(),
            demo: Demo::default(),
            cardano: Cardano {
            services: Services {
                db_sync: true,
                kupo: true,
                ogmios: true,
                cardano_node: true,
                postgres: true,
            },
            bootstrap_addresses: vec![
                BootstrapAddress {
                    address: "addr_test1qrwuz99eywdpm9puylccmvqfu6lue968rtt36nzeal7czuu4wq3n84h8ntp3ta30kyxx8r0x2u4tgr5a8y9hp5vjpngsmwy0wg".to_string(),
                    amount: 60000000000,
                },
                BootstrapAddress {
                    address: "addr_test1vz8nzrmel9mmmu97lm06uvm55cj7vny6dxjqc0y0efs8mtqsd8r5m".to_string(),
                    amount: 30000000000,
                },
                BootstrapAddress {
                    address: "addr_test1vqj82u9chf7uwf0flum7jatms9ytf4dpyk2cakkzl4zp0wqgsqnql".to_string(),
                    amount: 30000000000,
                },
                BootstrapAddress {
                    address: "addr_test1wzfvnh20kanpp0qppn5a92kaamjdu9jfamt8hxqqrl43t7c2jw6u4".to_string(),
                    amount: 30000000000,
                },
            ]},
        };

        if let Some(home_path) = home_dir() {
            let default_project_root =
                format!("{}/cardano-ibc-incubator", home_path.as_path().display());
            default_config.project_root = default_project_root.clone();
            default_config.mithril.cardano_node_dir =
                format!("{}/chains/cardano/devnet", default_project_root);
        }
        default_config
    }

    async fn load_from_file(config_path: &str) -> Self {
        let config_path_buf = Path::new(config_path);
        if config_path_buf.exists() {
            let file_content =
                fs::read_to_string(config_path).expect("Failed to read config file.");
            let config: Self = serde_json::from_str(&file_content).unwrap_or_else(|parse_error| {
                error(&format!(
                    "Failed to parse config file at {}: {}",
                    config_path, parse_error
                ));
                process::exit(1);
            });
            Self::apply_runtime_path_overrides(config, config_path_buf)
        } else {
            let default_config = create_config_file(config_path).await;
            let parent_dir = config_path_buf.parent().unwrap();
            create_all(parent_dir, false).expect("Failed to create config dir.");
            let json_content = serde_json::to_string_pretty(&default_config)
                .expect("Failed to serialize default config.");
            fs::write(config_path_buf, json_content).expect("Failed to write default config file.");
            Self::apply_runtime_path_overrides(default_config, config_path_buf)
        }
    }
}

lazy_static! {
    static ref CONFIG: Mutex<Config> = Mutex::new(Config::default());
}

pub async fn init(config_path: &str) {
    let mut config = CONFIG.lock().unwrap();
    *config = Config::load_from_file(config_path).await;
}

pub fn get_config() -> Config {
    CONFIG.lock().unwrap().clone()
}
