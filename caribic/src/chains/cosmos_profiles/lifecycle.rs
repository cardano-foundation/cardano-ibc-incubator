use std::fs;
use std::path::Path;

use serde_json::Value;

use super::config::CosmosProfileConfig;
use crate::process::docker::DockerCli;
use crate::utils::wait_for_health_check;

const COMPOSE_FILE: &str = "docker-compose.yml";
const STATE_CLEANUP_IMAGE: &str = "alpine:3.22.2";

pub(super) fn prepare(
    project_root_path: &Path,
    profile: CosmosProfileConfig,
    stateful: bool,
) -> Result<(), Box<dyn std::error::Error>> {
    validate_assets(project_root_path)?;
    let state_dir = profile.state_dir(project_root_path);

    if stateful {
        fs::create_dir_all(state_dir.as_path())?;
        return Ok(());
    }

    stop(project_root_path, profile);
    if state_dir.exists() {
        remove_state_dir(project_root_path, state_dir.as_path())?;
    }
    fs::create_dir_all(state_dir.as_path())?;

    Ok(())
}

pub(super) async fn start(
    project_root_path: &Path,
    profile: CosmosProfileConfig,
) -> Result<(), Box<dyn std::error::Error>> {
    let compose_dir = compose_dir(project_root_path);
    DockerCli::new(compose_dir.as_path()).compose_ok(&[
        "-f",
        COMPOSE_FILE,
        "--profile",
        profile.name,
        "up",
        "--build",
        "-d",
        profile.service,
    ])?;

    let status_url = profile.status_url();
    let expected_chain_id = profile.chain_id;
    let health_result = wait_for_health_check(
        status_url.as_str(),
        120,
        3_000,
        Some(move |response_body: &String| {
            let json: Value = serde_json::from_str(response_body).unwrap_or_default();
            let network_matches = json["result"]["node_info"]["network"]
                .as_str()
                .is_some_and(|network| network == expected_chain_id);
            let has_blocks = json["result"]["sync_info"]["latest_block_height"]
                .as_str()
                .and_then(|height| height.parse::<u64>().ok())
                .is_some_and(|height| height > 0);
            network_matches && has_blocks
        }),
    )
    .await;

    if health_result.is_ok() {
        return Ok(());
    }

    stop(project_root_path, profile);
    Err(format!(
        "Timed out while waiting for {} at {}",
        profile.display_name, status_url
    )
    .into())
}

pub(super) fn stop(project_root_path: &Path, profile: CosmosProfileConfig) {
    let compose_dir = compose_dir(project_root_path);
    let docker = DockerCli::new(compose_dir.as_path());
    let _ = docker.compose_ok(&[
        "-f",
        COMPOSE_FILE,
        "--profile",
        profile.name,
        "stop",
        profile.service,
    ]);
    let _ = docker.compose_ok(&[
        "-f",
        COMPOSE_FILE,
        "--profile",
        profile.name,
        "rm",
        "-f",
        profile.service,
    ]);
}

fn compose_dir(project_root_path: &Path) -> std::path::PathBuf {
    project_root_path.join("chains").join("cosmos")
}

fn remove_state_dir(
    project_root_path: &Path,
    state_dir: &Path,
) -> Result<(), Box<dyn std::error::Error>> {
    match fs::remove_dir_all(state_dir) {
        Ok(()) => return Ok(()),
        Err(error) if error.kind() != std::io::ErrorKind::PermissionDenied => {
            return Err(error.into())
        }
        Err(_) => {}
    }

    // A Linux Docker daemon may create bind-mounted chain data as root. Clear
    // that exact mount from a disposable root container, leaving the known
    // profile directory in place for the next Compose start.
    let mount = format!("{}:/state", state_dir.display());
    DockerCli::new(compose_dir(project_root_path).as_path()).raw_output(&[
        "run",
        "--rm",
        "--volume",
        mount.as_str(),
        STATE_CLEANUP_IMAGE,
        "sh",
        "-c",
        "find /state -mindepth 1 -depth -delete",
    ])?;

    Ok(())
}

fn validate_assets(project_root_path: &Path) -> Result<(), Box<dyn std::error::Error>> {
    let profile_root = compose_dir(project_root_path);
    for required_file in [
        "Dockerfile",
        "docker-compose.yml",
        "profiles.yml",
        "config/node_key.json",
        "config/priv_validator_key.json",
        "scripts/setup_profile.sh",
    ] {
        let path = profile_root.join(required_file);
        if !path.is_file() {
            return Err(format!(
                "Missing Cosmos compatibility profile asset: {}",
                path.display()
            )
            .into());
        }
    }

    Ok(())
}
