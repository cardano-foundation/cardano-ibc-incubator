use crate::logger::error;
use lazy_static::lazy_static;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;
use std::process;
use std::sync::Mutex;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Config {
    pub project_root: String,
    pub chains: Chains,
    pub mithril: Mithril,
    pub health: Health,
    pub demo: Demo,
    pub cardano: Cardano,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Chains {
    pub cardano: CardanoChain,
    pub entrypoint: EntrypointChain,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CardanoChain {
    pub chain_id: String,
    pub message_port_id: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct EntrypointChain {
    pub chain_id: String,
    pub message_port_id: String,
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
pub struct Health {
    pub cosmos_status_url: String,
    pub cosmos_max_retries: u32,
    pub cosmos_retry_interval_ms: u64,
    pub gateway_max_retries: u32,
    pub gateway_retry_interval_ms: u64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Demo {
    pub mithril_artifact_max_retries: usize,
    pub mithril_artifact_retry_delay_secs: u64,
    pub message_exchange: MessageExchangeDemo,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct MessageExchangeDemo {
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
    fn resolve_path_from_config_dir(config_path: &Path, configured_path: &str) -> String {
        let path = Path::new(configured_path);
        if path.is_absolute() {
            return configured_path.to_string();
        }

        let Some(config_dir) = config_path.parent() else {
            return configured_path.to_string();
        };

        let joined_path = config_dir.join(path);
        joined_path
            .canonicalize()
            .unwrap_or(joined_path)
            .to_string_lossy()
            .to_string()
    }

    fn resolve_runtime_paths(mut config: Self, config_path: &Path) -> Self {
        config.project_root = Self::resolve_path_from_config_dir(config_path, &config.project_root);
        config.mithril.cardano_node_dir =
            Self::resolve_path_from_config_dir(config_path, &config.mithril.cardano_node_dir);
        config
    }

    fn load_from_file(config_path: &str) -> Self {
        let config_path_buf = Path::new(config_path);
        if !config_path_buf.exists() {
            error(&format!(
                "Required config file not found at {}",
                config_path_buf.display()
            ));
            process::exit(1);
        }

        let file_content = fs::read_to_string(config_path_buf).unwrap_or_else(|read_error| {
            error(&format!(
                "Failed to read config file at {}: {}",
                config_path_buf.display(),
                read_error
            ));
            process::exit(1);
        });

        let config: Self = serde_json::from_str(&file_content).unwrap_or_else(|parse_error| {
            error(&format!(
                "Failed to parse config file at {}: {}",
                config_path_buf.display(),
                parse_error
            ));
            process::exit(1);
        });

        Self::resolve_runtime_paths(config, config_path_buf)
    }
}

lazy_static! {
    static ref CONFIG: Mutex<Option<Config>> = Mutex::new(None);
}

pub async fn init(config_path: &str) {
    let mut config = CONFIG.lock().unwrap();
    *config = Some(Config::load_from_file(config_path));
}

pub fn get_config() -> Config {
    CONFIG.lock().unwrap().clone().unwrap_or_else(|| {
        error("Configuration was accessed before initialization.");
        process::exit(1);
    })
}
