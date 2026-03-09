use std::fs;
use std::path::Path;

use fs_extra::copy_items;
use serde_json::Value;

use super::config;
use crate::logger::{log, verbose, warn};
use crate::utils::{execute_script, wait_for_health_check};

pub(super) async fn prepare_local(
    project_root_path: &Path,
    cheqd_dir: &Path,
    stateful: bool,
) -> Result<(), Box<dyn std::error::Error>> {
    sync_workspace_assets_from_repo(project_root_path, cheqd_dir)?;

    if !stateful {
        stop_local(cheqd_dir);
        // Stateless runs intentionally rebuild the validator home from the pinned mnemonics so
        // repeated `caribic start cheqd` calls produce the same local chain identity every time.
        let network_config_dir = cheqd_dir.join("configuration/network-config");
        if network_config_dir.exists() {
            fs::remove_dir_all(network_config_dir.as_path())?;
        }
    }

    if !cheqd_dir.join("configuration/network-config/validator-0/config/genesis.json").exists() {
        generate_local_network_config(project_root_path, cheqd_dir)?;
    }

    Ok(())
}

pub(super) async fn start_local(
    cheqd_dir: &Path,
) -> Result<(), Box<dyn std::error::Error>> {
    execute_script(
        cheqd_dir,
        "docker",
        Vec::from([
            "compose",
            "-f",
            "configuration/docker-compose.yml",
            "up",
            "-d",
        ]),
        Some(vec![("CHEQD_LOCAL_IMAGE", config::LOCAL_DOCKER_IMAGE)]),
    )?;

    let is_healthy = wait_for_health_check(
        config::LOCAL_STATUS_URL,
        120,
        3000,
        Some(|response_body: &String| {
            let json: Value = serde_json::from_str(response_body).unwrap_or_default();
            // RPC reachability alone is not enough here; we wait for height > 0 so the single
            // validator is actually producing blocks before the adapter reports success.
            json["result"]["sync_info"]["latest_block_height"]
                .as_str()
                .and_then(|height| height.parse::<u64>().ok())
                .is_some_and(|height| height > 0)
        }),
    )
    .await;

    if is_healthy.is_ok() {
        return Ok(());
    }

    stop_local(cheqd_dir);
    Err(format!(
        "Timed out while waiting for local cheqd node at {}",
        config::LOCAL_STATUS_URL
    )
    .into())
}

pub(super) fn stop_local(cheqd_dir: &Path) {
    let _ = execute_script(
        cheqd_dir,
        "docker",
        Vec::from(["compose", "-f", "configuration/docker-compose.yml", "down"]),
        None,
    );
}

fn sync_workspace_assets_from_repo(
    project_root_path: &Path,
    cheqd_dir: &Path,
) -> Result<(), Box<dyn std::error::Error>> {
    let source_root = project_root_path.join("chains").join("cheqd");
    let configuration_source = source_root.join("configuration");
    let scripts_source = source_root.join("scripts");

    if !configuration_source.exists() || !scripts_source.exists() {
        return Err(format!(
            "Missing cheqd asset templates under {}. Expected {}/configuration and {}/scripts",
            source_root.display(),
            source_root.display(),
            source_root.display()
        )
        .into());
    }

    fs::create_dir_all(cheqd_dir)?;
    copy_items(
        &vec![configuration_source, scripts_source],
        cheqd_dir,
        &fs_extra::dir::CopyOptions::new().overwrite(true),
    )?;

    verbose("PASS: cheqd configuration files copied successfully");
    Ok(())
}

fn generate_local_network_config(
    project_root_path: &Path,
    cheqd_dir: &Path,
) -> Result<(), Box<dyn std::error::Error>> {
    log("Generating local cheqd network configuration ...");

    let validator_mnemonic = config::load_demo_mnemonic(
        project_root_path,
        config::LOCAL_VALIDATOR_MNEMONIC_ACCOUNT,
    )?;
    let relayer_mnemonic =
        config::load_demo_mnemonic(project_root_path, config::LOCAL_RELAYER_MNEMONIC_ACCOUNT)?;

    execute_script(
        cheqd_dir,
        "bash",
        Vec::from(["scripts/generate_local_network.sh"]),
        Some(vec![
            ("CHEQD_LOCAL_IMAGE", config::LOCAL_DOCKER_IMAGE),
            ("CHEQD_LOCAL_CHAIN_ID", config::LOCAL_CHAIN_ID),
            ("CHEQD_LOCAL_MONIKER", config::LOCAL_MONIKER),
            (
                "CHEQD_LOCAL_VALIDATOR_MNEMONIC",
                validator_mnemonic.as_str(),
            ),
            ("CHEQD_LOCAL_RELAYER_MNEMONIC", relayer_mnemonic.as_str()),
        ]),
    )?;

    // Compose starts the official cheqd image directly against the generated node home, so
    // generation must complete successfully before we try to boot the chain.
    if !cheqd_dir
        .join("configuration/network-config/validator-0/config/genesis.json")
        .exists()
    {
        warn("Local cheqd network generation finished without a genesis.json; start will fail.");
    }

    Ok(())
}
