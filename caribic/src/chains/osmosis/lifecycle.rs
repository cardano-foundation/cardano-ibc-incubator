use std::env;
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::process::Command;

use console::style;
use dirs::home_dir;
use fs_extra::{copy_items, file::copy};
use indicatif::{ProgressBar, ProgressStyle};
use serde_json::Value;

use crate::logger::{self, log, log_or_show_progress, verbose, warn};
use crate::setup::download_repository;
use crate::utils::{execute_script, execute_script_interactive, wait_for_health_check};

const OSMOSIS_SOURCE_ZIP_URL: &str =
    "https://github.com/osmosis-labs/osmosis/archive/refs/tags/v30.0.1.zip";
const OSMOSIS_LOCAL_STATUS_URL: &str = "http://127.0.0.1:26658/status";

pub(super) async fn prepare_local(osmosis_dir: &Path) -> Result<(), Box<dyn std::error::Error>> {
    ensure_osmosisd_available(osmosis_dir).await?;
    copy_local_config_files(osmosis_dir)?;
    verbose("PASS: Osmosis configuration files copied successfully");
    init_local_network(osmosis_dir)?;
    Ok(())
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
            "tests/localosmosis/docker-compose.yml",
            "up",
            "-d",
        ]),
        Some(Vec::from([(
            "OSMOSISD_CONTAINER_NAME",
            "localosmosis-osmosisd-1",
        )])),
    );

    if status.is_ok() {
        log_or_show_progress(
            "Waiting for the Osmosis appchain to become healthy ...",
            &optional_progress_bar,
        );

        let osmosis_status_url = OSMOSIS_LOCAL_STATUS_URL;
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
    let _ = execute_script(osmosis_path, "make", Vec::from(["localnet-stop"]), None);
}

async fn ensure_osmosisd_available(osmosis_dir: &Path) -> Result<(), Box<dyn std::error::Error>> {
    if osmosis_dir.exists() {
        verbose("Osmosis directory already exists");
    } else {
        download_osmosis_source(osmosis_dir).await?;
    }

    let mut binary = locate_osmosisd_binary();
    if binary.is_none() {
        log("ERROR: osmosisd is not installed or not available in the PATH.");

        let should_continue = prompt_and_install_osmosisd(osmosis_dir).await?;
        if !should_continue {
            return Err("osmosisd is required for local Osmosis startup".into());
        }

        binary = locate_osmosisd_binary();
    }

    let (osmosisd_binary, path_visible) =
        binary.ok_or("osmosisd is still not available after install step")?;

    match Command::new(&osmosisd_binary).arg("version").output() {
        Ok(output) if output.status.success() => {
            let stdout_version = String::from_utf8_lossy(&output.stdout);
            let stderr_version = String::from_utf8_lossy(&output.stderr);
            let version_line = stdout_version
                .lines()
                .next()
                .or_else(|| stderr_version.lines().next())
                .unwrap_or("version unavailable");

            verbose(&format!(
                "PASS: osmosisd {} ({})",
                version_line,
                osmosisd_binary.display()
            ));

            if !path_visible {
                warn(&format!(
                    "osmosisd is installed at {} but not visible in PATH. Add '$HOME/go/bin' to PATH for direct shell usage.",
                    osmosisd_binary.display()
                ));
            }
        }
        Ok(output) => {
            return Err(format!(
                "osmosisd exists at {} but 'osmosisd version' failed (exit code {})",
                osmosisd_binary.display(),
                output.status.code().unwrap_or(-1)
            )
            .into());
        }
        Err(error) => {
            return Err(format!(
                "Failed to run osmosisd at {}: {}",
                osmosisd_binary.display(),
                error
            )
            .into());
        }
    }

    Ok(())
}

async fn download_osmosis_source(osmosis_path: &Path) -> Result<(), Box<dyn std::error::Error>> {
    download_repository(OSMOSIS_SOURCE_ZIP_URL, osmosis_path, "osmosis").await
}

async fn prompt_and_install_osmosisd(
    osmosis_path: &Path,
) -> Result<bool, Box<dyn std::error::Error>> {
    let question = "Do you want to install osmosisd? (yes/no): ";
    print!("{}", question);
    io::stdout().flush()?;

    let mut input = String::new();
    io::stdin().read_line(&mut input)?;
    let input = input.trim().to_lowercase();

    if input == "yes" || input == "y" {
        println!("{} Installing osmosisd...", style("Step 1/1").bold().dim());

        let output = Command::new("make")
            .current_dir(osmosis_path)
            .arg("install")
            .output()
            .map_err(|error| format!("Failed to run make install for osmosisd: {}", error))?;

        if !output.status.success() {
            return Err(format!(
                "Failed to install osmosisd:\n{}",
                String::from_utf8_lossy(&output.stderr)
            )
            .into());
        }

        println!("PASS: osmosisd installed successfully");
        Ok(true)
    } else {
        Ok(false)
    }
}

fn locate_osmosisd_binary() -> Option<(PathBuf, bool)> {
    if let Some(path_var) = env::var_os("PATH") {
        for directory in env::split_paths(&path_var) {
            let candidate = directory.join("osmosisd");
            if candidate.is_file() {
                return Some((candidate, true));
            }
        }
    }

    home_dir().and_then(|home| {
        let candidate = home.join("go/bin/osmosisd");
        if candidate.is_file() {
            Some((candidate, false))
        } else {
            None
        }
    })
}

fn init_local_network(osmosis_dir: &Path) -> Result<(), Box<dyn std::error::Error>> {
    if !logger::is_quite() {
        log("Initialize local Osmosis network ...");
    }

    execute_script_interactive(osmosis_dir, "make", Vec::from(["localnet-init"]))?;
    Ok(())
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
        "Copying localnet.mk from {} to {}",
        osmosis_dir.join("../scripts/localnet.mk").display(),
        osmosis_dir.join("scripts/makefiles/localnet.mk").display()
    ));
    copy(
        osmosis_dir.join("../scripts/localnet.mk"),
        osmosis_dir.join("scripts/makefiles/localnet.mk"),
        &options,
    )?;

    verbose(&format!(
        "Copying setup_osmosis_local.sh from {} to {}",
        osmosis_dir
            .join("../scripts/setup_osmosis_local.sh")
            .display(),
        osmosis_dir
            .join("tests/localosmosis/scripts/setup.sh")
            .display()
    ));
    copy(
        osmosis_dir.join("../scripts/setup_osmosis_local.sh"),
        osmosis_dir.join("tests/localosmosis/scripts/setup.sh"),
        &options,
    )?;

    verbose(&format!(
        "Copying docker-compose.yml from {} to {}",
        osmosis_dir
            .join("../configuration/docker-compose.yml")
            .display(),
        osmosis_dir
            .join("tests/localosmosis/docker-compose.yml")
            .display()
    ));
    copy(
        osmosis_dir.join("../configuration/docker-compose.yml"),
        osmosis_dir.join("tests/localosmosis/docker-compose.yml"),
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
