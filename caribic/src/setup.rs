use crate::config;
use crate::logger::{log, log_or_show_progress, verbose};
use crate::process::{cardano::CardanoCli, docker::DockerCli};
use crate::utils::{
    change_dir_permissions_read_only, delete_file, download_file, replace_text_in_file, unzip_file,
    IndicatorMessage,
};
use chrono::Utc;
use console::style;
use fs_extra::{copy_items, file::copy};
use indicatif::ProgressBar;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::process::{Command, Stdio};
use std::thread;
use std::time::Duration;
use std::{
    fs,
    path::{Path, PathBuf},
};

const CARDANO_RUNTIME_NETWORK_MARKER: &str = ".caribic-network";
const LOCAL_CARDANO_NODE_IMAGE: &str = "cardano-node-local-clock:10.1.4-3";
const LOCAL_STABILITY_SPO_COUNT: usize = 5;
const LOCAL_STABILITY_TARGET_POOL_STAKE_LOVELACE: u64 = 900_000_000_000;
const LOCAL_STABILITY_ASSUME_POOL_REGISTRATION_SLOT: &str = "1";
const LOCAL_CARDANO_EPOCH_LENGTH: &str = "5000";
const LOCAL_CARDANO_SYSTEM_START: &str = "2025-12-31T23:59:00Z";
const LOCAL_CARDANO_START_TIME_SECONDS: i64 = 1_767_225_540;
const LOCAL_CARDANO_SLOTS_PER_KES_PERIOD: &str = "31536000";
const LOCAL_GATEWAY_HEALTH_URL: &str = "http://localhost:8000/health";
const LOCAL_YACI_STORE_POSTGRES_VOLUME: &str = "cardano_yaci_store_postgres_local_data";
const PUBLIC_TESTNET_ENVIRONMENT_BASE_URL: &str = "https://book.world.dev.cardano.org/environments";
const YACI_SYNC_START_SLOT_KEY: &str = "YACI_SYNC_START_SLOT";
const YACI_SYNC_START_BLOCKHASH_KEY: &str = "YACI_SYNC_START_BLOCKHASH";
const YACI_SYNC_START_BLOCK_NO_KEY: &str = "YACI_SYNC_START_BLOCK_NO";
pub(crate) const CARDANO_RUNTIME_NETWORK_KEY: &str = "CARDANO_RUNTIME_NETWORK";
const CARDANO_KUPO_MODE_KEY: &str = "CARDANO_KUPO_MODE";
const PREPROD_KUPO_MODE_KEY: &str = "PREPROD_KUPO_MODE";

#[derive(Debug, Clone, PartialEq, Eq)]
struct CardanoRuntimeStatePaths {
    gateway_postgres: PathBuf,
    yaci_genesis: PathBuf,
    yaci_data: PathBuf,
    yaci_logs: PathBuf,
}

fn cardano_runtime_state_paths(network: config::CoreCardanoNetwork) -> CardanoRuntimeStatePaths {
    let runtime_root = match network {
        config::CoreCardanoNetwork::Local => PathBuf::new(),
        config::CoreCardanoNetwork::Preprod | config::CoreCardanoNetwork::Preview => {
            PathBuf::from(network.runtime_dir())
        }
    };

    CardanoRuntimeStatePaths {
        gateway_postgres: runtime_root.join("postgres"),
        yaci_genesis: runtime_root.join("yaci/genesis"),
        yaci_data: runtime_root.join("yaci/data"),
        yaci_logs: runtime_root.join("yaci/logs"),
    }
}

#[derive(Debug, Clone)]
pub struct YaciSyncCheckpoint {
    pub slot: String,
    pub block_hash: String,
    pub block_no: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PreprodKupoMode {
    Remote,
}

impl PreprodKupoMode {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Remote => "remote",
        }
    }
}

pub fn local_cardano_spo_count(with_mithril: bool, network: config::CoreCardanoNetwork) -> usize {
    if matches!(network, config::CoreCardanoNetwork::Local) && !with_mithril {
        LOCAL_STABILITY_SPO_COUNT
    } else {
        1
    }
}

pub async fn download_repository(
    url: &str,
    path: &Path,
    name: &str,
) -> Result<(), Box<dyn std::error::Error>> {
    let base_path = path.parent();

    if let Some(base_path) = base_path.filter(|base_path| !base_path.exists()) {
        fs::create_dir_all(base_path).map_err(|error| {
            format!(
                "Failed to create directory for {} source code: {}",
                name, error
            )
        })?;
    }

    if let Some(base_path) = base_path {
        let zip_path = base_path.join(format!("{}.zip", name)).to_owned();

        download_file(
            url,
            zip_path.as_path(),
            Some(IndicatorMessage {
                message: format!("Downloading {} source code", name),
                step: "Step 1/2".to_string(),
                emoji: "".to_string(),
            }),
        )
        .await
        .map_err(|error| format!("Failed to download {} source code: {}", name, error))?;

        log(&format!(
            "{} Extracting {} source code...",
            style("Step 2/2").bold().dim(),
            name
        ));

        unzip_file(zip_path.as_path(), path)
            .map_err(|error| format!("Failed to unzip {} source code: {}", name, error))?;

        delete_file(zip_path.as_path())
            .map_err(|error| format!("Failed to cleanup {}.zip: {}", name, error))?;

        Ok(())
    } else {
        Err(format!("Failed to locate parent dir of {}", path.display()).into())
    }
}

#[allow(dead_code)]
pub async fn download_mithril(mithril_path: &Path) -> Result<(), Box<dyn std::error::Error>> {
    let url = "https://github.com/input-output-hk/mithril/archive/refs/tags/2437.1.zip";
    download_repository(url, mithril_path, "mithril").await
}

pub fn copy_cardano_env_file(cardano_dir: &Path) -> Result<(), Box<dyn std::error::Error>> {
    let source = cardano_dir.join(".env.example");
    let destination = cardano_dir.join(".env");

    fs::copy(&source, &destination)
        .map_err(|error| format!("Failed to copy template Cardano .env file: {}", error))?;
    Ok(())
}

fn process_env_value(keys: &[&str]) -> Option<String> {
    keys.iter()
        .find_map(|key| std::env::var(key).ok())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn network_from_chain_id(
    value: &str,
) -> Result<config::CoreCardanoNetwork, Box<dyn std::error::Error>> {
    let value = value.trim().trim_matches(['\'', '"']);
    match value {
        "cardano-devnet" => Ok(config::CoreCardanoNetwork::Local),
        "cardano-preprod" => Ok(config::CoreCardanoNetwork::Preprod),
        "cardano-preview" => Ok(config::CoreCardanoNetwork::Preview),
        other => Err(format!(
            "Unsupported CARDANO_CHAIN_ID '{}'. Expected cardano-devnet, cardano-preprod, or cardano-preview.",
            other
        )
        .into()),
    }
}

fn network_from_magic(
    key: &str,
    value: &str,
) -> Result<config::CoreCardanoNetwork, Box<dyn std::error::Error>> {
    let value = value.trim().trim_matches(['\'', '"']);
    match value {
        "42" => Ok(config::CoreCardanoNetwork::Local),
        "1" => Ok(config::CoreCardanoNetwork::Preprod),
        "2" => Ok(config::CoreCardanoNetwork::Preview),
        other => Err(format!(
            "Unsupported {key} '{}'. Expected 42 (local), 1 (preprod), or 2 (preview).",
            other
        )
        .into()),
    }
}

fn validate_public_testnet_network_values(
    env_values: &HashMap<String, String>,
    network: config::CoreCardanoNetwork,
) -> Result<(), Box<dyn std::error::Error>> {
    if !network.is_public_testnet() {
        return Ok(());
    }

    let marker_network = env_values
        .get(CARDANO_RUNTIME_NETWORK_KEY)
        .map(|value| {
            config::CoreCardanoNetwork::parse(Some(value.trim().trim_matches(['\'', '"'])))
        })
        .transpose()
        .map_err(|error| format!("Invalid {CARDANO_RUNTIME_NETWORK_KEY}: {error}"))?;
    let chain_id_network = env_values
        .get("CARDANO_CHAIN_ID")
        .map(|value| network_from_chain_id(value))
        .transpose()?;
    let chain_magic_network = env_values
        .get("CARDANO_CHAIN_NETWORK_MAGIC")
        .map(|value| network_from_magic("CARDANO_CHAIN_NETWORK_MAGIC", value))
        .transpose()?;
    let gateway_magic_network = env_values
        .get("CARDANO_NETWORK_MAGIC")
        .map(|value| network_from_magic("CARDANO_NETWORK_MAGIC", value))
        .transpose()?;

    let configured_networks = [
        marker_network,
        chain_id_network,
        chain_magic_network,
        gateway_magic_network,
    ]
    .into_iter()
    .flatten()
    .collect::<Vec<_>>();
    if let Some(first) = configured_networks.first().copied() {
        if configured_networks
            .iter()
            .any(|candidate| *candidate != first)
        {
            return Err(format!(
                "Cardano runtime state contains conflicting network identifiers in its environment file. Expected a single network before starting {}.",
                network.as_str()
            )
            .into());
        }

        if first.is_public_testnet() && first != network {
            return Err(format!(
                "Cardano runtime state belongs to {}, but startup requested {}. Refusing to reuse its endpoints or Yaci checkpoint. Create a fresh {} environment from cardano/gateway/.env.example, configure its external endpoints, and run `caribic yaci-checkpoint --network {} --write-env` before starting.",
                first.as_str(),
                network.as_str(),
                network.as_str(),
                network.as_str(),
            )
            .into());
        }
    }

    Ok(())
}

pub(crate) fn validate_public_testnet_env_network_state(
    env_path: &Path,
    network: config::CoreCardanoNetwork,
) -> Result<(), Box<dyn std::error::Error>> {
    if !env_path.exists() {
        return Ok(());
    }
    validate_public_testnet_network_values(&parse_env_file(env_path)?, network)
}

pub(crate) fn validate_active_cardano_runtime_env(
    env_path: &Path,
    network: config::CoreCardanoNetwork,
) -> Result<(), Box<dyn std::error::Error>> {
    if !env_path.exists() {
        return Err(format!(
            "Missing active Cardano runtime environment at {}. Start the managed network/gateway before starting the relayer or dapp independently.",
            env_path.display()
        )
        .into());
    }

    let env_values = parse_env_file(env_path)?;
    let marker_network = env_values
        .get(CARDANO_RUNTIME_NETWORK_KEY)
        .map(|value| {
            config::CoreCardanoNetwork::parse(Some(value.trim().trim_matches(['\'', '"'])))
        })
        .transpose()
        .map_err(|error| format!("Invalid {CARDANO_RUNTIME_NETWORK_KEY}: {error}"))?;
    let chain_id_network = env_values
        .get("CARDANO_CHAIN_ID")
        .map(|value| network_from_chain_id(value))
        .transpose()?;
    let chain_magic_network = env_values
        .get("CARDANO_CHAIN_NETWORK_MAGIC")
        .map(|value| network_from_magic("CARDANO_CHAIN_NETWORK_MAGIC", value))
        .transpose()?;
    let gateway_magic_network = env_values
        .get("CARDANO_NETWORK_MAGIC")
        .map(|value| network_from_magic("CARDANO_NETWORK_MAGIC", value))
        .transpose()?;
    let configured_networks = [
        marker_network,
        chain_id_network,
        chain_magic_network,
        gateway_magic_network,
    ]
    .into_iter()
    .flatten()
    .collect::<Vec<_>>();
    let Some(active_network) = configured_networks.first().copied() else {
        return Err(format!(
            "Active Cardano runtime environment {} has no network identity fields.",
            env_path.display()
        )
        .into());
    };
    if configured_networks
        .iter()
        .any(|candidate| *candidate != active_network)
    {
        return Err(format!(
            "Active Cardano runtime environment {} contains conflicting network identifiers.",
            env_path.display()
        )
        .into());
    }
    if active_network != network {
        return Err(format!(
            "Active Cardano runtime environment {} belongs to {}, but startup requested {}. Restart the managed stack for the requested network first.",
            env_path.display(),
            active_network.as_str(),
            network.as_str()
        )
        .into());
    }

    Ok(())
}

fn validate_override_network_marker(
    has_overrides: bool,
    marker: Option<&str>,
    network: config::CoreCardanoNetwork,
) -> Result<(), Box<dyn std::error::Error>> {
    if !has_overrides {
        return Ok(());
    }
    let marker = marker
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            format!(
                "Public Cardano process overrides require CARIBIC_CARDANO_NETWORK={} so stale values cannot cross networks.",
                network.as_str()
            )
        })?;
    let override_network = config::CoreCardanoNetwork::parse(Some(marker))?;
    if override_network != network {
        return Err(format!(
            "Public Cardano process overrides are marked for {}, but startup requested {}.",
            override_network.as_str(),
            network.as_str()
        )
        .into());
    }
    Ok(())
}

fn validate_network_bound_process_overrides(
    keys: &[&str],
    network: config::CoreCardanoNetwork,
) -> Result<(), Box<dyn std::error::Error>> {
    let has_overrides = keys.iter().any(|key| {
        std::env::var(key)
            .ok()
            .is_some_and(|value| !value.trim().is_empty())
    });
    validate_override_network_marker(
        has_overrides,
        std::env::var("CARIBIC_CARDANO_NETWORK").ok().as_deref(),
        network,
    )
}

pub fn resolve_public_testnet_history_relay(
    gateway_env: &Path,
    network: config::CoreCardanoNetwork,
) -> Result<(String, String), Box<dyn std::error::Error>> {
    validate_public_testnet_env_network_state(gateway_env, network)?;
    validate_network_bound_process_overrides(
        &[
            "CARIBIC_CARDANO_CHAIN_HOST",
            "CARDANO_CHAIN_HOST",
            "CARIBIC_CARDANO_CHAIN_PORT",
            "CARDANO_CHAIN_PORT",
        ],
        network,
    )?;
    let gateway_values = if gateway_env.exists() {
        parse_env_file(gateway_env)?
    } else {
        HashMap::new()
    };

    let host = process_env_value(&["CARIBIC_CARDANO_CHAIN_HOST", "CARDANO_CHAIN_HOST"])
        .or_else(|| {
            gateway_values
                .get("CARDANO_CHAIN_HOST")
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty())
        })
        .ok_or_else(|| {
            format!(
                "Missing public Cardano testnet raw relay host. Set CARDANO_CHAIN_HOST in {} or export CARIBIC_CARDANO_CHAIN_HOST.",
                gateway_env.display()
            )
        })?;

    let port = process_env_value(&["CARIBIC_CARDANO_CHAIN_PORT", "CARDANO_CHAIN_PORT"])
        .or_else(|| {
            gateway_values
                .get("CARDANO_CHAIN_PORT")
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty())
        })
        .ok_or_else(|| {
            format!(
                "Missing public Cardano testnet raw relay port. Set CARDANO_CHAIN_PORT in {} or export CARIBIC_CARDANO_CHAIN_PORT.",
                gateway_env.display()
            )
        })?;

    let parsed_port = port
        .parse::<u16>()
        .map_err(|error| format!("Invalid public Cardano relay port '{port}': {error}"))?;
    if parsed_port == 0 {
        return Err("Invalid public Cardano relay port '0': expected 1 to 65535".into());
    }

    if is_local_or_container_host(host.as_str()) {
        return Err(format!(
            "Public Cardano testnet Yaci history cannot use local CARDANO_CHAIN_HOST='{}'. Set it to an external raw Cardano relay host.",
            host
        )
        .into());
    }

    Ok((host, port))
}

fn resolve_env_or_file_value(
    env_values: &HashMap<String, String>,
    env_keys: &[&str],
    file_keys: &[&str],
) -> Option<String> {
    process_env_value(env_keys)
        .or_else(|| {
            file_keys.iter().find_map(|key| {
                env_values
                    .get(*key)
                    .map(|value| value.trim().to_string())
                    .filter(|value| !value.is_empty())
            })
        })
        .filter(|value| !value.is_empty())
}

fn is_hex_64(value: &str) -> bool {
    value.len() == 64 && value.chars().all(|ch| ch.is_ascii_hexdigit())
}

pub fn resolve_public_testnet_yaci_checkpoint(
    gateway_env: &Path,
    network: config::CoreCardanoNetwork,
) -> Result<YaciSyncCheckpoint, Box<dyn std::error::Error>> {
    validate_public_testnet_env_network_state(gateway_env, network)?;
    validate_network_bound_process_overrides(
        &[
            "CARIBIC_YACI_SYNC_START_SLOT",
            YACI_SYNC_START_SLOT_KEY,
            "CARIBIC_YACI_SYNC_START_BLOCKHASH",
            YACI_SYNC_START_BLOCKHASH_KEY,
            "CARIBIC_YACI_SYNC_START_BLOCK_HASH",
            "YACI_SYNC_START_BLOCK_HASH",
            "CARIBIC_YACI_SYNC_START_BLOCK_NO",
            YACI_SYNC_START_BLOCK_NO_KEY,
        ],
        network,
    )?;
    let gateway_values = if gateway_env.exists() {
        parse_env_file(gateway_env)?
    } else {
        HashMap::new()
    };

    let slot = resolve_env_or_file_value(
        &gateway_values,
        &["CARIBIC_YACI_SYNC_START_SLOT", YACI_SYNC_START_SLOT_KEY],
        &[YACI_SYNC_START_SLOT_KEY],
    )
    .ok_or_else(|| {
        format!(
            "Missing public Cardano testnet Yaci checkpoint slot. Set {YACI_SYNC_START_SLOT_KEY} in {} or export CARIBIC_YACI_SYNC_START_SLOT.\nGenerate a recent checkpoint with: caribic yaci-checkpoint --network <preprod|preview> --epochs-back 2 --write-env",
            gateway_env.display()
        )
    })?;

    let slot_number = slot.parse::<u64>().map_err(|error| {
        format!(
            "Invalid public Cardano testnet Yaci checkpoint slot '{}': {}",
            slot, error
        )
    })?;
    if slot_number == 0 {
        return Err(
            "Public Cardano testnet Yaci checkpoint slot must be > 0. Do not sync public testnet history from genesis."
                .into(),
        );
    }

    let block_hash = resolve_env_or_file_value(
        &gateway_values,
        &[
            "CARIBIC_YACI_SYNC_START_BLOCKHASH",
            YACI_SYNC_START_BLOCKHASH_KEY,
            "CARIBIC_YACI_SYNC_START_BLOCK_HASH",
            "YACI_SYNC_START_BLOCK_HASH",
        ],
        &[YACI_SYNC_START_BLOCKHASH_KEY, "YACI_SYNC_START_BLOCK_HASH"],
    )
    .ok_or_else(|| {
        format!(
            "Missing public Cardano testnet Yaci checkpoint block hash. Set {YACI_SYNC_START_BLOCKHASH_KEY} in {} or export CARIBIC_YACI_SYNC_START_BLOCKHASH.",
            gateway_env.display()
        )
    })?
    .to_lowercase();

    if !is_hex_64(block_hash.as_str()) {
        return Err(format!(
            "Invalid public Cardano testnet Yaci checkpoint block hash '{}': expected a 64-character hex hash.",
            block_hash
        )
        .into());
    }

    let block_no = resolve_env_or_file_value(
        &gateway_values,
        &[
            "CARIBIC_YACI_SYNC_START_BLOCK_NO",
            YACI_SYNC_START_BLOCK_NO_KEY,
        ],
        &[YACI_SYNC_START_BLOCK_NO_KEY],
    )
    .map(|value| value.trim().to_string())
    .filter(|value| !value.is_empty());
    if let Some(block_no) = &block_no {
        block_no.parse::<u64>().map_err(|error| {
            format!(
                "Invalid public Cardano testnet Yaci checkpoint block number '{}': {}",
                block_no, error
            )
        })?;
    }

    Ok(YaciSyncCheckpoint {
        slot,
        block_hash,
        block_no,
    })
}

pub fn write_cardano_runtime_selection(
    cardano_dir: &Path,
    network: config::CoreCardanoNetwork,
    local_spo_count: usize,
) -> Result<(), Box<dyn std::error::Error>> {
    let runtime_dir = network.runtime_dir();
    let state_paths = cardano_runtime_state_paths(network);
    let network_magic = config::cardano_network_profile(network).network_magic;
    let gateway_env = cardano_dir.join("../../cardano/gateway/.env");
    validate_public_testnet_env_network_state(gateway_env.as_path(), network)?;
    let (config_file, block_producer, node_image, socket_path) = match network {
        config::CoreCardanoNetwork::Local => (
            "cardano-node.json",
            "true",
            LOCAL_CARDANO_NODE_IMAGE,
            "/runtime/node.socket",
        ),
        config::CoreCardanoNetwork::Preprod | config::CoreCardanoNetwork::Preview => (
            "config.json",
            "false",
            "ghcr.io/intersectmbo/cardano-node:10.6.2",
            "/tmp/node.socket",
        ),
    };
    let (chain_host, chain_port) = match network {
        config::CoreCardanoNetwork::Local => ("cardano-node".to_string(), "3001".to_string()),
        config::CoreCardanoNetwork::Preprod | config::CoreCardanoNetwork::Preview => {
            resolve_public_testnet_history_relay(gateway_env.as_path(), network)?
        }
    };
    let yaci_checkpoint = match network {
        config::CoreCardanoNetwork::Local => None,
        config::CoreCardanoNetwork::Preprod | config::CoreCardanoNetwork::Preview => Some(
            resolve_public_testnet_yaci_checkpoint(gateway_env.as_path(), network)?,
        ),
    };
    let yaci_sync_start_slot = yaci_checkpoint
        .as_ref()
        .map(|checkpoint| checkpoint.slot.as_str())
        .unwrap_or("0");
    let yaci_sync_start_blockhash = yaci_checkpoint
        .as_ref()
        .map(|checkpoint| checkpoint.block_hash.as_str())
        .unwrap_or("");
    let yaci_store_postgres_volume = match (network, yaci_checkpoint.as_ref()) {
        (config::CoreCardanoNetwork::Local, _) => LOCAL_YACI_STORE_POSTGRES_VOLUME.to_string(),
        (
            config::CoreCardanoNetwork::Preprod | config::CoreCardanoNetwork::Preview,
            Some(checkpoint),
        ) => format!(
            "cardano_yaci_store_postgres_{}_{}_{}",
            network.as_str(),
            checkpoint.slot,
            &checkpoint.block_hash[..12]
        ),
        (config::CoreCardanoNetwork::Preprod | config::CoreCardanoNetwork::Preview, None) => {
            unreachable!("public testnet checkpoint was resolved above")
        }
    };
    let env_contents = format!(
        "CARDANO_RUNTIME_NETWORK={network}\nCARDANO_RUNTIME_DIR={runtime_dir}\nCARDANO_NODE_CONFIG_FILE={config_file}\nCARDANO_TOPOLOGY_FILE=topology.json\nCARDANO_BLOCK_PRODUCER={block_producer}\nCARDANO_NODE_IMAGE={node_image}\nCARDANO_SOCKET_PATH={socket_path}\nCARDANO_NODE_SOCKET_PATH={socket_path}\nCARDANO_CHAIN_HOST={chain_host}\nCARDANO_CHAIN_PORT={chain_port}\nCARDANO_CHAIN_NETWORK_MAGIC={network_magic}\nCARDANO_LOCAL_SPO_COUNT={local_spo_count}\nGATEWAY_POSTGRES_DATA_DIR={gateway_postgres_data_dir}\nYACI_GENESIS_DIR={yaci_genesis_dir}\nYACI_DATA_DIR={yaci_data_dir}\nYACI_LOGS_DIR={yaci_logs_dir}\nYACI_SYNC_START_SLOT={yaci_sync_start_slot}\nYACI_SYNC_START_BLOCKHASH={yaci_sync_start_blockhash}\nYACI_STORE_POSTGRES_VOLUME={yaci_store_postgres_volume}\nKUPO_BLOCKCHAIN_SOURCE=node\nKUPO_OGMIOS_HOST=\nKUPO_OGMIOS_PORT=\nKUPO_SINCE=origin\nOGMIOS_PROXY_UPSTREAM_HOST=\nOGMIOS_PROXY_UPSTREAM_PORT=\nOGMIOS_PROXY_API_KEY=\n",
        network = network.as_str(),
        gateway_postgres_data_dir = state_paths.gateway_postgres.display(),
        yaci_genesis_dir = state_paths.yaci_genesis.display(),
        yaci_data_dir = state_paths.yaci_data.display(),
        yaci_logs_dir = state_paths.yaci_logs.display(),
    );

    fs::write(cardano_dir.join(".env"), env_contents).map_err(|error| {
        format!(
            "Failed to write Cardano runtime compose env at {}: {}",
            cardano_dir.join(".env").display(),
            error
        )
    })?;

    fs::write(
        cardano_dir.join(CARDANO_RUNTIME_NETWORK_MARKER),
        format!("{}\n", network.as_str()),
    )
    .map_err(|error| {
        format!(
            "Failed to write Cardano runtime network marker at {}: {}",
            cardano_dir.join(CARDANO_RUNTIME_NETWORK_MARKER).display(),
            error
        )
    })?;

    Ok(())
}

async fn download_public_testnet_runtime_file(
    network: config::CoreCardanoNetwork,
    target_dir: &Path,
    remote_name: &str,
    local_name: &str,
) -> Result<(), Box<dyn std::error::Error>> {
    let destination = target_dir.join(local_name);
    if destination.exists() {
        return Ok(());
    }

    let url = format!(
        "{PUBLIC_TESTNET_ENVIRONMENT_BASE_URL}/{}/{}",
        network.as_str(),
        remote_name,
    );
    download_file(
        &url,
        destination.as_path(),
        Some(IndicatorMessage {
            message: format!("Downloading Cardano {} {}", network.as_str(), remote_name),
            step: "Bootstrap".to_string(),
            emoji: "".to_string(),
        }),
    )
    .await
    .map_err(|error| {
        format!(
            "Failed to download Cardano {} runtime file '{}' from {}: {}",
            network.as_str(),
            remote_name,
            url,
            error
        )
    })?;

    Ok(())
}

pub async fn configure_cardano_public_testnet_runtime(
    cardano_dir: &Path,
    reset_state: bool,
    network: config::CoreCardanoNetwork,
) -> Result<(), Box<dyn std::error::Error>> {
    if !network.is_public_testnet() {
        return Err(format!(
            "Cardano {} is not a public testnet runtime",
            network.as_str()
        )
        .into());
    }
    let runtime_dir = cardano_dir.join(network.runtime_dir());
    let state_paths = cardano_runtime_state_paths(network);
    let service_folders = vec![
        runtime_dir.clone(),
        cardano_dir.join(state_paths.gateway_postgres.as_path()),
        cardano_dir.join(state_paths.yaci_genesis.as_path()),
        cardano_dir.join(state_paths.yaci_data.as_path()),
        cardano_dir.join(state_paths.yaci_logs.as_path()),
    ];

    if reset_state {
        for service_folder in &service_folders {
            if service_folder.exists() && service_folder.is_dir() {
                fs::remove_dir_all(service_folder).map_err(|error| {
                    format!(
                        "Failed to reset Cardano public testnet service folder {}: {}",
                        service_folder.display(),
                        error
                    )
                })?;
            }
        }
    }

    for service_folder in service_folders {
        fs::create_dir_all(&service_folder).map_err(|error| {
            format!(
                "Failed to create Cardano public testnet service folder {}: {}",
                service_folder.display(),
                error
            )
        })?;
    }

    // The public-testnet node socket lives on the bind-mounted runtime directory.
    // If the previous run left a stale Unix socket behind, the container cannot
    // reliably remove it during startup on this mount, so clear it on the host first.
    for stale_socket_path in [
        runtime_dir.join("node.socket"),
        runtime_dir.join("node.socket.lock"),
    ] {
        if stale_socket_path.exists() {
            fs::remove_file(&stale_socket_path).map_err(|error| {
                format!(
                    "Failed to remove stale Cardano public testnet socket artifact {}: {}",
                    stale_socket_path.display(),
                    error
                )
            })?;
        }
    }

    for (remote_name, local_name) in [
        ("config.json", "config.json"),
        ("topology.json", "topology.json"),
        ("peer-snapshot.json", "peer-snapshot.json"),
        ("byron-genesis.json", "byron-genesis.json"),
        ("shelley-genesis.json", "shelley-genesis.json"),
        ("alonzo-genesis.json", "alonzo-genesis.json"),
        ("conway-genesis.json", "conway-genesis.json"),
    ] {
        download_public_testnet_runtime_file(network, &runtime_dir, remote_name, local_name)
            .await?;
    }

    write_yaci_public_testnet_genesis_files(
        &cardano_dir.join(state_paths.yaci_genesis),
        &runtime_dir,
    )?;

    Ok(())
}

fn write_yaci_public_testnet_genesis_files(
    yaci_genesis_dir: &Path,
    runtime_dir: &Path,
) -> Result<(), Box<dyn std::error::Error>> {
    fs::create_dir_all(yaci_genesis_dir).map_err(|error| {
        format!(
            "Failed to create Yaci public testnet genesis directory {}: {}",
            yaci_genesis_dir.display(),
            error
        )
    })?;

    for (source_name, destination_name) in [
        ("byron-genesis.json", "genesis-byron.json"),
        ("shelley-genesis.json", "genesis-shelley.json"),
        ("alonzo-genesis.json", "genesis-alonzo.json"),
        ("conway-genesis.json", "genesis-conway.json"),
    ] {
        fs::copy(
            runtime_dir.join(source_name),
            yaci_genesis_dir.join(destination_name),
        )
        .map_err(|error| {
            format!(
                "Failed to copy {} into Yaci public testnet genesis dir: {}",
                source_name, error
            )
        })?;
    }

    let shelley_path = yaci_genesis_dir.join("genesis-shelley.json");
    let mut shelley_json: Value =
        serde_json::from_str(&fs::read_to_string(&shelley_path).map_err(|error| {
            format!(
                "Failed to read Yaci public testnet Shelley genesis file {}: {}",
                shelley_path.display(),
                error
            )
        })?)
        .map_err(|error| {
            format!(
                "Failed to parse Yaci public testnet Shelley genesis file {}: {}",
                shelley_path.display(),
                error
            )
        })?;

    if let Some(staking) = shelley_json
        .get_mut("staking")
        .and_then(|value| value.as_object_mut())
    {
        staking.insert("pools".to_string(), Value::Object(serde_json::Map::new()));
        staking.insert("stake".to_string(), Value::Object(serde_json::Map::new()));
    }

    fs::write(
        &shelley_path,
        serde_json::to_string_pretty(&shelley_json).map_err(|error| {
            format!(
                "Failed to serialize Yaci public testnet Shelley genesis file {}: {}",
                shelley_path.display(),
                error
            )
        })?,
    )
    .map_err(|error| {
        format!(
            "Failed to write Yaci public testnet Shelley genesis file {}: {}",
            shelley_path.display(),
            error
        )
    })?;

    Ok(())
}

pub(crate) fn set_env_var_if_absent(
    env_path: &Path,
    key: &str,
    value: &str,
) -> Result<(), Box<dyn std::error::Error>> {
    let original = fs::read_to_string(env_path).unwrap_or_default();
    if original
        .lines()
        .any(|candidate| candidate.starts_with(&format!("{key}=")))
    {
        return Ok(());
    }
    set_or_append_env_var(env_path, key, value)
}

pub(crate) fn set_or_append_env_var(
    env_path: &Path,
    key: &str,
    value: &str,
) -> Result<(), Box<dyn std::error::Error>> {
    let line = format!("{key}={value}");
    let pattern = format!(r#"{}=.*"#, regex::escape(key));
    let original = fs::read_to_string(env_path).unwrap_or_default();

    if original
        .lines()
        .any(|candidate| candidate.starts_with(&format!("{key}=")))
    {
        replace_text_in_file(env_path, pattern.as_str(), line.as_str())?;
    } else {
        let mut updated = original;
        if !updated.is_empty() && !updated.ends_with('\n') {
            updated.push('\n');
        }
        updated.push_str(line.as_str());
        updated.push('\n');
        fs::write(env_path, updated).map_err(|error| {
            format!(
                "Failed to update environment file {}: {}",
                env_path.display(),
                error
            )
        })?;
    }

    Ok(())
}

pub(crate) fn secure_env_file_permissions(
    env_path: &Path,
) -> Result<(), Box<dyn std::error::Error>> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;

        fs::set_permissions(env_path, fs::Permissions::from_mode(0o600)).map_err(|error| {
            format!(
                "Failed to restrict environment file permissions for {}: {}",
                env_path.display(),
                error
            )
        })?;
    }

    Ok(())
}

fn write_yaci_local_genesis_files(
    cardano_dir: &Path,
    devnet_dir: &Path,
) -> Result<(), Box<dyn std::error::Error>> {
    let yaci_genesis_dir = cardano_dir.join("yaci/genesis");
    fs::create_dir_all(&yaci_genesis_dir).map_err(|error| {
        format!(
            "Failed to create Yaci genesis directory {}: {}",
            yaci_genesis_dir.display(),
            error
        )
    })?;

    for filename in [
        "genesis-byron.json",
        "genesis-alonzo.json",
        "genesis-conway.json",
    ] {
        fs::copy(devnet_dir.join(filename), yaci_genesis_dir.join(filename)).map_err(|error| {
            format!(
                "Failed to copy {} into Yaci genesis dir: {}",
                filename, error
            )
        })?;
    }

    let shelley_path = devnet_dir.join("genesis-shelley.json");
    let mut shelley_json: Value =
        serde_json::from_str(&fs::read_to_string(&shelley_path).map_err(|error| {
            format!(
                "Failed to read Shelley genesis file {}: {}",
                shelley_path.display(),
                error
            )
        })?)
        .map_err(|error| {
            format!(
                "Failed to parse Shelley genesis file {}: {}",
                shelley_path.display(),
                error
            )
        })?;

    if let Some(staking) = shelley_json
        .get_mut("staking")
        .and_then(|value| value.as_object_mut())
    {
        staking.insert("pools".to_string(), Value::Object(serde_json::Map::new()));
        staking.insert("stake".to_string(), Value::Object(serde_json::Map::new()));
    }

    fs::write(
        yaci_genesis_dir.join("genesis-shelley.json"),
        serde_json::to_string_pretty(&shelley_json)
            .map_err(|error| format!("Failed to serialize Yaci Shelley genesis: {}", error))?,
    )
    .map_err(|error| {
        format!(
            "Failed to write Yaci Shelley genesis file {}: {}",
            yaci_genesis_dir.join("genesis-shelley.json").display(),
            error
        )
    })?;

    Ok(())
}

fn remove_local_yaci_postgres_volume() -> Result<(), Box<dyn std::error::Error>> {
    let output = DockerCli::new(Path::new("."))
        .raw_output_allow_failure(
            ["volume", "rm", "-f", LOCAL_YACI_STORE_POSTGRES_VOLUME].as_slice(),
        )
        .map_err(|error| format!("Failed to remove local Yaci postgres volume: {}", error))?;

    if output.status.success() {
        return Ok(());
    }

    let stderr = String::from_utf8_lossy(&output.stderr);
    if stderr.contains("No such volume") {
        return Ok(());
    }

    Err(format!(
        "Failed to remove local Yaci postgres volume: {}",
        stderr.trim()
    )
    .into())
}

fn local_spo_ipv4(index: usize) -> Result<String, Box<dyn std::error::Error>> {
    if !(1..=243).contains(&index) {
        return Err(
            format!("Local SPO index is outside supported Docker subnet range: {index}").into(),
        );
    }
    Ok(format!("172.29.0.{}", 10 + index))
}

fn local_spo_port(index: usize) -> u16 {
    let _ = index;
    3001
}

fn local_spo_topology_filename(index: usize) -> String {
    if index == 1 {
        "topology.json".to_string()
    } else {
        format!("topology-spo{}.json", index)
    }
}

fn build_local_spo_topology(
    index: usize,
    total_spo_count: usize,
) -> Result<Value, Box<dyn std::error::Error>> {
    let producers: Vec<Value> = (1..=total_spo_count)
        .filter(|candidate| *candidate != index)
        .map(|candidate| {
            Ok(json!({
                "addr": local_spo_ipv4(candidate)?,
                "port": local_spo_port(candidate),
                "valency": 1,
            }))
        })
        .collect::<Result<Vec<_>, Box<dyn std::error::Error>>>()?;

    Ok(json!({
        "Producers": producers
    }))
}

fn write_local_multi_spo_topology_files(
    devnet_dir: &Path,
    total_spo_count: usize,
) -> Result<(), Box<dyn std::error::Error>> {
    for index in 1..=total_spo_count {
        let topology_path = devnet_dir.join(local_spo_topology_filename(index));
        fs::write(
            &topology_path,
            serde_json::to_string_pretty(&build_local_spo_topology(index, total_spo_count)?)
                .map_err(|error| format!("Failed to serialize local SPO topology: {}", error))?,
        )
        .map_err(|error| {
            format!(
                "Failed to write local SPO topology file {}: {}",
                topology_path.display(),
                error
            )
        })?;
    }

    Ok(())
}

fn generate_additional_local_spo_data(
    workspace_dir: &Path,
    additional_spo_count: usize,
) -> Result<std::path::PathBuf, Box<dyn std::error::Error>> {
    let temp_dir = workspace_dir.join(format!(
        "caribic-local-spo-{}-{}",
        std::process::id(),
        Utc::now().timestamp_nanos_opt().unwrap_or_default()
    ));
    fs::create_dir_all(&temp_dir).map_err(|error| {
        format!(
            "Failed to create temporary local SPO generation directory {}: {}",
            temp_dir.display(),
            error
        )
    })?;

    let delegated_supply = LOCAL_STABILITY_TARGET_POOL_STAKE_LOVELACE
        .checked_mul(additional_spo_count as u64)
        .ok_or("Failed to compute delegated supply for local SPO generation")?;
    let mount_arg = format!("{}:/out", temp_dir.display());
    let pools_arg = additional_spo_count.to_string();
    let delegated_supply_arg = delegated_supply.to_string();

    let output = DockerCli::new(Path::new("."))
        .raw_output(
            [
                "run",
                "--rm",
                "-v",
                mount_arg.as_str(),
                LOCAL_CARDANO_NODE_IMAGE,
                "cli",
                "latest",
                "genesis",
                "create-testnet-data",
                "--out-dir",
                "/out",
                "--pools",
                pools_arg.as_str(),
                "--stake-delegators",
                pools_arg.as_str(),
                "--testnet-magic",
                "42",
                "--total-supply",
                delegated_supply_arg.as_str(),
                "--delegated-supply",
                delegated_supply_arg.as_str(),
            ]
            .as_slice(),
        )
        .map_err(|error| format!("Failed to generate additional local SPO data: {}", error))?;

    if !output.status.success() {
        let _ = fs::remove_dir_all(&temp_dir);
        return Err(format!(
            "Failed to generate additional local SPO data:\nstdout: {}\nstderr: {}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        )
        .into());
    }

    Ok(temp_dir)
}

fn ensure_local_cardano_node_image(cardano_dir: &Path) -> Result<(), Box<dyn std::error::Error>> {
    DockerCli::new(cardano_dir)
        .raw_output(
            [
                "build",
                "-f",
                "Dockerfile.local-clock",
                "-t",
                LOCAL_CARDANO_NODE_IMAGE,
                ".",
            ]
            .as_slice(),
        )
        .map_err(|error| {
            format!(
                "Failed to build managed Cardano local-clock image {}: {}",
                LOCAL_CARDANO_NODE_IMAGE, error
            )
        })?;

    Ok(())
}

fn merge_generated_local_spo_genesis(
    genesis_shelley_path: &Path,
    generated_shelley_genesis_path: &Path,
) -> Result<(), Box<dyn std::error::Error>> {
    let mut existing_genesis: Value =
        serde_json::from_str(&fs::read_to_string(genesis_shelley_path).map_err(|error| {
            format!(
                "Failed to read local Shelley genesis file {}: {}",
                genesis_shelley_path.display(),
                error
            )
        })?)
        .map_err(|error| {
            format!(
                "Failed to parse local Shelley genesis file {}: {}",
                genesis_shelley_path.display(),
                error
            )
        })?;

    let generated_genesis: Value = serde_json::from_str(
        &fs::read_to_string(generated_shelley_genesis_path).map_err(|error| {
            format!(
                "Failed to read generated Shelley genesis file {}: {}",
                generated_shelley_genesis_path.display(),
                error
            )
        })?,
    )
    .map_err(|error| {
        format!(
            "Failed to parse generated Shelley genesis file {}: {}",
            generated_shelley_genesis_path.display(),
            error
        )
    })?;

    let existing_staking = existing_genesis
        .get_mut("staking")
        .and_then(|value| value.as_object_mut())
        .ok_or("Local Shelley genesis is missing a staking section")?;
    let generated_staking = generated_genesis
        .get("staking")
        .and_then(|value| value.as_object())
        .ok_or("Generated Shelley genesis is missing a staking section")?;

    let existing_pools = existing_staking
        .get_mut("pools")
        .and_then(|value| value.as_object_mut())
        .ok_or("Local Shelley genesis is missing staking.pools")?;
    for (pool_id, pool_params) in generated_staking
        .get("pools")
        .and_then(|value| value.as_object())
        .ok_or("Generated Shelley genesis is missing staking.pools")?
    {
        existing_pools.insert(pool_id.clone(), pool_params.clone());
    }

    let existing_stake = existing_staking
        .get_mut("stake")
        .and_then(|value| value.as_object_mut())
        .ok_or("Local Shelley genesis is missing staking.stake")?;
    for (stake_credential, pool_id) in generated_staking
        .get("stake")
        .and_then(|value| value.as_object())
        .ok_or("Generated Shelley genesis is missing staking.stake")?
    {
        existing_stake.insert(stake_credential.clone(), pool_id.clone());
    }

    let existing_initial_funds = existing_genesis
        .get_mut("initialFunds")
        .and_then(|value| value.as_object_mut())
        .ok_or("Local Shelley genesis is missing initialFunds")?;
    for (address, amount) in generated_genesis
        .get("initialFunds")
        .and_then(|value| value.as_object())
        .ok_or("Generated Shelley genesis is missing initialFunds")?
    {
        existing_initial_funds.insert(address.clone(), amount.clone());
    }

    fs::write(
        genesis_shelley_path,
        serde_json::to_string_pretty(&existing_genesis).map_err(|error| {
            format!(
                "Failed to serialize local Shelley genesis file {}: {}",
                genesis_shelley_path.display(),
                error
            )
        })?,
    )
    .map_err(|error| {
        format!(
            "Failed to write merged Shelley genesis file {}: {}",
            genesis_shelley_path.display(),
            error
        )
    })?;

    Ok(())
}

fn install_generated_local_spo_assets(
    devnet_dir: &Path,
    generated_dir: &Path,
    additional_spo_count: usize,
) -> Result<(), Box<dyn std::error::Error>> {
    for offset in 0..additional_spo_count {
        let source_dir = generated_dir
            .join("pools-keys")
            .join(format!("pool{}", offset + 1));
        let destination_dir = devnet_dir.join(format!("spo{}", offset + 2));

        fs::create_dir_all(&destination_dir).map_err(|error| {
            format!(
                "Failed to create local SPO runtime directory {}: {}",
                destination_dir.display(),
                error
            )
        })?;

        for entry in fs::read_dir(&source_dir).map_err(|error| {
            format!(
                "Failed to read generated local SPO directory {}: {}",
                source_dir.display(),
                error
            )
        })? {
            let entry = entry.map_err(|error| {
                format!(
                    "Failed to access generated local SPO file in {}: {}",
                    source_dir.display(),
                    error
                )
            })?;
            let source_path = entry.path();
            if !source_path.is_file() {
                continue;
            }
            let destination_path = destination_dir.join(entry.file_name());
            fs::copy(&source_path, &destination_path).map_err(|error| {
                format!(
                    "Failed to copy generated local SPO file {} -> {}: {}",
                    source_path.display(),
                    destination_path.display(),
                    error
                )
            })?;
        }

        fs::create_dir_all(destination_dir.join("db")).map_err(|error| {
            format!(
                "Failed to create local SPO database directory {}: {}",
                destination_dir.join("db").display(),
                error
            )
        })?;
    }

    Ok(())
}

fn extend_local_devnet_with_generated_spo_data(
    devnet_dir: &Path,
    total_spo_count: usize,
) -> Result<(), Box<dyn std::error::Error>> {
    if total_spo_count <= 1 {
        return Ok(());
    }

    let workspace_dir = devnet_dir
        .parent()
        .ok_or("Failed to resolve Cardano workspace for local SPO generation")?;
    let generated_dir = generate_additional_local_spo_data(workspace_dir, total_spo_count - 1)?;
    let merge_result = (|| {
        merge_generated_local_spo_genesis(
            &devnet_dir.join("genesis-shelley.json"),
            &generated_dir.join("shelley-genesis.json"),
        )?;
        install_generated_local_spo_assets(devnet_dir, &generated_dir, total_spo_count - 1)?;
        write_local_multi_spo_topology_files(devnet_dir, total_spo_count)?;
        Ok::<(), Box<dyn std::error::Error>>(())
    })();
    let _ = fs::remove_dir_all(&generated_dir);
    merge_result
}

pub fn configure_local_cardano_devnet(
    cardano_dir: &Path,
    local_spo_count: usize,
) -> Result<(), Box<dyn std::error::Error>> {
    let cardano_config_dir = cardano_dir.join("config");
    let service_folders = vec![
        "devnet",
        "kupo-db",
        "postgres",
        "yaci/genesis",
        "yaci/data",
        "yaci/logs",
        "baseinfo",
    ];

    for service_folder in &service_folders {
        let serivce_folder_path = cardano_dir.join(service_folder);
        if serivce_folder_path.exists() && serivce_folder_path.is_dir() {
            fs::remove_dir_all(&serivce_folder_path).map_err(|error| {
                format!("Failed to remove existing devnet directory: {}", error)
            })?;
        }
    }

    // Recreate the deleted folders as empty directories
    for service_folder in &service_folders {
        let serivce_folder_path = cardano_dir.join(service_folder);
        fs::create_dir_all(&serivce_folder_path).map_err(|error| {
            format!(
                "Failed to create service folder {}: {}",
                service_folder, error
            )
        })?;
    }

    remove_local_yaci_postgres_volume()?;

    let devnet_dir = cardano_dir.join("devnet");

    let cardano_config_files = vec![
        //cardano_config_dir.join("protocol-parameters.json"),
        cardano_config_dir.join("credentials"),
    ];

    let copy_dir_options = fs_extra::dir::CopyOptions::new().overwrite(true);
    copy_items(
        &[cardano_config_dir.join("devnet")],
        cardano_dir,
        &copy_dir_options,
    )
    .map_err(|error| format!("Failed to copy Cardano configuration files: {}", error))?;

    for source in cardano_config_files {
        verbose(&format!(
            "Try to copy Cardano configuration file(s) {} to {}",
            source.display(),
            cardano_dir.display()
        ));

        if source.is_dir() {
            copy_items(&[source], &devnet_dir, &copy_dir_options).map_err(|error| {
                format!("Failed to copy Cardano configuration files: {}", error)
            })?;
        } else {
            let options = fs_extra::file::CopyOptions::new().overwrite(true);
            let file_name = source.file_name().ok_or_else(|| {
                format!(
                    "Failed to determine Cardano configuration file name for {}",
                    source.display()
                )
            })?;
            let destination = devnet_dir.join(file_name);
            copy(source, destination, &options)
                .map_err(|error| format!("Failed to copy Cardano configuration file: {}", error))?;
        }
    }

    let genesis_byron_path = devnet_dir.join("genesis-byron.json");
    let genesis_shelley_path = devnet_dir.join("genesis-shelley.json");

    replace_text_in_file(
        &genesis_byron_path,
        r#""startTime": \d*"#,
        &format!(r#""startTime": {}"#, LOCAL_CARDANO_START_TIME_SECONDS),
    )?;

    replace_text_in_file(
        &genesis_shelley_path,
        r#""systemStart": ".*""#,
        &format!(r#""systemStart": "{}""#, LOCAL_CARDANO_SYSTEM_START),
    )?;

    replace_text_in_file(
        &genesis_shelley_path,
        r#""epochLength": \d+"#,
        &format!(r#""epochLength": {}"#, LOCAL_CARDANO_EPOCH_LENGTH),
    )?;

    replace_text_in_file(
        &genesis_shelley_path,
        r#""slotsPerKESPeriod": \d+"#,
        &format!(
            r#""slotsPerKESPeriod": {}"#,
            LOCAL_CARDANO_SLOTS_PER_KES_PERIOD
        ),
    )?;

    if local_spo_count > 1 {
        replace_text_in_file(
            &devnet_dir.join("cardano-node.json"),
            r#""EnableP2P": true"#,
            r#""EnableP2P": false"#,
        )?;
    }

    ensure_local_cardano_node_image(cardano_dir)?;
    extend_local_devnet_with_generated_spo_data(&devnet_dir, local_spo_count)?;

    let yaci_genesis_dir = cardano_dir.join("yaci").join("genesis");
    fs::create_dir_all(&yaci_genesis_dir)
        .map_err(|error| format!("Failed to create Yaci genesis directory: {}", error))?;

    for genesis_file in [
        "genesis-byron.json",
        "genesis-shelley.json",
        "genesis-alonzo.json",
        "genesis-conway.json",
    ] {
        let source = devnet_dir.join(genesis_file);
        let destination = yaci_genesis_dir.join(genesis_file);
        let options = fs_extra::file::CopyOptions::new().overwrite(true);
        copy(&source, &destination, &options).map_err(|error| {
            format!(
                "Failed to copy {} into Yaci genesis directory: {}",
                genesis_file, error
            )
        })?;
    }

    // Yaci Store 2.0.0 crashes on the seeded local devnet Shelley genesis when staking pools and
    // stake mappings are present. For local development we only need the genesis timing/network
    // parameters, so keep a Yaci-specific copy with an empty staking section.
    let mut yaci_shelley_genesis: Value = serde_json::from_str(
        &fs::read_to_string(yaci_genesis_dir.join("genesis-shelley.json"))
            .map_err(|error| format!("Failed to read Yaci Shelley genesis file: {}", error))?,
    )
    .map_err(|error| format!("Failed to parse Yaci Shelley genesis file: {}", error))?;

    if let Some(staking) = yaci_shelley_genesis
        .get_mut("staking")
        .and_then(|value| value.as_object_mut())
    {
        staking.insert("pools".to_string(), Value::Object(serde_json::Map::new()));
        staking.insert("stake".to_string(), Value::Object(serde_json::Map::new()));
    }

    fs::write(
        yaci_genesis_dir.join("genesis-shelley.json"),
        serde_json::to_string_pretty(&yaci_shelley_genesis)
            .map_err(|error| format!("Failed to serialize Yaci Shelley genesis file: {}", error))?,
    )
    .map_err(|error| format!("Failed to write Yaci Shelley genesis file: {}", error))?;

    change_dir_permissions_read_only(&devnet_dir, &["cardano-node-db.json"]).map_err(|error| {
        format!(
            "Failed to apply read-only permissions to Cardano configuration files. This will cause issues with the Cardano node: {}",
            error
        )
    })?;

    let ipc_dir = devnet_dir.join("ipc");
    std::fs::create_dir_all(ipc_dir)
        .map_err(|errpr| format!("Failed to create devnet/ipc directory: {}", errpr))?;

    let db_dir = devnet_dir.join("db");
    std::fs::create_dir_all(db_dir)
        .map_err(|error| format!("Failed to create devnet/db directory: {}", error))?;

    for index in 2..=local_spo_count {
        std::fs::create_dir_all(devnet_dir.join(format!("spo{}", index)).join("db")).map_err(
            |error| {
                format!(
                    "Failed to create devnet/spo{}/db directory: {}",
                    index, error
                )
            },
        )?;
    }

    write_yaci_local_genesis_files(cardano_dir, &devnet_dir)?;

    Ok(())
}

pub fn seed_cardano_devnet(
    cardano_dir: &Path,
    optional_progress_bar: &Option<ProgressBar>,
) -> Result<(), Box<dyn std::error::Error>> {
    log_or_show_progress("Seeding Cardano Devnet", optional_progress_bar);
    let bootstrap_addresses = config::get_config().cardano.bootstrap_addresses;
    let cardano_cli = CardanoCli::for_chain_dir_and_magic(cardano_dir, "42");

    for bootstrap_address in bootstrap_addresses {
        log_or_show_progress(
            &format!(
                "Sending {} ADA to {}",
                style(bootstrap_address.amount).bold().dim(),
                style(&bootstrap_address.address).bold().dim()
            ),
            optional_progress_bar,
        );
        let build_address_args = vec![
            "address",
            "build",
            "--payment-verification-key-file",
            "/runtime/credentials/faucet.vk",
            "--testnet-magic",
            "42",
        ];
        let address_output = cardano_cli
            .exec_output_allow_failure(build_address_args.as_slice())
            .map_err(|error| format!("Failed to build faucet address: {}", error))?;
        if !address_output.status.success() {
            return Err(format!(
                "Failed to build faucet address: {}",
                String::from_utf8_lossy(&address_output.stderr)
            )
            .into());
        }
        let address = address_output.stdout;

        let faucet_address = String::from_utf8(address)
            .map_err(|error| format!("Failed to decode faucet address: {}", error))?;
        let faucet_txin_args = vec![
            "query",
            "utxo",
            "--address",
            &faucet_address,
            "--output-json",
            "--testnet-magic",
            "42",
        ];

        let wallet_address = &bootstrap_address.address;
        let tx_out = &format!("{}+{}", wallet_address, bootstrap_address.amount);
        let draft_tx_file = &format!("/runtime/seed-{}.draft", wallet_address.as_str());
        let signed_tx_file = &format!("/runtime/seed-{}.signed", wallet_address.as_str());

        // With multiple active SPOs, a freshly queried faucet UTxO can still belong to a block
        // that later loses a same-slot fork race. Rebuild the transaction on each retry so a stale
        // input does not poison every subsequent submit attempt.
        let mut is_on_chain = false;
        let mut last_tx_in: Option<String> = None;
        let mut last_seed_error: Option<String> = None;
        for submit_attempt in 1..=6 {
            let faucet_txin_output = cardano_cli
                .exec_output_allow_failure(faucet_txin_args.as_slice())
                .map_err(|error| format!("Failed to get faucet txin: {}", error))?;

            if !faucet_txin_output.status.success() {
                let stderr = String::from_utf8_lossy(&faucet_txin_output.stderr)
                    .trim()
                    .to_string();
                verbose(&format!(
                    "Faucet UTxO query attempt {}/6 for {} returned: {}",
                    submit_attempt, wallet_address, stderr
                ));
                last_seed_error = Some(stderr);
                thread::sleep(Duration::from_secs(5));
                continue;
            }

            let output_str = String::from_utf8_lossy(&faucet_txin_output.stdout);
            let parsed_json: Value = serde_json::from_str(&output_str)
                .map_err(|error| format!("Failed to parse faucet UTxO JSON: {}", error))?;
            let Some(faucet_txin) = parsed_json
                .as_object()
                .and_then(|obj| obj.iter().find(|(_, value)| *value != "null"))
                .map(|(tx_in, _)| tx_in.to_string())
            else {
                last_seed_error = Some("Faucet has no UTxO available yet".to_string());
                thread::sleep(Duration::from_secs(5));
                continue;
            };

            let build_tx_args = vec![
                "conway",
                "transaction",
                "build",
                "--change-address",
                &faucet_address,
                "--tx-in",
                &faucet_txin,
                "--tx-out",
                tx_out,
                "--out-file",
                draft_tx_file,
                "--testnet-magic",
                "42",
            ];

            let build_tx_output = cardano_cli
                .exec_output_allow_failure(build_tx_args.as_slice())
                .map_err(|error| format!("Failed to build seed transaction: {}", error))?;
            if !build_tx_output.status.success() {
                let stderr = String::from_utf8_lossy(&build_tx_output.stderr)
                    .trim()
                    .to_string();
                verbose(&format!(
                    "Seed transaction build attempt {}/6 for {} returned: {}",
                    submit_attempt, wallet_address, stderr
                ));
                last_seed_error = Some(stderr);
                thread::sleep(Duration::from_secs(5));
                continue;
            }

            let sign_tx_args = vec![
                "conway",
                "transaction",
                "sign",
                "--tx-body-file",
                draft_tx_file,
                "--signing-key-file",
                "/runtime/credentials/faucet.sk",
                "--out-file",
                signed_tx_file,
                "--testnet-magic",
                "42",
            ];

            let sign_tx_output = cardano_cli
                .exec_output_allow_failure(sign_tx_args.as_slice())
                .map_err(|error| format!("Failed to sign seed transaction: {}", error))?;
            if !sign_tx_output.status.success() {
                return Err(format!(
                    "Failed to sign seed transaction for {}: {}",
                    wallet_address,
                    String::from_utf8_lossy(&sign_tx_output.stderr)
                )
                .into());
            }

            let tx_id_output = cardano_cli
                .exec_output_allow_failure(
                    ["conway", "transaction", "txid", "--tx-file", signed_tx_file].as_slice(),
                )
                .map_err(|error| format!("Failed to compute seed tx id: {}", error))?;
            if !tx_id_output.status.success() {
                return Err(format!(
                    "Failed to compute seed tx id for {}: {}",
                    wallet_address,
                    String::from_utf8_lossy(&tx_id_output.stderr)
                )
                .into());
            }
            let tx_id = tx_id_output.stdout;

            let raw_tx_id = String::from_utf8(tx_id)
                .map_err(|error| format!("Failed to decode seed tx id: {}", error))?;
            let tx_id: String = raw_tx_id.chars().filter(|c| !c.is_whitespace()).collect();
            let tx_in = format!("{}#0", tx_id);
            last_tx_in = Some(tx_in.clone());

            let submit_tx_args = vec![
                "conway",
                "transaction",
                "submit",
                "--tx-file",
                signed_tx_file,
                "--testnet-magic",
                "42",
            ];
            let query_utxo_args = vec![
                "query",
                "utxo",
                "--tx-in",
                tx_in.as_str(),
                "--output-json",
                "--testnet-magic",
                "42",
            ];
            log_or_show_progress(
                &format!(
                    "Waiting for transaction {} to settle",
                    style(&tx_in).bold().dim()
                ),
                optional_progress_bar,
            );

            let submit_tx_output = cardano_cli
                .exec_output_allow_failure(submit_tx_args.as_slice())
                .map_err(|error| format!("Failed to submit seed transaction: {}", error))?;

            if !submit_tx_output.status.success() {
                let stderr = String::from_utf8_lossy(&submit_tx_output.stderr)
                    .trim()
                    .to_string();
                verbose(&format!(
                    "Seed transaction submit attempt {}/6 for {} returned: {}",
                    submit_attempt, wallet_address, stderr
                ));
                last_seed_error = Some(stderr);
            } else {
                last_seed_error = None;
            }

            for poll_attempt in 1..=4 {
                let utxo_output = cardano_cli
                    .exec_output_allow_failure(query_utxo_args.as_slice())
                    .map_err(|error| format!("Failed to query settlement UTxO: {}", error))?;

                if utxo_output.status.success() {
                    let utxo_str = String::from_utf8(utxo_output.stdout).map_err(|error| {
                        format!("Failed to decode settlement UTxO response: {}", error)
                    })?;
                    let parsed_utxo: Value = serde_json::from_str(&utxo_str).map_err(|error| {
                        format!("Failed to parse settlement UTxO response: {}", error)
                    })?;

                    if parsed_utxo
                        .get(tx_in.as_str())
                        .is_some_and(|value| value != "null")
                    {
                        verbose(&format!(
                            "Seed transaction settled on canonical chain:\n{}",
                            utxo_str
                        ));
                        is_on_chain = true;
                        break;
                    }
                }

                if poll_attempt < 4 {
                    verbose("... still waiting for confirmation ...");
                    thread::sleep(Duration::from_secs(5));
                }
            }

            if is_on_chain {
                break;
            }

            verbose(&format!(
                "Seed transaction {} was not visible on the canonical chain after submit attempt {}/6; retrying with a fresh faucet UTxO",
                tx_in, submit_attempt
            ));
        }

        if !is_on_chain {
            let tx_in = last_tx_in.as_deref().unwrap_or("unknown");
            let seed_error = last_seed_error
                .map(|error| format!(" Last seed error: {}", error))
                .unwrap_or_default();
            return Err(format!(
                "Seed transaction {} for {} did not settle on the canonical chain after multiple attempts.{}",
                tx_in, wallet_address, seed_error
            )
            .into());
        }
    }

    Ok(())
}

fn get_genesis_hash(era: String, cardano_dir: &Path) -> Result<String, Box<dyn std::error::Error>> {
    let genesis_file = format!("/runtime/genesis-{}.json", era);
    let cli_args = if era == "byron" {
        vec![
            "byron",
            "genesis",
            "print-genesis-hash",
            "--genesis-json",
            genesis_file.as_str(),
        ]
    } else {
        vec![
            "conway",
            "genesis",
            "hash",
            "--genesis",
            genesis_file.as_str(),
        ]
    };

    let cardano_cli = CardanoCli::for_chain_dir_and_magic(cardano_dir, "42");
    let genesis_hash = cardano_cli
        .exec_output(cli_args.as_slice())
        .map_err(|error| format!("Failed to get genesis hash: {}", error))?
        .stdout;

    let hash = String::from_utf8(genesis_hash)
        .map_err(|error| format!("Failed to get {} genesis hash: {}", era, error))?;
    Ok(hash)
}

pub(crate) fn query_epoch_nonce(
    cardano_dir: &Path,
    network_magic: u64,
) -> Result<String, Box<dyn std::error::Error>> {
    let network_magic_string = network_magic.to_string();
    let cardano_cli =
        CardanoCli::for_chain_dir_and_magic(cardano_dir, network_magic_string.as_str());
    let epoch_nonce = cardano_cli
        .exec_output(
            [
                "query",
                "protocol-state",
                "--testnet-magic",
                network_magic_string.as_str(),
            ]
            .as_slice(),
        )
        .map_err(|error| format!("Failed to get epoch nonce: {}", error))?
        .stdout;

    let epoch_nonce = String::from_utf8(epoch_nonce)
        .map_err(|error| format!("Failed to get epoch nonce: {}", error))?;
    let epoch_nonce: Value = serde_json::from_str(&epoch_nonce)
        .map_err(|error| format!("Failed to parse epoch nonce: {}", error))?;
    let epoch_nonce = epoch_nonce["epochNonce"]
        .as_str()
        .ok_or("Failed to extract epoch nonce")?;

    Ok(epoch_nonce.trim().to_string())
}

pub(crate) fn refresh_local_gateway_epoch_nonce(
    project_root_path: &Path,
) -> Result<(), Box<dyn std::error::Error>> {
    let cardano_dir = project_root_path.join("chains").join("cardano");
    let gateway_dir = project_root_path.join("cardano").join("gateway");
    let gateway_env = gateway_dir.join(".env");
    let epoch_nonce = query_epoch_nonce(cardano_dir.as_path(), 42)?;
    let current_override = read_gateway_env_value(
        gateway_env.as_path(),
        "CARDANO_PROBABILISTIC_EPOCH_NONCE_OVERRIDE",
    )?
    .unwrap_or_default();
    let current_genesis =
        read_gateway_env_value(gateway_env.as_path(), "CARDANO_EPOCH_NONCE_GENESIS")?
            .unwrap_or_default();
    if current_override.trim_matches('"') == epoch_nonce
        && current_genesis.trim_matches('"') == epoch_nonce
    {
        return Ok(());
    }

    let epoch_nonce_value = format!("\"{}\"", epoch_nonce);
    set_or_append_env_var(
        gateway_env.as_path(),
        "CARDANO_EPOCH_NONCE_GENESIS",
        epoch_nonce_value.as_str(),
    )?;
    set_or_append_env_var(
        gateway_env.as_path(),
        "CARDANO_PROBABILISTIC_EPOCH_NONCE_OVERRIDE",
        epoch_nonce_value.as_str(),
    )?;
    log(&format!(
        "Updated local Gateway probabilistic epoch nonce override to {}",
        epoch_nonce
    ));

    DockerCli::new(gateway_dir.as_path()).compose_ok(&[
        "up",
        "-d",
        "--build",
        "--force-recreate",
        "app",
    ])?;

    for _ in 0..60 {
        let healthy = Command::new("curl")
            .args(["-fsS", LOCAL_GATEWAY_HEALTH_URL])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map(|status| status.success())
            .unwrap_or(false);
        if healthy {
            return Ok(());
        }
        thread::sleep(Duration::from_secs(2));
    }

    Err(format!(
        "Timed out while waiting for Gateway at {} after refreshing local epoch nonce",
        LOCAL_GATEWAY_HEALTH_URL
    )
    .into())
}

fn parse_env_file(env_path: &Path) -> Result<HashMap<String, String>, Box<dyn std::error::Error>> {
    let contents = fs::read_to_string(env_path).map_err(|error| {
        format!(
            "Failed to read gateway environment file {}: {}",
            env_path.display(),
            error
        )
    })?;
    let mut values = HashMap::new();

    for raw_line in contents.lines() {
        let line = raw_line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let Some((key, value)) = line.split_once('=') else {
            continue;
        };
        values.insert(key.trim().to_string(), value.trim().to_string());
    }

    Ok(values)
}

pub fn read_gateway_env_value(
    gateway_env: &Path,
    key: &str,
) -> Result<Option<String>, Box<dyn std::error::Error>> {
    Ok(parse_env_file(gateway_env)?.get(key).cloned())
}

fn validate_public_testnet_gateway_env(
    gateway_env: &Path,
    network: config::CoreCardanoNetwork,
) -> Result<(), Box<dyn std::error::Error>> {
    validate_public_testnet_env_network_state(gateway_env, network)?;
    let env_values = parse_env_file(gateway_env)?;
    resolve_preprod_kupo_mode(gateway_env)?;
    let required_groups = [
        ("KUPO_ENDPOINT", vec!["KUPO_ENDPOINT"]),
        ("OGMIOS_ENDPOINT", vec!["OGMIOS_ENDPOINT"]),
        (
            CARDANO_KUPO_MODE_KEY,
            vec![CARDANO_KUPO_MODE_KEY, PREPROD_KUPO_MODE_KEY],
        ),
        ("CARDANO_CHAIN_HOST", vec!["CARDANO_CHAIN_HOST"]),
        ("CARDANO_CHAIN_PORT", vec!["CARDANO_CHAIN_PORT"]),
    ];

    let missing = required_groups
        .iter()
        .filter(|(_, keys)| {
            !keys.iter().any(|key| {
                env_values
                    .get(*key)
                    .map(|value| !value.trim().is_empty())
                    .unwrap_or(false)
            })
        })
        .map(|(label, _)| *label)
        .collect::<Vec<_>>();
    if !missing.is_empty() {
        // Public-testnet mode is hybrid: caribic manages local history followers,
        // but live chain access still comes from external Kupo/Ogmios endpoints.
        return Err(format!(
            "Cardano {} startup uses managed local history services but still requires external live Cardano endpoints. cardano/gateway/.env is missing: {}.\nSet those keys to host-reachable {} infrastructure before starting.",
            network.as_str(),
            missing.join(", "),
            network.as_str(),
        )
        .into());
    }

    let disallowed_local_defaults = [
        ("KUPO_ENDPOINT", "http://kupo:1442"),
        ("OGMIOS_ENDPOINT", "http://cardano-node-ogmios:1337"),
        ("CARDANO_CHAIN_HOST", "cardano-node"),
    ];
    let still_local = disallowed_local_defaults
        .iter()
        .filter(|(key, local_default)| {
            env_values
                .get(*key)
                .is_some_and(|value| value.trim() == *local_default)
        })
        .map(|(key, _)| *key)
        .collect::<Vec<_>>();
    if !still_local.is_empty() {
        return Err(format!(
            "Cardano {} startup still points {} at local docker-only defaults.\nReplace those values with host-reachable {} endpoints before starting.",
            network.as_str(),
            still_local.join(", "),
            network.as_str(),
        )
        .into());
    }

    let runtime_kupo_endpoint = env_values
        .get("GATEWAY_RUNTIME_KUPO_ENDPOINT")
        .or_else(|| env_values.get("KUPO_ENDPOINT"))
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .ok_or(
            "CARDANO_KUPO_MODE=remote requires GATEWAY_RUNTIME_KUPO_ENDPOINT or KUPO_ENDPOINT",
        )?;
    if is_local_kupo_endpoint(runtime_kupo_endpoint) {
        return Err(format!(
            "CARDANO_KUPO_MODE=remote cannot use local Kupo endpoint '{}'. Configure a remote Kupo endpoint explicitly.",
            runtime_kupo_endpoint
        )
        .into());
    }
    validate_external_http_endpoint(runtime_kupo_endpoint, "Kupo")?;

    let ogmios_endpoint = env_values
        .get("OGMIOS_ENDPOINT")
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .ok_or("Public Cardano testnets require an external OGMIOS_ENDPOINT")?;
    if endpoint_uses_local_host(ogmios_endpoint) {
        return Err(format!(
            "Public Cardano testnets cannot use local Ogmios endpoint '{}'. Configure an external Ogmios endpoint explicitly.",
            ogmios_endpoint
        )
        .into());
    }
    validate_external_http_endpoint(ogmios_endpoint, "Ogmios")?;

    let relay_host = env_values
        .get("CARDANO_CHAIN_HOST")
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .ok_or("Public Cardano testnets require an external CARDANO_CHAIN_HOST")?;
    if is_local_or_container_host(relay_host) {
        return Err(format!(
            "Public Cardano testnets cannot use local relay host '{}'. Configure an external raw Cardano relay explicitly.",
            relay_host
        )
        .into());
    }
    let relay_port = env_values
        .get("CARDANO_CHAIN_PORT")
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .ok_or("Public Cardano testnets require CARDANO_CHAIN_PORT")?;
    let parsed_relay_port = relay_port
        .parse::<u16>()
        .map_err(|error| format!("Invalid CARDANO_CHAIN_PORT '{relay_port}': {error}"))?;
    if parsed_relay_port == 0 {
        return Err("Invalid CARDANO_CHAIN_PORT '0': expected a port from 1 to 65535".into());
    }

    Ok(())
}

fn resolve_preprod_live_endpoint(
    gateway_env: &Path,
    gateway_key: &str,
    env_keys: &[&str],
) -> Result<Option<String>, Box<dyn std::error::Error>> {
    let env_value = env_keys
        .iter()
        .find_map(|key| std::env::var(key).ok())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());

    let gateway_value = read_gateway_env_value(gateway_env, gateway_key)?
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());

    Ok(env_value.or(gateway_value))
}

fn is_local_or_container_host(host: &str) -> bool {
    let host = host.trim().trim_matches(['[', ']']);
    host.eq_ignore_ascii_case("localhost")
        || [
            "cardano-node",
            "cardano-node-ogmios",
            "kupo",
            "ogmios",
            "ogmios-proxy",
        ]
        .iter()
        .any(|container_host| host.eq_ignore_ascii_case(container_host))
        || host
            .parse::<std::net::IpAddr>()
            .map(|address| address.is_loopback() || address.is_unspecified())
            .unwrap_or(false)
}

fn endpoint_uses_local_host(endpoint: &str) -> bool {
    reqwest::Url::parse(endpoint)
        .ok()
        .and_then(|parsed| parsed.host_str().map(is_local_or_container_host))
        .unwrap_or(false)
}

fn validate_external_http_endpoint(
    endpoint: &str,
    label: &str,
) -> Result<(), Box<dyn std::error::Error>> {
    let parsed = reqwest::Url::parse(endpoint)
        .map_err(|error| format!("Invalid {label} endpoint '{endpoint}': {error}"))?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err(format!(
            "Invalid {label} endpoint scheme '{}'. Expected http or https.",
            parsed.scheme()
        )
        .into());
    }
    let host = parsed
        .host_str()
        .ok_or_else(|| format!("Invalid {label} endpoint '{endpoint}': missing host"))?;
    if is_local_or_container_host(host) {
        return Err(format!(
            "Public Cardano testnets cannot use local {label} endpoint '{endpoint}'. Configure an external endpoint explicitly."
        )
        .into());
    }

    Ok(())
}

fn is_local_kupo_endpoint(endpoint: &str) -> bool {
    endpoint_uses_local_host(endpoint) || endpoint.trim().starts_with("http://kupo:1442")
}

pub fn resolve_preprod_kupo_mode(
    gateway_env: &Path,
) -> Result<PreprodKupoMode, Box<dyn std::error::Error>> {
    let mode = resolve_env_or_file_value(
        &parse_env_file(gateway_env)?,
        &[
            "CARIBIC_CARDANO_KUPO_MODE",
            CARDANO_KUPO_MODE_KEY,
            "CARIBIC_PREPROD_KUPO_MODE",
            PREPROD_KUPO_MODE_KEY,
        ],
        &[CARDANO_KUPO_MODE_KEY, PREPROD_KUPO_MODE_KEY],
    )
    .ok_or_else(|| {
        format!(
            "Missing {}. Set {}=remote to use an external Kupo endpoint. {} remains supported as a legacy alias.",
            CARDANO_KUPO_MODE_KEY,
            CARDANO_KUPO_MODE_KEY,
            PREPROD_KUPO_MODE_KEY,
        )
    })?;

    match mode.trim().to_lowercase().as_str() {
        "remote" => Ok(PreprodKupoMode::Remote),
        "local" => Err(format!(
            "{}=local is not supported for public Cardano networks. Configure an external Kupo endpoint and set {}=remote; Caribic will not start local Kupo, Ogmios, or cardano-node services for preprod/preview.",
            CARDANO_KUPO_MODE_KEY, CARDANO_KUPO_MODE_KEY,
        )
        .into()),
        other => Err(format!(
            "Invalid {} value '{}'. Expected 'remote'.",
            CARDANO_KUPO_MODE_KEY, other
        )
        .into()),
    }
}

fn resolve_preprod_remote_kupo_endpoint(
    gateway_env: &Path,
) -> Result<String, Box<dyn std::error::Error>> {
    let endpoint = resolve_preprod_live_endpoint(
        gateway_env,
        "KUPO_ENDPOINT",
        &["CARIBIC_KUPO_URL", "KUPO_URL"],
    )?
    .ok_or("Missing remote Kupo endpoint. Set CARIBIC_KUPO_URL/KUPO_URL or KUPO_ENDPOINT.")?;

    if is_local_kupo_endpoint(endpoint.as_str()) {
        return Err(format!(
            "{}=remote requires a non-local Kupo endpoint, got '{}'.",
            CARDANO_KUPO_MODE_KEY, endpoint
        )
        .into());
    }
    validate_external_http_endpoint(endpoint.as_str(), "Kupo")?;

    Ok(endpoint)
}

pub fn resolve_external_cardano_deploy_endpoints(
    cardano_dir: &Path,
) -> Result<(String, String), Box<dyn std::error::Error>> {
    let gateway_env = cardano_dir.join("../../cardano/gateway/.env");
    let env_ogmios = std::env::var("CARIBIC_OGMIOS_URL")
        .ok()
        .or_else(|| std::env::var("OGMIOS_URL").ok())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let env_kupo = std::env::var("CARIBIC_KUPO_URL")
        .ok()
        .or_else(|| std::env::var("KUPO_URL").ok())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());

    let ogmios = env_ogmios
        .or(read_gateway_env_value(&gateway_env, "OGMIOS_ENDPOINT")?)
        .ok_or("Missing OGMIOS endpoint for external Cardano deploy")?;
    let kupo = env_kupo
        .or(read_gateway_env_value(&gateway_env, "KUPO_ENDPOINT")?)
        .ok_or("Missing KUPO endpoint for external Cardano deploy")?;

    if ogmios.trim().is_empty() || kupo.trim().is_empty() {
        return Err(
            "Missing external Cardano deploy endpoints. Set CARIBIC_OGMIOS_URL/CARIBIC_KUPO_URL or configure OGMIOS_ENDPOINT/KUPO_ENDPOINT in cardano/gateway/.env."
                .into(),
        );
    }
    if endpoint_uses_local_host(ogmios.as_str()) || endpoint_uses_local_host(kupo.as_str()) {
        return Err(
            "External Cardano deploy endpoints point at a local or docker-only host. Set CARIBIC_OGMIOS_URL/CARIBIC_KUPO_URL, or replace OGMIOS_ENDPOINT/KUPO_ENDPOINT in cardano/gateway/.env with host-reachable external endpoints."
                .into(),
        );
    }
    validate_external_http_endpoint(ogmios.as_str(), "Ogmios")?;
    validate_external_http_endpoint(kupo.as_str(), "Kupo")?;

    Ok((ogmios, kupo))
}

fn write_gateway_env_for_network(
    cardano_dir: &Path,
    clean: bool,
    network: config::CoreCardanoNetwork,
    light_client_mode: &str,
) -> Result<(), Box<dyn std::error::Error>> {
    let profile = config::cardano_network_profile(network);
    let network_magic = profile.network_magic.to_string();
    let project_root = cardano_dir.join("../..");
    let cardano_source_dir = cardano_dir.join("../../cardano");
    let gateway_dir = cardano_source_dir.join("gateway");
    let gateway_env = gateway_dir.join(".env");

    if network.is_public_testnet() {
        validate_public_testnet_env_network_state(&gateway_env, network)?;
        validate_network_bound_process_overrides(
            &[
                "CARIBIC_CARDANO_KUPO_MODE",
                CARDANO_KUPO_MODE_KEY,
                "CARIBIC_PREPROD_KUPO_MODE",
                PREPROD_KUPO_MODE_KEY,
                "CARIBIC_KUPO_URL",
                "KUPO_URL",
                "CARIBIC_OGMIOS_URL",
                "OGMIOS_URL",
                "CARIBIC_OGMIOS_HTTP_URL",
                "OGMIOS_HTTP_URL",
                "CARIBIC_KUPO_API_KEY",
                "KUPO_API_KEY",
                "CARIBIC_OGMIOS_API_KEY",
                "OGMIOS_API_KEY",
                "CARIBIC_KOIOS_API_KEY",
                "CARDANO_KOIOS_API_KEY",
                "KOIOS_API_KEY",
            ],
            network,
        )?;
    }

    // `--clean` resets managed containers and data, not operator-owned public
    // endpoint credentials/checkpoints. Only local devnet configuration is
    // safely disposable.
    if !gateway_env.exists() || (clean && network == config::CoreCardanoNetwork::Local) {
        let options = fs_extra::file::CopyOptions::new().overwrite(true);
        copy(gateway_dir.join(".env.example"), &gateway_env, &options)?;
    }
    secure_env_file_permissions(&gateway_env)?;

    let shared_gateway_network_defaults = [
        (CARDANO_RUNTIME_NETWORK_KEY, network.as_str()),
        ("CARDANO_CHAIN_ID", profile.chain_id.as_str()),
        ("CARDANO_CHAIN_NETWORK_MAGIC", network_magic.as_str()),
        ("CARDANO_NETWORK_MAGIC", network_magic.as_str()),
        ("CARDANO_LIGHT_CLIENT_MODE", light_client_mode),
        ("MITHRIL_ENDPOINT", profile.mithril_aggregator_url.as_str()),
        (
            "MITHRIL_GENESIS_VERIFICATION_KEY",
            profile.mithril_genesis_verification_key.as_str(),
        ),
    ];

    for (key, value) in shared_gateway_network_defaults {
        set_or_append_env_var(&gateway_env, key, value)?;
    }

    match network {
        config::CoreCardanoNetwork::Local => {
            let local_gateway_defaults = [
                ("HISTORY_DB_HOST", "yaci-store-postgres"),
                ("HISTORY_DB_PORT", "5432"),
                ("HISTORY_DB_NAME", "yaci_store"),
                ("HISTORY_DB_USERNAME", "yaci"),
                ("HISTORY_DB_PASSWORD", "dbpass"),
                ("GATEWAY_DB_HOST", "postgres"),
                ("GATEWAY_DB_PORT", "5432"),
                ("KUPO_ENDPOINT", "http://kupo:1442"),
                ("OGMIOS_ENDPOINT", "http://cardano-node-ogmios:1337"),
                ("YACI_STORE_ENDPOINT", "http://yaci-store:8080"),
                ("CARDANO_CHAIN_HOST", "cardano-node"),
                ("CARDANO_CHAIN_PORT", "3001"),
                (
                    "CARDANO_STABILITY_ASSUME_POOL_REGISTRATION_SLOT",
                    LOCAL_STABILITY_ASSUME_POOL_REGISTRATION_SLOT,
                ),
                ("CARDANO_EPOCH_LENGTH", LOCAL_CARDANO_EPOCH_LENGTH),
                ("CARDANO_CLIENT_TRUSTING_PERIOD_SECONDS", "315360000"),
            ];
            for (key, value) in local_gateway_defaults {
                set_or_append_env_var(&gateway_env, key, value)?;
            }

            let epoch_nonce = query_epoch_nonce(cardano_dir, profile.network_magic)
                .unwrap_or_else(|_| String::new());
            let epoch_nonce_value = format!("\"{}\"", epoch_nonce);
            set_or_append_env_var(
                &gateway_env,
                "CARDANO_EPOCH_NONCE_GENESIS",
                epoch_nonce_value.as_str(),
            )?;
        }
        config::CoreCardanoNetwork::Preprod | config::CoreCardanoNetwork::Preview => {
            let epoch_length = network.epoch_length().to_string();
            let preprod_kupo_mode = resolve_preprod_kupo_mode(&gateway_env)?;
            set_or_append_env_var(
                &gateway_env,
                CARDANO_KUPO_MODE_KEY,
                preprod_kupo_mode.as_str(),
            )?;
            if network == config::CoreCardanoNetwork::Preprod {
                set_or_append_env_var(
                    &gateway_env,
                    PREPROD_KUPO_MODE_KEY,
                    preprod_kupo_mode.as_str(),
                )?;
            }

            let public_testnet_gateway_defaults = [
                ("HISTORY_DB_HOST", "yaci-store-postgres"),
                ("HISTORY_DB_PORT", "5432"),
                ("HISTORY_DB_NAME", "yaci_store"),
                ("HISTORY_DB_USERNAME", "yaci"),
                ("HISTORY_DB_PASSWORD", "dbpass"),
                ("GATEWAY_DB_HOST", "postgres"),
                ("GATEWAY_DB_PORT", "5432"),
                ("CARDANO_EPOCH_LENGTH", epoch_length.as_str()),
            ];
            for (key, value) in public_testnet_gateway_defaults {
                set_or_append_env_var(&gateway_env, key, value)?;
            }

            let (relay_host, relay_port) =
                resolve_public_testnet_history_relay(&gateway_env, network)?;
            set_or_append_env_var(&gateway_env, "CARDANO_CHAIN_HOST", relay_host.as_str())?;
            set_or_append_env_var(&gateway_env, "CARDANO_CHAIN_PORT", relay_port.as_str())?;

            let yaci_checkpoint = resolve_public_testnet_yaci_checkpoint(&gateway_env, network)?;
            set_or_append_env_var(
                &gateway_env,
                YACI_SYNC_START_SLOT_KEY,
                yaci_checkpoint.slot.as_str(),
            )?;
            set_or_append_env_var(
                &gateway_env,
                YACI_SYNC_START_BLOCKHASH_KEY,
                yaci_checkpoint.block_hash.as_str(),
            )?;
            if let Some(block_no) = yaci_checkpoint.block_no.as_deref() {
                set_or_append_env_var(&gateway_env, YACI_SYNC_START_BLOCK_NO_KEY, block_no)?;
            }

            let runtime_kupo_endpoint = resolve_preprod_remote_kupo_endpoint(&gateway_env)?;
            set_or_append_env_var(
                &gateway_env,
                "KUPO_ENDPOINT",
                runtime_kupo_endpoint.as_str(),
            )?;
            let runtime_kupo_api_key = resolve_preprod_live_endpoint(
                &gateway_env,
                "KUPO_API_KEY",
                &["CARIBIC_KUPO_API_KEY", "KUPO_API_KEY"],
            )?;
            if let Some(kupo_api_key) = runtime_kupo_api_key.as_deref() {
                set_or_append_env_var(&gateway_env, "KUPO_API_KEY", kupo_api_key)?;
            }

            if let Some(ogmios_endpoint) = resolve_preprod_live_endpoint(
                &gateway_env,
                "OGMIOS_ENDPOINT",
                &["CARIBIC_OGMIOS_URL", "OGMIOS_URL"],
            )? {
                set_or_append_env_var(&gateway_env, "OGMIOS_ENDPOINT", ogmios_endpoint.as_str())?;
            }
            if let Some(ogmios_api_key) = resolve_preprod_live_endpoint(
                &gateway_env,
                "OGMIOS_API_KEY",
                &["CARIBIC_OGMIOS_API_KEY", "OGMIOS_API_KEY"],
            )? {
                set_or_append_env_var(&gateway_env, "OGMIOS_API_KEY", ogmios_api_key.as_str())?;
            }

            if let Some(koios_api_key) = resolve_preprod_live_endpoint(
                &gateway_env,
                "CARDANO_KOIOS_API_KEY",
                &[
                    "CARIBIC_KOIOS_API_KEY",
                    "CARDANO_KOIOS_API_KEY",
                    "KOIOS_API_KEY",
                ],
            )? {
                set_or_append_env_var(
                    &gateway_env,
                    "CARDANO_KOIOS_API_KEY",
                    koios_api_key.as_str(),
                )?;
            }

            set_or_append_env_var(
                &gateway_env,
                "GATEWAY_RUNTIME_KUPO_ENDPOINT",
                runtime_kupo_endpoint.as_str(),
            )?;
            set_or_append_env_var(
                &gateway_env,
                "GATEWAY_RUNTIME_KUPO_API_KEY",
                runtime_kupo_api_key.as_deref().unwrap_or(""),
            )?;
            if let Some(koios_base_url) = network.koios_base_url() {
                set_env_var_if_absent(
                    &gateway_env,
                    "CARDANO_EPOCH_PARAMS_ENDPOINT",
                    koios_base_url,
                )?;
                set_env_var_if_absent(
                    &gateway_env,
                    "CARDANO_POOL_REGISTRATION_HISTORY_ENDPOINT",
                    koios_base_url,
                )?;
            }
        }
    }

    let manifest_container_path = profile
        .bridge_manifest_path
        .as_deref()
        .filter(|path| Path::new(path).exists())
        .and_then(|path| gateway_container_artifact_path(project_root.as_path(), path));
    let handler_container_path =
        gateway_container_artifact_path(project_root.as_path(), profile.handler_json_path.as_str())
            .ok_or("Failed to derive deployment artifact container path")?;

    if let Some(manifest_path) = manifest_container_path {
        set_or_append_env_var(&gateway_env, "BRIDGE_MANIFEST_PATH", manifest_path.as_str())?;
        set_or_append_env_var(&gateway_env, "HANDLER_JSON_PATH", "")?;
    } else {
        set_or_append_env_var(
            &gateway_env,
            "HANDLER_JSON_PATH",
            handler_container_path.as_str(),
        )?;
        set_or_append_env_var(&gateway_env, "BRIDGE_MANIFEST_PATH", "")?;
    }

    secure_env_file_permissions(&gateway_env)?;

    Ok(())
}

fn gateway_container_artifact_path(project_root: &Path, artifact_path: &str) -> Option<String> {
    let artifact_path = Path::new(artifact_path);
    let artifact_path = artifact_path
        .canonicalize()
        .unwrap_or_else(|_| artifact_path.to_path_buf());
    let project_root = project_root
        .canonicalize()
        .unwrap_or_else(|_| project_root.to_path_buf());
    let deployments_dir = project_root.join("cardano/offchain/deployments");
    let manifests_dir = project_root.join("manifests");

    if let Ok(relative_path) = artifact_path.strip_prefix(&deployments_dir) {
        return Some(format!(
            "/usr/src/app/cardano/offchain/deployments/{}",
            relative_path.to_string_lossy()
        ));
    }

    if let Ok(relative_path) = artifact_path.strip_prefix(&manifests_dir) {
        return Some(format!(
            "/usr/src/app/manifests/{}",
            relative_path.to_string_lossy()
        ));
    }

    artifact_path
        .file_name()
        .and_then(|name| name.to_str())
        .map(|file_name| format!("/usr/src/app/cardano/offchain/deployments/{file_name}"))
}

fn ensure_gateway_databases(cardano_dir: &Path) -> Result<(), Box<dyn std::error::Error>> {
    let wait_for_postgres = |service_name: &str,
                             username: &str,
                             label: &str|
     -> Result<(), Box<dyn std::error::Error>> {
        let docker = DockerCli::new(cardano_dir);
        let mut ready = false;
        for attempt in 1..=30 {
            let health_check = docker.compose_exec_no_tty_output(
                service_name,
                ["pg_isready", "-U", username].as_slice(),
            );

            if health_check.is_ok() {
                ready = true;
                break;
            }

            if attempt < 30 {
                verbose(&format!(
                    "Waiting for {label} to be ready (attempt {}/30)...",
                    attempt
                ));
                thread::sleep(Duration::from_secs(2));
            }
        }

        if ready {
            Ok(())
        } else {
            Err(format!("{label} failed to become ready after 60 seconds").into())
        }
    };

    wait_for_postgres("postgres", "postgres", "gateway postgres")?;
    if crate::config::get_config()
        .cardano
        .services
        .history_backend_enabled()
    {
        wait_for_postgres("yaci-store-postgres", "yaci", "Yaci history postgres")?;
    }

    let ensure_database_exists = |service_name: &str,
                                  database_user: &str,
                                  admin_database: &str,
                                  database_name: &str,
                                  label: &str|
     -> Result<(), Box<dyn std::error::Error>> {
        let docker = DockerCli::new(cardano_dir);
        let db_exists_query = format!(
            "SELECT 1 FROM pg_database WHERE datname = '{}'",
            database_name
        );
        let db_check = docker.compose_exec_no_tty_output(
            service_name,
            [
                "psql",
                "-U",
                database_user,
                "-d",
                admin_database,
                "-tc",
                db_exists_query.as_str(),
            ]
            .as_slice(),
        );

        let db_exists = db_check
            .ok()
            .and_then(|output| String::from_utf8(output.stdout).ok())
            .map(|result| result.trim().contains("1"))
            .unwrap_or(false);

        if db_exists {
            verbose(&format!("{label} database already exists"));
            return Ok(());
        }

        log(&format!("Creating {database_name} database..."));
        let create_database_query = format!("CREATE DATABASE {}", database_name);
        let create_result = docker
            .compose_exec_no_tty_output(
                service_name,
                [
                    "psql",
                    "-U",
                    database_user,
                    "-d",
                    admin_database,
                    "-c",
                    create_database_query.as_str(),
                ]
                .as_slice(),
            )
            .map_err(|error| format!("Failed to create {} database: {}", database_name, error))?;

        if !create_result.status.success() {
            let error_msg = String::from_utf8_lossy(&create_result.stderr);
            return Err(
                format!("Failed to create {} database: {}", database_name, error_msg).into(),
            );
        }

        log(&format!("{label} database created successfully"));
        Ok(())
    };

    ensure_database_exists(
        "postgres",
        "postgres",
        "postgres",
        "gateway_app",
        "Gateway application",
    )?;
    if crate::config::get_config()
        .cardano
        .services
        .history_backend_enabled()
    {
        ensure_database_exists(
            "yaci-store-postgres",
            "yaci",
            "postgres",
            "yaci_store",
            "Yaci history backend",
        )?;
    }

    Ok(())
}

pub fn prepare_db_sync_and_gateway(
    cardano_dir: &Path,
    clean: bool,
    network: config::CoreCardanoNetwork,
    light_client_mode: &str,
) -> Result<(), Box<dyn std::error::Error>> {
    if matches!(network, config::CoreCardanoNetwork::Local) {
        let devnet_dir = cardano_dir.join("devnet");
        let cardano_node_db = devnet_dir.join("cardano-node-db.json");

        let byron_genesis_hash = get_genesis_hash("byron".to_string(), cardano_dir)?;
        let shelley_genesis_hash = get_genesis_hash("shelley".to_string(), cardano_dir)?;
        let alonzo_genesis_hash = get_genesis_hash("alonzo".to_string(), cardano_dir)?;
        let conway_genesis_hash = get_genesis_hash("conway".to_string(), cardano_dir)?;

        replace_text_in_file(
            &cardano_node_db,
            r#"xByronGenesisHash"#,
            byron_genesis_hash.trim(),
        )?;

        replace_text_in_file(
            &cardano_node_db,
            r#"xShelleyGenesisHash"#,
            shelley_genesis_hash.trim(),
        )?;

        replace_text_in_file(
            &cardano_node_db,
            r#"xAlonzoGenesisHash"#,
            alonzo_genesis_hash.trim(),
        )?;

        replace_text_in_file(
            &cardano_node_db,
            r#"xConwayGenesisHash"#,
            conway_genesis_hash.trim(),
        )?;

        let epoch_nonce = query_epoch_nonce(cardano_dir, 42)?;
        let cardano_cli = CardanoCli::for_chain_dir_and_magic(cardano_dir, "42");

        let pool_params = cardano_cli
            .exec_output(["query", "ledger-state", "--testnet-magic", "42"].as_slice())
            .map_err(|error| format!("Failed to get pool params: {}", error))?
            .stdout;

        let pool_params = String::from_utf8(pool_params)
            .map_err(|error| format!("Failed to get pool params: {}", error))?;

        let pool_params: Value = serde_json::from_str(&pool_params)
            .map_err(|error| format!("Failed to parse pool params: {}", error))?;
        let pool_params = pool_params["stateBefore"]["esSnapshots"]["pstakeMark"]["poolParams"]
            .as_object()
            .ok_or("Failed to extract pool params")?;

        let base_info_dir = cardano_dir.join("baseinfo");
        fs::create_dir_all(&base_info_dir)
            .map_err(|error| format!("Failed to create baseinfo directory: {}", error))?;

        let pool_params_str = serde_json::to_string(pool_params)
            .map_err(|error| format!("Failed to serialize poolParams: {}", error))?;

        let info = format!(
            "{{\"Epoch0Nonce\": \"{}\", \"poolParams\": {}}}",
            epoch_nonce.trim(),
            pool_params_str.trim()
        );
        fs::write(base_info_dir.join("info.json"), info)
            .map_err(|error| format!("Failed to write info.json file: {}", error))?;
    }

    write_gateway_env_for_network(cardano_dir, clean, network, light_client_mode)?;
    match network {
        config::CoreCardanoNetwork::Local => ensure_gateway_databases(cardano_dir)?,
        config::CoreCardanoNetwork::Preprod | config::CoreCardanoNetwork::Preview => {
            let gateway_env = cardano_dir.join("../../cardano/gateway/.env");
            resolve_public_testnet_yaci_checkpoint(&gateway_env, network)?;
            validate_public_testnet_gateway_env(&gateway_env, network)?;
            ensure_gateway_databases(cardano_dir)?
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        cardano_runtime_state_paths, set_env_var_if_absent, validate_active_cardano_runtime_env,
        validate_external_http_endpoint, validate_override_network_marker,
        validate_public_testnet_network_values, CARDANO_RUNTIME_NETWORK_KEY,
    };
    use crate::config::CoreCardanoNetwork;
    use std::{
        collections::HashMap,
        fs,
        time::{SystemTime, UNIX_EPOCH},
    };

    fn network_values(marker: &str, chain_id: &str, magic: &str) -> HashMap<String, String> {
        HashMap::from([
            (CARDANO_RUNTIME_NETWORK_KEY.to_string(), marker.to_string()),
            ("CARDANO_CHAIN_ID".to_string(), chain_id.to_string()),
            ("CARDANO_NETWORK_MAGIC".to_string(), magic.to_string()),
        ])
    }

    #[test]
    fn matching_public_testnet_state_is_accepted() {
        validate_public_testnet_network_values(
            &network_values("preview", "cardano-preview", "2"),
            CoreCardanoNetwork::Preview,
        )
        .expect("matching Preview state should be accepted");
    }

    #[test]
    fn standalone_service_start_requires_the_active_network_identity() {
        let temp_dir = std::env::temp_dir().join(format!(
            "caribic-active-network-test-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&temp_dir).unwrap();
        let env_path = temp_dir.join("gateway.env");
        fs::write(
            &env_path,
            "CARDANO_RUNTIME_NETWORK=preprod\nCARDANO_CHAIN_ID=cardano-preprod\nCARDANO_NETWORK_MAGIC=1\n",
        )
        .unwrap();

        validate_active_cardano_runtime_env(&env_path, CoreCardanoNetwork::Preprod)
            .expect("matching active runtime should be accepted");
        let error = validate_active_cardano_runtime_env(&env_path, CoreCardanoNetwork::Preview)
            .expect_err("a standalone Preview service must reject active Preprod state");
        assert!(error.to_string().contains("belongs to preprod"));

        fs::remove_dir_all(temp_dir).unwrap();
    }

    #[test]
    fn public_process_overrides_are_bound_to_one_network() {
        validate_override_network_marker(true, Some("preview"), CoreCardanoNetwork::Preview)
            .expect("matching override marker should be accepted");
        assert!(validate_override_network_marker(true, None, CoreCardanoNetwork::Preview).is_err());
        let error =
            validate_override_network_marker(true, Some("preprod"), CoreCardanoNetwork::Preview)
                .expect_err("stale Preprod overrides must not be reused for Preview");
        assert!(error.to_string().contains("marked for preprod"));
    }

    #[test]
    fn stale_public_testnet_state_is_rejected() {
        let error = validate_public_testnet_network_values(
            &network_values("preprod", "cardano-preprod", "1"),
            CoreCardanoNetwork::Preview,
        )
        .expect_err("Preprod endpoint/checkpoint state must not be reused for Preview");

        assert!(error.to_string().contains("belongs to preprod"));
        assert!(error.to_string().contains("requested preview"));
    }

    #[test]
    fn conflicting_network_identifiers_are_rejected() {
        let error = validate_public_testnet_network_values(
            &network_values("preview", "cardano-preprod", "2"),
            CoreCardanoNetwork::Preview,
        )
        .expect_err("conflicting network identities must fail closed");

        assert!(error
            .to_string()
            .contains("conflicting network identifiers"));
    }

    #[test]
    fn unknown_chain_id_is_rejected_instead_of_ignored() {
        let error = validate_public_testnet_network_values(
            &network_values("preview", "cardano-something-else", "2"),
            CoreCardanoNetwork::Preview,
        )
        .expect_err("unknown chain identity must fail closed");

        assert!(error.to_string().contains("Unsupported CARDANO_CHAIN_ID"));
    }

    #[test]
    fn malformed_magic_is_rejected_instead_of_ignored() {
        let error = validate_public_testnet_network_values(
            &network_values("preview", "cardano-preview", "not-a-number"),
            CoreCardanoNetwork::Preview,
        )
        .expect_err("malformed network magic must fail closed");

        assert!(error
            .to_string()
            .contains("Unsupported CARDANO_NETWORK_MAGIC"));
    }

    #[test]
    fn two_magic_fields_cannot_disagree() {
        let mut values = network_values("preview", "cardano-preview", "2");
        values.insert("CARDANO_CHAIN_NETWORK_MAGIC".to_string(), "1".to_string());

        let error = validate_public_testnet_network_values(&values, CoreCardanoNetwork::Preview)
            .expect_err("conflicting network magic fields must fail closed");
        assert!(error
            .to_string()
            .contains("conflicting network identifiers"));
    }

    #[test]
    fn untouched_local_template_can_be_configured_for_a_public_testnet() {
        validate_public_testnet_network_values(
            &network_values("local", "cardano-devnet", "42"),
            CoreCardanoNetwork::Preprod,
        )
        .expect("a local template is valid input for first-time public-network setup");
    }

    #[test]
    fn public_testnet_runtime_state_paths_are_network_isolated() {
        let local = cardano_runtime_state_paths(CoreCardanoNetwork::Local);
        let preprod = cardano_runtime_state_paths(CoreCardanoNetwork::Preprod);
        let preview = cardano_runtime_state_paths(CoreCardanoNetwork::Preview);

        assert_eq!(local.gateway_postgres, std::path::Path::new("postgres"));
        assert_eq!(local.yaci_genesis, std::path::Path::new("yaci/genesis"));
        assert_eq!(local.yaci_data, std::path::Path::new("yaci/data"));
        assert_eq!(local.yaci_logs, std::path::Path::new("yaci/logs"));
        assert_ne!(preprod.gateway_postgres, preview.gateway_postgres);
        assert_ne!(preprod.yaci_genesis, preview.yaci_genesis);
        assert_ne!(preprod.yaci_data, preview.yaci_data);
        assert_ne!(preprod.yaci_logs, preview.yaci_logs);
        assert!(preprod.gateway_postgres.starts_with("preprod"));
        assert!(preview.gateway_postgres.starts_with("preview"));
    }

    #[test]
    fn public_testnet_epoch_lengths_match_their_genesis_files() {
        assert_eq!(CoreCardanoNetwork::Preprod.epoch_length(), 432_000);
        assert_eq!(CoreCardanoNetwork::Preview.epoch_length(), 86_400);
    }

    #[test]
    fn public_endpoint_defaults_do_not_replace_operator_configuration() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock should be after the Unix epoch")
            .as_nanos();
        let env_path = std::env::temp_dir().join(format!(
            "caribic-public-endpoint-{unique}-{}.env",
            std::process::id()
        ));
        fs::write(
            &env_path,
            "CARDANO_EPOCH_PARAMS_ENDPOINT=https://koios-proxy.example/api/v1\n",
        )
        .expect("temporary env should be writable");

        set_env_var_if_absent(
            &env_path,
            "CARDANO_EPOCH_PARAMS_ENDPOINT",
            "https://preview.koios.rest/api/v1",
        )
        .expect("set-if-absent should succeed");

        assert_eq!(
            fs::read_to_string(&env_path).expect("temporary env should be readable"),
            "CARDANO_EPOCH_PARAMS_ENDPOINT=https://koios-proxy.example/api/v1\n"
        );
        fs::remove_file(env_path).expect("temporary env should be removable");
    }

    #[test]
    fn public_endpoints_must_be_valid_external_urls() {
        assert!(validate_external_http_endpoint(
            "https://cardano-preview-v2.kupo-m1.dmtr.host",
            "Kupo"
        )
        .is_ok());
        assert!(validate_external_http_endpoint("not-a-url", "Kupo").is_err());
        assert!(validate_external_http_endpoint("ftp://example.com", "Kupo").is_err());
        let websocket_error = validate_external_http_endpoint("wss://example.com", "Ogmios")
            .expect_err("WebSocket URLs must not pass HTTP endpoint validation");
        assert!(websocket_error
            .to_string()
            .contains("Expected http or https"));
        assert!(validate_external_http_endpoint("http://localhost:1442", "Kupo").is_err());
    }
}
