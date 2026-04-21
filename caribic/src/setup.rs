use crate::config;
use crate::logger::{log, log_or_show_progress, verbose};
use crate::utils::{
    change_dir_permissions_read_only, delete_file, download_file, replace_text_in_file, unzip_file,
    IndicatorMessage,
};
use chrono::{SecondsFormat, Utc};
use console::style;
use fs_extra::{copy_items, file::copy};
use indicatif::ProgressBar;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::process::Output;
use std::thread;
use std::time::Duration;
use std::{fs, path::Path, process::Command};

const CARDANO_RUNTIME_NETWORK_MARKER: &str = ".caribic-network";
const LOCAL_CARDANO_NODE_IMAGE: &str = "ghcr.io/blinklabs-io/cardano-node:10.1.4-3";
const LOCAL_STABILITY_SPO_COUNT: usize = 3;
const LOCAL_STABILITY_TARGET_POOL_STAKE_LOVELACE: u64 = 900_000_000_000;
const LOCAL_STABILITY_THRESHOLD_DEPTH: &str = "10";
const LOCAL_STABILITY_THRESHOLD_UNIQUE_POOLS: &str = "2";
const LOCAL_STABILITY_THRESHOLD_UNIQUE_STAKE_BPS: &str = "6000";
const PREPROD_ENVIRONMENT_BASE_URL: &str =
    "https://book.world.dev.cardano.org/environments/preprod";

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

    if (base_path.is_none() || !base_path.unwrap().exists()) && base_path.is_some() {
        fs::create_dir_all(base_path.unwrap()).map_err(|error| {
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

pub async fn download_mithril(mithril_path: &Path) -> Result<(), Box<dyn std::error::Error>> {
    let url = "https://github.com/input-output-hk/mithril/archive/refs/tags/2437.1.zip";
    download_repository(url, mithril_path, "mithril").await
}

pub fn copy_cardano_env_file(cardano_dir: &Path) -> Result<(), Box<dyn std::error::Error>> {
    let source = cardano_dir.join(".env.example");
    let destination = cardano_dir.join(".env");

    Command::new("cp")
        .arg(source)
        .arg(destination)
        .status()
        .map_err(|error| format!("Failed to copy template Cardano .env file: {}", error))?;
    Ok(())
}

fn process_env_value(keys: &[&str]) -> Option<String> {
    keys.iter()
        .find_map(|key| std::env::var(key).ok())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

pub fn resolve_preprod_history_relay(
    gateway_env: &Path,
) -> Result<(String, String), Box<dyn std::error::Error>> {
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
                "Missing preprod raw Cardano relay host. Set CARDANO_CHAIN_HOST in {} or export CARIBIC_CARDANO_CHAIN_HOST.",
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
                "Missing preprod raw Cardano relay port. Set CARDANO_CHAIN_PORT in {} or export CARIBIC_CARDANO_CHAIN_PORT.",
                gateway_env.display()
            )
        })?;

    if host == "cardano-node" {
        return Err(
            "Preprod Yaci history cannot use CARDANO_CHAIN_HOST=cardano-node; set it to a raw preprod Cardano relay host."
                .into(),
        );
    }

    Ok((host, port))
}

pub fn write_cardano_runtime_selection(
    cardano_dir: &Path,
    network: config::CoreCardanoNetwork,
    local_spo_count: usize,
) -> Result<(), Box<dyn std::error::Error>> {
    let runtime_dir = network.runtime_dir();
    let network_magic = config::cardano_network_profile(network).network_magic;
    let (config_file, block_producer, node_image, socket_path) = match network {
        config::CoreCardanoNetwork::Local => (
            "cardano-node.json",
            "true",
            LOCAL_CARDANO_NODE_IMAGE,
            "/runtime/node.socket",
        ),
        config::CoreCardanoNetwork::Preprod => (
            "config.json",
            "false",
            "ghcr.io/intersectmbo/cardano-node:10.6.2",
            "/tmp/node.socket",
        ),
    };
    let (chain_host, chain_port) = match network {
        config::CoreCardanoNetwork::Local => ("cardano-node".to_string(), "3001".to_string()),
        config::CoreCardanoNetwork::Preprod => {
            let gateway_env = cardano_dir.join("../../cardano/gateway/.env");
            resolve_preprod_history_relay(gateway_env.as_path())?
        }
    };

    let env_contents = format!(
        "CARDANO_RUNTIME_NETWORK={network}\nCARDANO_RUNTIME_DIR={runtime_dir}\nCARDANO_NODE_CONFIG_FILE={config_file}\nCARDANO_TOPOLOGY_FILE=topology.json\nCARDANO_BLOCK_PRODUCER={block_producer}\nCARDANO_NODE_IMAGE={node_image}\nCARDANO_SOCKET_PATH={socket_path}\nCARDANO_NODE_SOCKET_PATH={socket_path}\nCARDANO_CHAIN_HOST={chain_host}\nCARDANO_CHAIN_PORT={chain_port}\nCARDANO_CHAIN_NETWORK_MAGIC={network_magic}\nCARDANO_LOCAL_SPO_COUNT={local_spo_count}\n",
        network = network.as_str(),
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

async fn download_preprod_runtime_file(
    target_dir: &Path,
    remote_name: &str,
    local_name: &str,
) -> Result<(), Box<dyn std::error::Error>> {
    let destination = target_dir.join(local_name);
    if destination.exists() {
        return Ok(());
    }

    let url = format!("{PREPROD_ENVIRONMENT_BASE_URL}/{remote_name}");
    download_file(
        &url,
        destination.as_path(),
        Some(IndicatorMessage {
            message: format!("Downloading Cardano preprod {}", remote_name),
            step: "Bootstrap".to_string(),
            emoji: "".to_string(),
        }),
    )
    .await
    .map_err(|error| {
        format!(
            "Failed to download Cardano preprod runtime file '{}' from {}: {}",
            remote_name, url, error
        )
    })?;

    Ok(())
}

pub async fn configure_cardano_preprod_runtime(
    cardano_dir: &Path,
    reset_state: bool,
) -> Result<(), Box<dyn std::error::Error>> {
    let runtime_dir = cardano_dir.join("preprod");
    let service_folders = vec![
        runtime_dir.clone(),
        cardano_dir.join("kupo-db"),
        cardano_dir.join("postgres"),
        cardano_dir.join("yaci/genesis"),
        cardano_dir.join("yaci/data"),
        cardano_dir.join("yaci/logs"),
    ];

    if reset_state {
        for service_folder in &service_folders {
            if service_folder.exists() && service_folder.is_dir() {
                fs::remove_dir_all(service_folder).map_err(|error| {
                    format!(
                        "Failed to reset Cardano preprod service folder {}: {}",
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
                "Failed to create Cardano preprod service folder {}: {}",
                service_folder.display(),
                error
            )
        })?;
    }

    // The preprod node socket lives on the bind-mounted runtime directory. If the
    // previous run left a stale Unix socket behind, the container cannot reliably
    // remove it during startup on this mount, so clear it on the host first.
    for stale_socket_path in [
        runtime_dir.join("node.socket"),
        runtime_dir.join("node.socket.lock"),
    ] {
        if stale_socket_path.exists() {
            fs::remove_file(&stale_socket_path).map_err(|error| {
                format!(
                    "Failed to remove stale Cardano preprod socket artifact {}: {}",
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
        download_preprod_runtime_file(&runtime_dir, remote_name, local_name).await?;
    }

    write_yaci_preprod_genesis_files(cardano_dir, &runtime_dir)?;

    Ok(())
}

fn write_yaci_preprod_genesis_files(
    cardano_dir: &Path,
    runtime_dir: &Path,
) -> Result<(), Box<dyn std::error::Error>> {
    let yaci_genesis_dir = cardano_dir.join("yaci/genesis");
    fs::create_dir_all(&yaci_genesis_dir).map_err(|error| {
        format!(
            "Failed to create Yaci preprod genesis directory {}: {}",
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
                "Failed to copy {} into Yaci preprod genesis dir: {}",
                source_name, error
            )
        })?;
    }

    let shelley_path = yaci_genesis_dir.join("genesis-shelley.json");
    let mut shelley_json: Value =
        serde_json::from_str(&fs::read_to_string(&shelley_path).map_err(|error| {
            format!(
                "Failed to read Yaci preprod Shelley genesis file {}: {}",
                shelley_path.display(),
                error
            )
        })?)
        .map_err(|error| {
            format!(
                "Failed to parse Yaci preprod Shelley genesis file {}: {}",
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
                "Failed to serialize Yaci preprod Shelley genesis file {}: {}",
                shelley_path.display(),
                error
            )
        })?,
    )
    .map_err(|error| {
        format!(
            "Failed to write Yaci preprod Shelley genesis file {}: {}",
            shelley_path.display(),
            error
        )
    })?;

    Ok(())
}

fn set_or_append_env_var(
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
    let output = Command::new("docker")
        .args(["volume", "rm", "-f", "cardano_yaci_store_postgres_data"])
        .output()
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

fn local_spo_ipv4(index: usize) -> &'static str {
    match index {
        1 => "172.29.0.11",
        2 => "172.29.0.12",
        3 => "172.29.0.13",
        _ => "172.29.0.254",
    }
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

fn build_local_spo_topology(index: usize, total_spo_count: usize) -> Value {
    let producers: Vec<Value> = (1..=total_spo_count)
        .filter(|candidate| *candidate != index)
        .map(|candidate| {
            json!({
                "addr": local_spo_ipv4(candidate),
                "port": local_spo_port(candidate),
                "valency": 1,
            })
        })
        .collect();

    json!({
        "Producers": producers
    })
}

fn write_local_multi_spo_topology_files(
    devnet_dir: &Path,
    total_spo_count: usize,
) -> Result<(), Box<dyn std::error::Error>> {
    for index in 1..=total_spo_count {
        let topology_path = devnet_dir.join(local_spo_topology_filename(index));
        fs::write(
            &topology_path,
            serde_json::to_string_pretty(&build_local_spo_topology(index, total_spo_count))
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

    let output = Command::new("docker")
        .args(["run", "--rm", "-v"])
        .arg(mount_arg)
        .arg(LOCAL_CARDANO_NODE_IMAGE)
        .args([
            "cli",
            "latest",
            "genesis",
            "create-testnet-data",
            "--out-dir",
            "/out",
            "--pools",
        ])
        .arg(pools_arg.as_str())
        .args(["--stake-delegators"])
        .arg(pools_arg.as_str())
        .args(["--testnet-magic", "42", "--total-supply"])
        .arg(delegated_supply_arg.as_str())
        .args(["--delegated-supply"])
        .arg(delegated_supply_arg.as_str())
        .output()
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
            let destination = devnet_dir.join(source.file_name().unwrap());
            copy(source, destination, &options)
                .map_err(|error| format!("Failed to copy Cardano configuration file: {}", error))?;
        }
    }

    let genesis_byron_path = devnet_dir.join("genesis-byron.json");
    let genesis_shelley_path = devnet_dir.join("genesis-shelley.json");

    let start_time = Utc::now();

    replace_text_in_file(
        &genesis_byron_path,
        r#""startTime": \d*"#,
        &format!(r#""startTime": {}"#, start_time.timestamp()),
    )?;

    replace_text_in_file(
        &genesis_shelley_path,
        r#""systemStart": ".*""#,
        &format!(
            r#""systemStart": "{}""#,
            start_time.to_rfc3339_opts(SecondsFormat::Secs, true)
        ),
    )?;

    if local_spo_count > 1 {
        replace_text_in_file(
            &devnet_dir.join("cardano-node.json"),
            r#""EnableP2P": true"#,
            r#""EnableP2P": false"#,
        )?;
    }

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

    for bootstrap_address in bootstrap_addresses {
        log_or_show_progress(
            &format!(
                "Sending {} ADA to {}",
                style(bootstrap_address.amount).bold().dim(),
                style(&bootstrap_address.address).bold().dim()
            ),
            optional_progress_bar,
        );
        let cardano_cli_args = vec!["compose", "exec", "cardano-node", "cardano-cli"];
        let build_address_args = vec![
            "address",
            "build",
            "--payment-verification-key-file",
            "/runtime/credentials/faucet.vk",
            "--testnet-magic",
            "42",
        ];
        let address_output = Command::new("docker")
            .current_dir(cardano_dir)
            .args(&cardano_cli_args)
            .args(build_address_args)
            .output()
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

        let mut faucet_txin_output: Option<Output> = None;
        for i in 1..5 {
            faucet_txin_output = Some(
                Command::new("docker")
                    .current_dir(cardano_dir)
                    .args(&cardano_cli_args)
                    .args(&faucet_txin_args)
                    .output()
                    .map_err(|error| format!("Failed to get faucet txin: {}", error))?,
            );

            if faucet_txin_output.as_ref().unwrap().status.success() {
                break;
            } else {
                if i < 5 {
                    verbose(
                        "The cardano-node isn't ready yet. Retrying to get faucet txin in 5 sec...",
                    );
                    thread::sleep(Duration::from_secs(5));
                }
                faucet_txin_output = None;
            }
        }

        match faucet_txin_output {
            Some(output) => {
                if output.status.success() {
                    let output_str = String::from_utf8_lossy(&output.stdout);
                    let parsed_json: Value = serde_json::from_str(&output_str)
                        .map_err(|error| format!("Failed to parse faucet UTxO JSON: {}", error))?;
                    let faucet_txin = parsed_json
                        .as_object()
                        .and_then(|obj| obj.keys().next())
                        .ok_or("Failed to extract faucet txin from query result")?;

                    let wallet_address = &bootstrap_address.address;
                    let tx_out = &format!("{}+{}", wallet_address, bootstrap_address.amount);
                    let draft_tx_file = &format!("/runtime/seed-{}.draft", wallet_address.as_str());
                    let signed_tx_file =
                        &format!("/runtime/seed-{}.signed", wallet_address.as_str());

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

                    let build_tx_output = Command::new("docker")
                        .current_dir(cardano_dir)
                        .args(&cardano_cli_args)
                        .args(build_tx_args)
                        .output()
                        .map_err(|error| format!("Failed to build seed transaction: {}", error))?;
                    if !build_tx_output.status.success() {
                        return Err(format!(
                            "Failed to build seed transaction for {}: {}",
                            wallet_address,
                            String::from_utf8_lossy(&build_tx_output.stderr)
                        )
                        .into());
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

                    let sign_tx_output = Command::new("docker")
                        .current_dir(cardano_dir)
                        .args(&cardano_cli_args)
                        .args(sign_tx_args)
                        .output()
                        .map_err(|error| format!("Failed to sign seed transaction: {}", error))?;
                    if !sign_tx_output.status.success() {
                        return Err(format!(
                            "Failed to sign seed transaction for {}: {}",
                            wallet_address,
                            String::from_utf8_lossy(&sign_tx_output.stderr)
                        )
                        .into());
                    }

                    let tx_id_output = Command::new("docker")
                        .current_dir(cardano_dir)
                        .args(&cardano_cli_args)
                        .args(["conway", "transaction", "txid", "--tx-file", signed_tx_file])
                        .output()
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

                    let tx_in = &format!("{}#0", tx_id);
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
                        tx_in,
                        "--output-json",
                        "--testnet-magic",
                        "42",
                    ];
                    log_or_show_progress(
                        &format!(
                            "Waiting for transaction {} to settle",
                            style(tx_in).bold().dim()
                        ),
                        optional_progress_bar,
                    );

                    // With multiple active SPOs, a just-submitted seed transaction can land in a
                    // block that later loses a same-slot fork race. Keep resubmitting until the
                    // output is visible on the canonical chain.
                    let mut is_on_chain = false;
                    let mut last_submit_error: Option<String> = None;
                    for submit_attempt in 1..=6 {
                        let submit_tx_output = Command::new("docker")
                            .current_dir(cardano_dir)
                            .args(&cardano_cli_args)
                            .args(&submit_tx_args)
                            .output()
                            .map_err(|error| {
                                format!("Failed to submit seed transaction: {}", error)
                            })?;

                        if !submit_tx_output.status.success() {
                            let stderr = String::from_utf8_lossy(&submit_tx_output.stderr)
                                .trim()
                                .to_string();
                            verbose(&format!(
                                "Seed transaction submit attempt {}/6 for {} returned: {}",
                                submit_attempt, wallet_address, stderr
                            ));
                            last_submit_error = Some(stderr);
                        } else {
                            last_submit_error = None;
                        }

                        for poll_attempt in 1..=4 {
                            let utxo_output = Command::new("docker")
                                .current_dir(cardano_dir)
                                .args(&cardano_cli_args)
                                .args(&query_utxo_args)
                                .output()
                                .map_err(|error| {
                                    format!("Failed to query settlement UTxO: {}", error)
                                })?;

                            if utxo_output.status.success() {
                                let utxo_str =
                                    String::from_utf8(utxo_output.stdout).map_err(|error| {
                                        format!(
                                            "Failed to decode settlement UTxO response: {}",
                                            error
                                        )
                                    })?;
                                let parsed_utxo: Value =
                                    serde_json::from_str(&utxo_str).map_err(|error| {
                                        format!(
                                            "Failed to parse settlement UTxO response: {}",
                                            error
                                        )
                                    })?;

                                if parsed_utxo.get(tx_in).is_some_and(|value| value != "null") {
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
                            "Seed transaction {} was not visible on the canonical chain after submit attempt {}/6; retrying",
                            tx_in, submit_attempt
                        ));
                    }

                    if !is_on_chain {
                        let submit_error = last_submit_error
                            .map(|error| format!(" Last submit error: {}", error))
                            .unwrap_or_default();
                        return Err(format!(
                            "Seed transaction {} for {} did not settle on the canonical chain after multiple attempts.{}",
                            tx_in, wallet_address, submit_error
                        )
                        .into());
                    }
                }
            }
            None => {
                return Err(
                    "It seems the cardano-node has an issue. Please check the logs in your docker container logs if there is any issue."
                        .into(),
                );
            }
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

    let genesis_hash = Command::new("docker")
        .current_dir(cardano_dir)
        .args(["compose", "exec", "cardano-node", "cardano-cli"])
        .args(cli_args)
        .output()
        .map_err(|error| format!("Failed to get genesis hash: {}", error))?
        .stdout;

    let hash = String::from_utf8(genesis_hash)
        .map_err(|error| format!("Failed to get {} genesis hash: {}", era, error))?;
    Ok(hash)
}

fn query_epoch_nonce(
    cardano_dir: &Path,
    network_magic: u64,
) -> Result<String, Box<dyn std::error::Error>> {
    let epoch_nonce = Command::new("docker")
        .current_dir(cardano_dir)
        .args(["compose", "exec", "cardano-node", "cardano-cli"])
        .args([
            "query",
            "protocol-state",
            "--testnet-magic",
            &network_magic.to_string(),
        ])
        .output()
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

fn validate_preprod_gateway_env(gateway_env: &Path) -> Result<(), Box<dyn std::error::Error>> {
    let env_values = parse_env_file(gateway_env)?;
    let required_groups = [
        ("KUPO_ENDPOINT", vec!["KUPO_ENDPOINT"]),
        ("OGMIOS_ENDPOINT", vec!["OGMIOS_ENDPOINT"]),
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
        // Preprod is a hybrid mode: caribic manages the local history followers,
        // but live chain access still comes from external Kupo/Ogmios endpoints.
        return Err(format!(
            "Preprod startup uses managed local history services but still requires external live Cardano endpoints. cardano/gateway/.env is missing: {}.\nSet those keys to host-reachable preprod infrastructure before starting.",
            missing.join(", ")
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
            "Preprod startup still points {} at local docker-only defaults.\nReplace those values with host-reachable preprod endpoints before starting.",
            still_local.join(", ")
        )
        .into());
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
    if ogmios.trim() == "http://cardano-node-ogmios:1337" || kupo.trim() == "http://kupo:1442" {
        return Err(
            "External Cardano deploy endpoints still point at local docker-only defaults. Set CARIBIC_OGMIOS_URL/CARIBIC_KUPO_URL, or replace OGMIOS_ENDPOINT/KUPO_ENDPOINT in cardano/gateway/.env with host-reachable external endpoints."
                .into(),
        );
    }

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
    let cardano_source_dir = cardano_dir.join("../../cardano");
    let gateway_dir = cardano_source_dir.join("gateway");
    let gateway_env = gateway_dir.join(".env");

    if clean || !gateway_env.exists() {
        let options = fs_extra::file::CopyOptions::new().overwrite(true);
        copy(gateway_dir.join(".env.example"), &gateway_env, &options)?;
    }

    let shared_gateway_network_defaults = [
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
                    "CARDANO_STABILITY_THRESHOLD_DEPTH",
                    LOCAL_STABILITY_THRESHOLD_DEPTH,
                ),
                (
                    "CARDANO_STABILITY_THRESHOLD_UNIQUE_POOLS",
                    LOCAL_STABILITY_THRESHOLD_UNIQUE_POOLS,
                ),
                (
                    "CARDANO_STABILITY_THRESHOLD_UNIQUE_STAKE_BPS",
                    LOCAL_STABILITY_THRESHOLD_UNIQUE_STAKE_BPS,
                ),
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
        config::CoreCardanoNetwork::Preprod => {
            let preprod_gateway_defaults = [
                ("HISTORY_DB_HOST", "yaci-store-postgres"),
                ("HISTORY_DB_PORT", "5432"),
                ("HISTORY_DB_NAME", "yaci_store"),
                ("HISTORY_DB_USERNAME", "yaci"),
                ("HISTORY_DB_PASSWORD", "dbpass"),
                ("GATEWAY_DB_HOST", "postgres"),
                ("GATEWAY_DB_PORT", "5432"),
            ];
            for (key, value) in preprod_gateway_defaults {
                set_or_append_env_var(&gateway_env, key, value)?;
            }

            let (relay_host, relay_port) = resolve_preprod_history_relay(&gateway_env)?;
            set_or_append_env_var(&gateway_env, "CARDANO_CHAIN_HOST", relay_host.as_str())?;
            set_or_append_env_var(&gateway_env, "CARDANO_CHAIN_PORT", relay_port.as_str())?;

            if let Some(kupo_endpoint) = resolve_preprod_live_endpoint(
                &gateway_env,
                "KUPO_ENDPOINT",
                &["CARIBIC_KUPO_URL", "KUPO_URL"],
            )? {
                set_or_append_env_var(&gateway_env, "KUPO_ENDPOINT", kupo_endpoint.as_str())?;
            }
            if let Some(kupo_api_key) = resolve_preprod_live_endpoint(
                &gateway_env,
                "KUPO_API_KEY",
                &["CARIBIC_KUPO_API_KEY", "KUPO_API_KEY"],
            )? {
                set_or_append_env_var(&gateway_env, "KUPO_API_KEY", kupo_api_key.as_str())?;
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

            set_or_append_env_var(&gateway_env, "CARDANO_EPOCH_NONCE_GENESIS", "\"\"")?;
        }
    }

    let manifest_container_path = profile
        .bridge_manifest_path
        .as_deref()
        .filter(|path| Path::new(path).exists())
        .and_then(|path| {
            Path::new(path)
                .file_name()
                .and_then(|name| name.to_str())
                .map(|file_name| format!("/usr/src/app/cardano/offchain/deployments/{file_name}"))
        });
    let handler_container_path = Path::new(profile.handler_json_path.as_str())
        .file_name()
        .and_then(|name| name.to_str())
        .map(|file_name| format!("/usr/src/app/cardano/offchain/deployments/{file_name}"))
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

    Ok(())
}

fn ensure_gateway_databases(cardano_dir: &Path) -> Result<(), Box<dyn std::error::Error>> {
    let wait_for_postgres = |service_name: &str,
                             username: &str,
                             label: &str|
     -> Result<(), Box<dyn std::error::Error>> {
        let mut ready = false;
        for attempt in 1..=30 {
            let health_check = Command::new("docker")
                .current_dir(cardano_dir)
                .args([
                    "compose",
                    "exec",
                    "-T",
                    service_name,
                    "pg_isready",
                    "-U",
                    username,
                ])
                .output();

            if health_check.is_ok() && health_check.unwrap().status.success() {
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
        let db_check = Command::new("docker")
            .current_dir(cardano_dir)
            .args([
                "compose",
                "exec",
                "-T",
                service_name,
                "psql",
                "-U",
                database_user,
                "-d",
                admin_database,
                "-tc",
                &format!(
                    "SELECT 1 FROM pg_database WHERE datname = '{}'",
                    database_name
                ),
            ])
            .output();

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
        let create_result = Command::new("docker")
            .current_dir(cardano_dir)
            .args([
                "compose",
                "exec",
                "-T",
                service_name,
                "psql",
                "-U",
                database_user,
                "-d",
                admin_database,
                "-c",
                &format!("CREATE DATABASE {}", database_name),
            ])
            .output()
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

        let pool_params = Command::new("docker")
            .current_dir(cardano_dir)
            .args(["compose", "exec", "cardano-node", "cardano-cli"])
            .args(["query", "ledger-state", "--testnet-magic", "42"])
            .output()
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
        config::CoreCardanoNetwork::Preprod => {
            validate_preprod_gateway_env(&cardano_dir.join("../../cardano/gateway/.env"))?;
            ensure_gateway_databases(cardano_dir)?
        }
    }

    Ok(())
}
