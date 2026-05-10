use std::fs;
use std::path::Path;

use fs_extra::copy_items;
use serde_json::Value;

use super::config;
use crate::chains::cosmos_node::resolve_home_relative_path;
use crate::logger::log;
use crate::process::docker::DockerCli;
use crate::utils::{execute_script, wait_for_health_check};

pub(super) async fn prepare_local(
    project_root_path: &Path,
    injective_dir: &Path,
    stateful: bool,
) -> Result<(), Box<dyn std::error::Error>> {
    sync_workspace_assets_from_repo(project_root_path, injective_dir)?;

    if !stateful {
        stop_local(injective_dir);

        let local_home_dir = resolve_home_relative_path(config::LOCAL_HOME_DIR)?;
        if local_home_dir.exists() {
            fs::remove_dir_all(local_home_dir.as_path())?;
        }
    }

    Ok(())
}

pub(super) async fn start_local(
    project_root_path: &Path,
    injective_dir: &Path,
) -> Result<(), Box<dyn std::error::Error>> {
    let local_validator_mnemonic =
        config::load_demo_mnemonic(project_root_path, config::LOCAL_VALIDATOR_MNEMONIC_ACCOUNT)?;

    DockerCli::new(injective_dir)
        .with_envs(&[
            ("INJECTIVE_LOCAL_IMAGE", config::LOCAL_DOCKER_IMAGE),
            ("INJECTIVE_LOCAL_CHAIN_ID", config::LOCAL_CHAIN_ID),
            ("INJECTIVE_LOCAL_MONIKER", config::LOCAL_MONIKER),
            ("INJECTIVE_LOCAL_VALIDATOR_KEY", config::LOCAL_VALIDATOR_KEY),
            (
                "INJECTIVE_LOCAL_VALIDATOR_MNEMONIC",
                local_validator_mnemonic.as_str(),
            ),
            (
                "INJECTIVE_LOCAL_GENESIS_ACCOUNT_AMOUNT",
                config::LOCAL_GENESIS_ACCOUNT_AMOUNT,
            ),
            ("INJECTIVE_LOCAL_GENTX_AMOUNT", config::LOCAL_GENTX_AMOUNT),
        ])
        .compose_ok(&[
            "-f",
            "configuration/docker-compose.yml",
            "up",
            "-d",
            "injectived",
        ])?;

    let is_healthy = wait_for_health_check(
        config::LOCAL_STATUS_URL,
        120,
        3000,
        Some(|response_body: &String| {
            let json: Value = serde_json::from_str(response_body).unwrap_or_default();
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

    stop_local(injective_dir);
    Err(format!(
        "Timed out while waiting for local Injective node at {}",
        config::LOCAL_STATUS_URL
    )
    .into())
}

pub(super) fn stop_local(injective_path: &Path) {
    let docker = DockerCli::new(injective_path);
    let _ = docker.compose_ok(&[
        "-f",
        "configuration/docker-compose.yml",
        "stop",
        "injectived",
    ]);
    let _ = docker.compose_ok(&[
        "-f",
        "configuration/docker-compose.yml",
        "rm",
        "-f",
        "injectived",
    ]);
}

pub(super) async fn prepare_testnet(
    project_root_path: &Path,
    injective_dir: &Path,
    stateful: bool,
) -> Result<(), Box<dyn std::error::Error>> {
    sync_workspace_assets_from_repo(project_root_path, injective_dir)?;

    if !stateful {
        stop_testnet(injective_dir);

        let testnet_home_dir = resolve_home_relative_path(config::TESTNET_HOME_DIR)?;
        if testnet_home_dir.exists() {
            fs::remove_dir_all(testnet_home_dir.as_path())?;
        }
    }

    Ok(())
}

pub(super) fn stop_testnet(injective_path: &Path) {
    let _ = execute_script(
        injective_path,
        "docker",
        Vec::from([
            "compose",
            "-f",
            "configuration/docker-compose.yml",
            "stop",
            "injectived-testnet",
        ]),
        None,
    );
    let _ = execute_script(
        injective_path,
        "docker",
        Vec::from([
            "compose",
            "-f",
            "configuration/docker-compose.yml",
            "rm",
            "-f",
            "injectived-testnet",
        ]),
        None,
    );
}

fn sync_workspace_assets_from_repo(
    project_root_path: &Path,
    injective_dir: &Path,
) -> Result<(), Box<dyn std::error::Error>> {
    let source_root = project_root_path.join("chains").join("injective");
    let configuration_source = source_root.join("configuration");
    let scripts_source = source_root.join("scripts");

    if !configuration_source.exists() || !scripts_source.exists() {
        return Err(format!(
            "Missing Injective asset templates under {}. Expected {}/configuration and {}/scripts",
            source_root.display(),
            source_root.display(),
            source_root.display()
        )
        .into());
    }

    fs::create_dir_all(injective_dir)?;

    copy_items(
        &[configuration_source, scripts_source],
        injective_dir,
        &fs_extra::dir::CopyOptions::new().overwrite(true),
    )?;

    log("PASS: Injective configuration files copied successfully");
    Ok(())
}
