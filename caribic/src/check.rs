use crate::{
    logger,
    setup::{download_osmosis, install_osmosisd},
};
use std::{path::Path, process::Command};

pub async fn check_prerequisites() {
    logger::info(&format!("Checking prerequisites..."));
    check_tool_availability(
        "Docker",
        "--version",
        "Go to https://www.docker.com/ and install Docker.",
    );
    check_tool_availability(
        "Aiken",
        "--version",
        "Please visit https://aiken-lang.org/installation-instructions to install Aiken.",
    );
    check_tool_availability(
        "Deno",
        "--version",
        "Please visit https://deno.com/ to install Deno.",
    );
    check_tool_availability(
        "Go",
        "version",
        "Install Go by following the instructions at https://go.dev/doc/install.",
    );
    check_tool_availability("Hermes", "version", "Install Hermes by following the instructions at https://hermes.informal.systems/quick-start/installation.html#install-by-downloading");
}

fn check_tool_availability(tool: &str, version_flag: &str, install_instructions: &str) {
    let tool_check = Command::new(tool.to_ascii_lowercase())
        .arg(version_flag)
        .output();

    match tool_check {
        Ok(output) => {
            if output.status.success() {
                let version = String::from_utf8_lossy(&output.stdout);
                if version.lines().count() == 1 {
                    logger::log(&format!("PASS: {}", version));
                } else {
                    if let Some(version_info) = version.lines().next() {
                        logger::log(&format!("PASS: {}", version_info));
                    }
                }
            } else {
                logger::log(&format!(
                    "ERROR: {} is not installed or not available in the PATH.",
                    tool
                ));
                logger::log(&format!("{}", install_instructions));
            }
        }
        Err(_e) => {
            logger::log(&format!(
                "ERROR: {} is not installed or not available in the PATH.",
                tool
            ));
            logger::log(&format!("{}", install_instructions));
        }
    }
}

pub async fn check_osmosisd(osmosis_dir: &Path) {
    let osmosisd_check = Command::new("osmosisd").arg("version").output();
    if osmosis_dir.exists() {
        logger::verbose(&format!("Osmosis directory already exists"));
    } else {
        let result = download_osmosis(osmosis_dir).await;
        if result.is_err() {
            logger::error(&format!(
                "ERROR: Failed to download Osmosis: {}",
                result.err().unwrap()
            ));
        }
    }

    match osmosisd_check {
        Ok(output) => {
            if output.status.success() {
                let version = String::from_utf8_lossy(&output.stderr);
                if let Some(osmosisd_version) = version.lines().next() {
                    logger::verbose(&format!("PASS: osmosisd {}", osmosisd_version));
                }
            } else {
                logger::log(&format!(
                    "ERROR: osomsisd is not installed or not available in the PATH."
                ));
                install_osmosisd(osmosis_dir).await;
            }
        }
        Err(_) => {
            logger::log(&format!(
                "ERROR: osomsisd is not installed or not available in the PATH."
            ));
            install_osmosisd(osmosis_dir).await;
        }
    }
}
