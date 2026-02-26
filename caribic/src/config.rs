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
    pub mithril: Mithril,
    pub runtime: Runtime,
    pub relayer: Relayer,
    pub cardano: Cardano,
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
                let default_project_root = format!(
                    "{}/cardano-ibc-incubator",
                    home_path.as_path().display()
                );
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
    fn default() -> Self {
        let mut default_config: Config = serde_json::from_str(include_str!("../config/default-config.json"))
            .expect("Failed to parse bundled default config template");

        if let Some(home_path) = home_dir() {
            let default_project_root = format!(
                "{}/cardano-ibc-incubator",
                home_path.as_path().display()
            );
            default_config.project_root = default_project_root.clone();
            default_config.mithril.cardano_node_dir =
                format!("{}/chains/cardano/devnet", default_project_root);
        }
        default_config
    }

    async fn load_from_file(config_path: &str) -> Self {
        if Path::new(config_path).exists() {
            let file_content =
                fs::read_to_string(config_path).expect("Failed to read config file.");
            serde_json::from_str(&file_content).unwrap_or_else(|parse_error| {
                error(&format!(
                    "Failed to parse config file at {}: {}",
                    config_path, parse_error
                ));
                process::exit(1);
            })
        } else {
            let default_config = create_config_file(config_path).await;
            let parent_dir = Path::new(config_path).parent().unwrap();
            create_all(parent_dir, false).expect("Failed to create config dir.");
            let json_content = serde_json::to_string_pretty(&default_config)
                .expect("Failed to serialize default config.");
            fs::write(Path::new(config_path), json_content)
                .expect("Failed to write default config file.");
            default_config
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
