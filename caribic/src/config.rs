use crate::logger::error;
use lazy_static::lazy_static;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::process;
use std::sync::Mutex;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Config {
    pub project_root: String,
    pub chains: Chains,
    pub mithril: Mithril,
    pub runtime: Runtime,
    pub relayer: Relayer,
    pub cardano: Cardano,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Chains {
    pub cardano: ChainConfig,
    pub entrypoint: EntrypointChainConfig,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ChainConfig {
    pub chain_id: String,
    pub message_port_id: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct EntrypointChainConfig {
    pub chain_id: String,
    pub message_port_id: String,
    pub rpc_addr: String,
    pub grpc_addr: String,
    pub container_name: String,
    pub home_dir: String,
    pub keyring_container_path: String,
    pub relayer_key_name: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Mithril {
    pub enabled: bool,
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

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Runtime {
    pub cosmos_status_url: String,
    pub cosmos_max_retries: u32,
    pub cosmos_retry_interval_ms: u64,
    pub gateway_max_retries: u32,
    pub gateway_retry_interval_ms: u64,
    pub mithril_artifact_max_retries: usize,
    pub mithril_artifact_retry_delay_secs: u64,
    pub message_exchange: MessageExchangeRuntime,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct MessageExchangeRuntime {
    pub vessel_default_imo: String,
    pub cardano_min_sync_progress: f64,
    pub cardano_max_safe_epoch: u64,
    pub consolidated_report_max_retries: usize,
    pub consolidated_report_retry_delay_secs: u64,
    pub channel_discovery_max_retries: usize,
    pub channel_discovery_max_retries_after_create: usize,
    pub channel_discovery_retry_delay_secs: u64,
    pub connection_discovery_max_retries: usize,
    pub connection_discovery_retry_delay_secs: u64,
    pub mithril_readiness_progress_interval_secs: u64,
    pub relay_max_retries: usize,
    pub relay_retry_delay_secs: u64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Relayer {
    pub entrypoint_mnemonic: String,
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

impl Config {
    fn default() -> Self {
        serde_json::from_str(include_str!("../config/default-config.json"))
            .expect("Failed to parse bundled default config template")
    }

    fn resolve_path_from_config_dir(config_dir: &Path, configured_path: &str) -> String {
        let raw_path = Path::new(configured_path);
        if raw_path.is_absolute() {
            return configured_path.to_string();
        }

        let resolved_path = config_dir.join(raw_path);
        if let Ok(canonicalized) = resolved_path.canonicalize() {
            return canonicalized.to_string_lossy().to_string();
        }

        resolved_path.to_string_lossy().to_string()
    }

    fn resolve_runtime_paths(mut config: Self, config_path: &Path) -> Self {
        if let Some(config_dir) = config_path.parent() {
            config.project_root =
                Self::resolve_path_from_config_dir(config_dir, &config.project_root);
            config.mithril.cardano_node_dir =
                Self::resolve_path_from_config_dir(config_dir, &config.mithril.cardano_node_dir);
        }

        config
    }

    async fn load_from_file(config_path: &str) -> Self {
        let config_path_buf = PathBuf::from(config_path);

        if !config_path_buf.exists() {
            error(&format!(
                "Config file not found: {}. caribic requires caribic/config/default-config.json to exist.",
                config_path
            ));
            process::exit(1);
        }

        let file_content =
            fs::read_to_string(&config_path_buf).expect("Failed to read config file.");
        let config = serde_json::from_str(&file_content).unwrap_or_else(|parse_error| {
            error(&format!(
                "Failed to parse config file at {}: {}",
                config_path, parse_error
            ));
            process::exit(1);
        });

        Self::resolve_runtime_paths(config, &config_path_buf)
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
