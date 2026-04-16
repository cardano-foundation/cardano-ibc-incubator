use std::fs;
use std::path::Path;
use std::process::Command;
use std::time::Duration;

use fs_extra::copy_items;
use serde_json::Value;

use super::config;
use crate::chains::cosmos_node::resolve_home_relative_path;
use crate::logger::{log, warn};
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

    execute_script(
        injective_dir,
        "docker",
        Vec::from([
            "compose",
            "-f",
            "configuration/docker-compose.yml",
            "up",
            "-d",
            "injectived",
        ]),
        Some(vec![
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
        ]),
    )?;

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
    let _ = execute_script(
        injective_path,
        "docker",
        Vec::from([
            "compose",
            "-f",
            "configuration/docker-compose.yml",
            "stop",
            "injectived",
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
            "injectived",
        ]),
        None,
    );
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

pub(super) async fn start_testnet(
    injective_dir: &Path,
    snapshot_url_override: Option<&str>,
) -> Result<(), Box<dyn std::error::Error>> {
    let first_start_error =
        match start_testnet_container(injective_dir, snapshot_url_override).await {
            Ok(()) => return Ok(()),
            Err(error) => error.to_string(),
        };

    if !should_reset_corrupted_testnet_store(injective_dir) {
        return Err(first_start_error.into());
    }

    warn("Detected corrupted Injective testnet store; resetting local testnet home and retrying once.");
    stop_testnet(injective_dir);
    let testnet_home_dir = resolve_home_relative_path(config::TESTNET_HOME_DIR)?;
    if testnet_home_dir.exists() {
        fs::remove_dir_all(testnet_home_dir.as_path())?;
    }

    start_testnet_container(injective_dir, snapshot_url_override).await
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

async fn start_testnet_container(
    injective_dir: &Path,
    snapshot_url_override: Option<&str>,
) -> Result<(), Box<dyn std::error::Error>> {
    let mut environment = vec![
        ("INJECTIVE_TESTNET_IMAGE", config::TESTNET_DOCKER_IMAGE),
        ("INJECTIVE_TESTNET_CHAIN_ID", config::TESTNET_CHAIN_ID),
        ("INJECTIVE_TESTNET_MONIKER", config::TESTNET_MONIKER),
        ("INJECTIVE_TESTNET_GENESIS_URL", config::TESTNET_GENESIS_URL),
        ("INJECTIVE_TESTNET_BOOTSTRAP_MODE", "snapshot"),
        (
            "INJECTIVE_TESTNET_SNAPSHOT_PAGE_URL",
            config::TESTNET_SNAPSHOT_PAGE_URL,
        ),
        ("INJECTIVED_P2P_SEEDS", config::TESTNET_SEEDS),
        (
            "INJECTIVED_P2P_PERSISTENT_PEERS",
            config::TESTNET_PERSISTENT_PEERS,
        ),
    ];
    let snapshot_url = snapshot_url_override.unwrap_or(config::TESTNET_SNAPSHOT_URL);
    if !snapshot_url.trim().is_empty() {
        environment.push(("INJECTIVE_TESTNET_SNAPSHOT_URL", snapshot_url));
    }

    execute_script(
        injective_dir,
        "docker",
        Vec::from([
            "compose",
            "-f",
            "configuration/docker-compose.yml",
            "up",
            "-d",
            "injectived-testnet",
        ]),
        Some(environment),
    )?;

    let client = reqwest::Client::builder()
        .no_proxy()
        .timeout(Duration::from_secs(3))
        .build()?;

    let max_attempts = 1800;
    let mut last_reported_height = 0_u64;
    for attempt in 1..=max_attempts {
        if attempt == 1 || attempt % 10 == 0 {
            if let Some(fatal_reason) = testnet_fatal_bootstrap_reason(injective_dir) {
                stop_testnet(injective_dir);
                return Err(format!(
                    "Injective testnet bootstrap failed before readiness: {}\n{}",
                    fatal_reason,
                    testnet_container_log_tail(injective_dir)
                )
                .into());
            }
        }

        if !is_testnet_container_running(injective_dir) {
            return Err(format!(
                "Injective testnet container exited before health became ready.\n{}",
                testnet_container_log_tail(injective_dir)
            )
            .into());
        }

        let response = client.get(config::TESTNET_STATUS_URL).send().await;
        let (latest_height, catching_up) = match response {
            Ok(resp) if resp.status().is_success() => {
                let body = resp.text().await.unwrap_or_default();
                let json: Value = serde_json::from_str(body.as_str()).unwrap_or_default();
                let sync_info = &json["result"]["sync_info"];
                let latest_height = sync_info["latest_block_height"]
                    .as_str()
                    .and_then(|value| value.parse::<u64>().ok())
                    .or_else(|| sync_info["latest_block_height"].as_u64())
                    .unwrap_or(0);
                let catching_up = sync_info["catching_up"].as_bool().unwrap_or(false);
                (latest_height, catching_up)
            }
            _ => (0, false),
        };

        if latest_height > 0 {
            return Ok(());
        }

        if attempt == 1 || attempt % 12 == 0 {
            log(&format!(
                "Injective testnet bootstrap still waiting for first block (attempt {}/{}): latest block height={}, catching_up={}",
                attempt, max_attempts, latest_height, catching_up
            ));
        } else if latest_height > last_reported_height {
            log(&format!(
                "Injective testnet sync progress: latest block height={}",
                latest_height
            ));
            last_reported_height = latest_height;
        }

        tokio::time::sleep(Duration::from_millis(3000)).await;
    }

    stop_testnet(injective_dir);
    Err(format!(
        "Timed out while waiting for Injective testnet node at {}\n{}",
        config::TESTNET_STATUS_URL,
        testnet_container_log_tail(injective_dir)
    )
    .into())
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
        &vec![configuration_source, scripts_source],
        injective_dir,
        &fs_extra::dir::CopyOptions::new().overwrite(true),
    )?;

    log("PASS: Injective configuration files copied successfully");
    Ok(())
}

fn should_reset_corrupted_testnet_store(injective_dir: &Path) -> bool {
    let output = Command::new("docker")
        .current_dir(injective_dir)
        .args([
            "compose",
            "-f",
            "configuration/docker-compose.yml",
            "logs",
            "--tail",
            "200",
            "injectived-testnet",
        ])
        .output();

    let Ok(output) = output else {
        return false;
    };

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    let combined = format!("{}\n{}", stdout, stderr).to_ascii_lowercase();

    let corrupted_store = combined.contains("failed to load latest version")
        && combined.contains("version does not exist");
    let incompatible_bootstrap_state =
        combined.contains("panic: unknown field \"abstain\"") && combined.contains("tallyresult");
    let objstorage_missing_files = combined.contains("failed to initialize database")
        && combined.contains("unknown to the objstorage provider")
        && combined.contains("file does not exist");

    corrupted_store || incompatible_bootstrap_state || objstorage_missing_files
}

fn is_testnet_container_running(injective_dir: &Path) -> bool {
    let Some(container_id) = testnet_container_id(injective_dir) else {
        return false;
    };

    let output = Command::new("docker")
        .args([
            "inspect",
            "--format",
            "{{.State.Status}}",
            container_id.as_str(),
        ])
        .output();

    let Ok(output) = output else {
        return false;
    };
    if !output.status.success() {
        return false;
    }

    String::from_utf8_lossy(&output.stdout).trim() == "running"
}

fn testnet_container_id(injective_dir: &Path) -> Option<String> {
    let output = Command::new("docker")
        .current_dir(injective_dir)
        .args([
            "compose",
            "-f",
            "configuration/docker-compose.yml",
            "ps",
            "-q",
            "injectived-testnet",
        ])
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }

    let id = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if id.is_empty() {
        None
    } else {
        Some(id)
    }
}

fn testnet_container_log_tail(injective_dir: &Path) -> String {
    let output = Command::new("docker")
        .current_dir(injective_dir)
        .args([
            "compose",
            "-f",
            "configuration/docker-compose.yml",
            "logs",
            "--tail",
            "80",
            "injectived-testnet",
        ])
        .output();

    match output {
        Ok(output) if output.status.success() => {
            let stdout = String::from_utf8_lossy(&output.stdout);
            if stdout.trim().is_empty() {
                "Injective testnet container logs are empty".to_string()
            } else {
                stdout.to_string()
            }
        }
        Ok(output) => {
            let stderr = String::from_utf8_lossy(&output.stderr);
            format!(
                "Unable to read Injective testnet container logs:\n{}",
                stderr.trim()
            )
        }
        Err(error) => format!(
            "Unable to query Injective testnet container logs: {}",
            error
        ),
    }
}

fn testnet_fatal_bootstrap_reason(injective_dir: &Path) -> Option<String> {
    let output = Command::new("docker")
        .current_dir(injective_dir)
        .args([
            "compose",
            "-f",
            "configuration/docker-compose.yml",
            "logs",
            "--tail",
            "120",
            "injectived-testnet",
        ])
        .output()
        .ok()?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    let combined = format!("{}\n{}", stdout, stderr).to_ascii_lowercase();

    if combined.contains("failed to initialize database")
        && combined.contains("unknown to the objstorage provider")
    {
        return Some("snapshot store is inconsistent (objstorage files missing)".to_string());
    }

    if combined.contains("panic: unknown field \"abstain\"") && combined.contains("tallyresult") {
        return Some("incompatible legacy testnet home detected".to_string());
    }

    None
}
