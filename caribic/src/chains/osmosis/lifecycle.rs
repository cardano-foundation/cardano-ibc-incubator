use std::fs;
use std::path::Path;

use fs_extra::{copy_items, file::copy};
use indicatif::{ProgressBar, ProgressStyle};
use serde_json::Value;

use super::config;
use crate::chains::cosmos_node::resolve_home_relative_path;
use crate::logger::{self, log, log_or_show_progress, verbose};
use crate::setup::download_repository;
use crate::utils::{execute_script, wait_for_health_check};

pub(super) async fn prepare_local(
    project_root_path: &Path,
    osmosis_dir: &Path,
    stateful: bool,
) -> Result<(), Box<dyn std::error::Error>> {
    ensure_osmosis_source_available(osmosis_dir).await?;
    sync_workspace_assets_from_repo(project_root_path, osmosis_dir)?;
    copy_local_config_files(osmosis_dir)?;
    verbose("PASS: Osmosis configuration files copied successfully");

    if !stateful {
        stop_local(osmosis_dir);

        let local_home_dir = resolve_home_relative_path(config::LOCAL_HOME_DIR)?;
        if local_home_dir.exists() {
            fs::remove_dir_all(local_home_dir.as_path())?;
        }
    }

    Ok(())
}

pub(super) fn sync_workspace_assets(
    project_root_path: &Path,
    osmosis_dir: &Path,
) -> Result<(), Box<dyn std::error::Error>> {
    sync_workspace_assets_from_repo(project_root_path, osmosis_dir)
}

pub(super) async fn start_local(osmosis_dir: &Path) -> Result<(), Box<dyn std::error::Error>> {
    let optional_progress_bar = match logger::get_verbosity() {
        logger::Verbosity::Verbose => None,
        _ => Some(ProgressBar::new_spinner()),
    };

    if let Some(progress_bar) = &optional_progress_bar {
        progress_bar.set_style(ProgressStyle::with_template("{prefix:.bold} {wide_msg}").unwrap());
        progress_bar.set_prefix("Starting Osmosis appchain ...".to_owned());
    } else {
        log("Starting Osmosis appchain ...");
    }

    let status = execute_script(
        osmosis_dir,
        "docker",
        Vec::from([
            "compose",
            "-f",
            config::LOCAL_DOCKER_COMPOSE_FILE,
            "up",
            "-d",
        ]),
        None,
    );

    if status.is_ok() {
        log_or_show_progress(
            "Waiting for the Osmosis appchain to become healthy ...",
            &optional_progress_bar,
        );

        let osmosis_status_url = config::LOCAL_STATUS_URL;
        let is_healthy = wait_for_health_check(
            osmosis_status_url,
            30,
            3000,
            Some(|response_body: &String| {
                let json: Value = serde_json::from_str(&response_body).unwrap_or_default();

                if let Some(height) = json["result"]["sync_info"]["latest_block_height"]
                    .as_str()
                    .and_then(|h| h.parse::<u64>().ok())
                {
                    verbose(&format!("Current block height: {}", height));
                    return height > 0;
                }

                verbose(&format!(
                    "Failed to get the current block height from the response {}",
                    response_body,
                ));

                false
            }),
        )
        .await;

        if let Some(progress_bar) = &optional_progress_bar {
            progress_bar.finish_and_clear();
        }
        if is_healthy.is_ok() {
            Ok(())
        } else {
            Err(format!("Run into timeout while checking {}", osmosis_status_url).into())
        }
    } else {
        if let Some(progress_bar) = &optional_progress_bar {
            progress_bar.finish_and_clear();
        }

        Err(status.unwrap_err().into())
    }
}

pub(super) fn stop_local(osmosis_path: &Path) {
    for compose_file in [
        config::LOCAL_DOCKER_COMPOSE_FILE,
        config::LOCAL_LEGACY_DOCKER_COMPOSE_FILE,
    ] {
        if !osmosis_path.join(compose_file).exists() {
            continue;
        }

        let _ = execute_script(
            osmosis_path,
            "docker",
            Vec::from(["compose", "-f", compose_file, "down"]),
            None,
        );
    }
}

async fn ensure_osmosis_source_available(
    osmosis_dir: &Path,
) -> Result<(), Box<dyn std::error::Error>> {
    if osmosis_dir.exists() {
        verbose("Osmosis directory already exists");
        return Ok(());
    }

    download_osmosis_source(osmosis_dir).await
}

async fn download_osmosis_source(osmosis_path: &Path) -> Result<(), Box<dyn std::error::Error>> {
    download_repository(config::SOURCE_ZIP_URL, osmosis_path, "osmosis").await
}

fn copy_local_config_files(osmosis_dir: &Path) -> Result<(), fs_extra::error::Error> {
    verbose(&format!(
        "Copying cosmwasm files from {} to {}",
        osmosis_dir.join("../configuration/cosmwasm/wasm").display(),
        osmosis_dir.join("cosmwasm").display()
    ));
    copy_items(
        &vec![osmosis_dir.join("../configuration/cosmwasm/wasm")],
        osmosis_dir.join("cosmwasm"),
        &fs_extra::dir::CopyOptions::new().overwrite(true),
    )?;

    verbose(&format!(
        "Copying hermes files from {} to {}",
        osmosis_dir.join("../configuration/hermes").display(),
        osmosis_dir.join("scripts").display()
    ));
    copy_items(
        &vec![osmosis_dir.join("../configuration/hermes")],
        osmosis_dir.join("scripts"),
        &fs_extra::dir::CopyOptions::new().overwrite(true),
    )?;

    let options = fs_extra::file::CopyOptions::new().overwrite(true);

    verbose(&format!(
        "Copying setup_crosschain_swaps.sh from {} to {}",
        osmosis_dir
            .join("../scripts/setup_crosschain_swaps.sh")
            .display(),
        osmosis_dir
            .join("scripts/setup_crosschain_swaps.sh")
            .display()
    ));
    copy(
        osmosis_dir.join("../scripts/setup_crosschain_swaps.sh"),
        osmosis_dir.join("scripts/setup_crosschain_swaps.sh"),
        &options,
    )?;

    verbose(&format!(
        "Copying Dockerfile from {} to {}",
        osmosis_dir.join("../configuration/Dockerfile").display(),
        osmosis_dir.join("Dockerfile").display()
    ));
    copy(
        osmosis_dir.join("../configuration/Dockerfile"),
        osmosis_dir.join("Dockerfile"),
        &options,
    )?;

    Ok(())
}

fn sync_workspace_assets_from_repo(
    project_root_path: &Path,
    osmosis_dir: &Path,
) -> Result<(), Box<dyn std::error::Error>> {
    let source_root = project_root_path.join("chains").join("osmosis");
    let configuration_source = source_root.join("configuration");
    let scripts_source = source_root.join("scripts");

    if !configuration_source.exists() || !scripts_source.exists() {
        return Err(format!(
            "Missing Osmosis asset templates under {}. Expected {}/configuration and {}/scripts",
            source_root.display(),
            source_root.display(),
            source_root.display()
        )
        .into());
    }

    let workspace_root = osmosis_dir
        .parent()
        .ok_or("Failed to resolve Osmosis workspace root")?;
    fs::create_dir_all(workspace_root)?;

    copy_items(
        &vec![configuration_source, scripts_source],
        workspace_root,
        &fs_extra::dir::CopyOptions::new().overwrite(true),
    )?;

    Ok(())
}
