use crate::logger::error;
use lazy_static::lazy_static;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::process;
use std::sync::Mutex;

const CARDANO_RUNTIME_NETWORK_MARKER: &str = ".caribic-network";

#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq, Eq)]
pub enum CoreCardanoNetwork {
    Local,
    Preprod,
    Preview,
}

impl CoreCardanoNetwork {
    pub fn parse(raw_network: Option<&str>) -> Result<Self, String> {
        match raw_network.unwrap_or("local") {
            "local" => Ok(Self::Local),
            "preprod" => Ok(Self::Preprod),
            "preview" => Ok(Self::Preview),
            other => Err(format!(
                "ERROR: Unsupported core Cardano network '{}'. Supported values: local, preprod, preview.",
                other
            )),
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Local => "local",
            Self::Preprod => "preprod",
            Self::Preview => "preview",
        }
    }

    pub fn runtime_dir(self) -> &'static str {
        match self {
            Self::Local => "devnet",
            Self::Preprod => "preprod",
            Self::Preview => "preview",
        }
    }

    pub fn uses_local_mithril(self) -> bool {
        matches!(self, Self::Local)
    }

    pub fn is_public_testnet(self) -> bool {
        matches!(self, Self::Preprod | Self::Preview)
    }

    pub fn koios_base_url(self) -> Option<&'static str> {
        match self {
            Self::Local => None,
            Self::Preprod => Some("https://preprod.koios.rest/api/v1"),
            Self::Preview => Some("https://preview.koios.rest/api/v1"),
        }
    }

    pub fn epoch_length(self) -> u64 {
        match self {
            Self::Local => 5_000,
            Self::Preprod => 432_000,
            Self::Preview => 86_400,
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Config {
    pub project_root: String,
    pub chains: Chains,
    pub mithril: Mithril,
    pub health: Health,
    pub cardano: Cardano,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Chains {
    pub cardano: CardanoChain,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CardanoChain {
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
    pub gateway_max_retries: u32,
    pub gateway_retry_interval_ms: u64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Cardano {
    pub services: Services,
    pub bootstrap_addresses: Vec<BootstrapAddress>,
    #[serde(default = "default_cardano_network_profiles")]
    pub networks: CardanoNetworkProfiles,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CardanoNetworkProfiles {
    pub local: CardanoNetworkProfile,
    pub preprod: CardanoNetworkProfile,
    #[serde(default = "default_preview_network_profile")]
    pub preview: CardanoNetworkProfile,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CardanoNetworkProfile {
    pub chain_id: String,
    pub network_magic: u64,
    pub mithril_aggregator_url: String,
    pub mithril_genesis_verification_key: String,
    pub handler_json_path: String,
    pub bridge_manifest_path: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct BootstrapAddress {
    pub address: String,
    pub amount: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Services {
    pub db_sync: bool,
    #[serde(default)]
    pub yaci: bool,
    pub kupo: bool,
    pub ogmios: bool,
    pub cardano_node: bool,
    pub postgres: bool,
}

impl Services {
    pub fn history_backend_enabled(&self) -> bool {
        self.yaci || self.db_sync
    }
}

fn default_cardano_network_profiles() -> CardanoNetworkProfiles {
    CardanoNetworkProfiles {
        local: CardanoNetworkProfile {
            chain_id: "cardano-devnet".to_string(),
            network_magic: 42,
            mithril_aggregator_url: "http://mithril-aggregator:8080/aggregator".to_string(),
            mithril_genesis_verification_key: "5b33322c3235332c3138362c3230312c3137372c31312c3131372c3133352c3138372c3136372c3138312c3138382c32322c35392c3230362c3130352c3233312c3135302c3231352c33302c37382c3231322c37362c31362c3235322c3138302c37322c3133342c3133372c3234372c3136312c36385d".to_string(),
            handler_json_path: "../../cardano/offchain/deployments/handler.json".to_string(),
            bridge_manifest_path: Some(
                "../../cardano/offchain/deployments/bridge-manifest.json".to_string(),
            ),
        },
        preprod: CardanoNetworkProfile {
            chain_id: "cardano-preprod".to_string(),
            network_magic: 1,
            mithril_aggregator_url:
                "https://aggregator.release-preprod.api.mithril.network/aggregator".to_string(),
            mithril_genesis_verification_key:
                "e2ea7ff3d783299ae9f12ea3c4e425ec70073c17613f1d7de4dd2ebf59c24ef4".to_string(),
            handler_json_path: "../../manifests/preprod/cardano-preprod-handler.json"
                .to_string(),
            bridge_manifest_path: Some(
                "../../manifests/preprod/cardano-preprod-bridge-manifest.json".to_string(),
            ),
        },
        preview: default_preview_network_profile(),
    }
}

fn default_preview_network_profile() -> CardanoNetworkProfile {
    CardanoNetworkProfile {
        chain_id: "cardano-preview".to_string(),
        network_magic: 2,
        mithril_aggregator_url:
            "https://aggregator.pre-release-preview.api.mithril.network/aggregator".to_string(),
        mithril_genesis_verification_key:
            "5b3132372c37332c3132342c3136312c362c3133372c3133312c3231332c3230372c3131372c3139382c38352c3137362c3139392c3136322c3234312c36382c3132332c3131392c3134352c31332c3233322c3234332c34392c3232392c322c3234392c3230352c3230352c33392c3233352c34345d".to_string(),
        handler_json_path: "../../manifests/preview/cardano-preview-handler.json".to_string(),
        bridge_manifest_path: Some(
            "../../manifests/preview/cardano-preview-bridge-manifest.json".to_string(),
        ),
    }
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

        let absolute_config_dir = if config_dir.is_absolute() {
            config_dir.to_path_buf()
        } else {
            std::env::current_dir()
                .unwrap_or_else(|_| PathBuf::from("."))
                .join(config_dir)
        };
        let joined_path = absolute_config_dir.join(path);
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
        config.cardano.networks.local.handler_json_path = Self::resolve_path_from_config_dir(
            config_path,
            &config.cardano.networks.local.handler_json_path,
        );
        config.cardano.networks.preprod.handler_json_path = Self::resolve_path_from_config_dir(
            config_path,
            &config.cardano.networks.preprod.handler_json_path,
        );
        config.cardano.networks.preview.handler_json_path = Self::resolve_path_from_config_dir(
            config_path,
            &config.cardano.networks.preview.handler_json_path,
        );
        config.cardano.networks.local.bridge_manifest_path = config
            .cardano
            .networks
            .local
            .bridge_manifest_path
            .as_deref()
            .map(|path| Self::resolve_path_from_config_dir(config_path, path));
        config.cardano.networks.preprod.bridge_manifest_path = config
            .cardano
            .networks
            .preprod
            .bridge_manifest_path
            .as_deref()
            .map(|path| Self::resolve_path_from_config_dir(config_path, path));
        config.cardano.networks.preview.bridge_manifest_path = config
            .cardano
            .networks
            .preview
            .bridge_manifest_path
            .as_deref()
            .map(|path| Self::resolve_path_from_config_dir(config_path, path));
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
    let mut config = CONFIG
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    *config = Some(Config::load_from_file(config_path));
}

pub fn get_config() -> Config {
    CONFIG
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .clone()
        .unwrap_or_else(|| {
            error("Configuration was accessed before initialization.");
            process::exit(1);
        })
}

pub fn cardano_network_profile(network: CoreCardanoNetwork) -> CardanoNetworkProfile {
    let config = get_config();
    match network {
        CoreCardanoNetwork::Local => config.cardano.networks.local,
        CoreCardanoNetwork::Preprod => config.cardano.networks.preprod,
        CoreCardanoNetwork::Preview => config.cardano.networks.preview,
    }
}

pub fn active_core_cardano_network(project_root_path: &Path) -> CoreCardanoNetwork {
    let marker_path = project_root_path
        .join("chains/cardano")
        .join(CARDANO_RUNTIME_NETWORK_MARKER);

    match fs::read_to_string(marker_path) {
        Ok(contents) => {
            CoreCardanoNetwork::parse(Some(contents.trim())).unwrap_or(CoreCardanoNetwork::Local)
        }
        Err(_) => CoreCardanoNetwork::Local,
    }
}
