use std::path::Path;

use crate::check::{collect_prerequisite_statuses, emit_statuses};
use crate::logger;

mod platform;
mod runner;
mod tools;

use platform::detect_host_os;
use tools::{ensure_user_bin_dirs_on_path, install_missing_tool};

/// Installs missing prerequisites for caribic.
pub fn run_install(_project_root_path: &Path) -> Result<(), String> {
    if let Err(error) = ensure_user_bin_dirs_on_path() {
        logger::warn(&format!(
            "WARN: Failed to update PATH profile entries: {}",
            error
        ));
    }

    logger::log("Checking current prerequisite status before install");
    let initial_statuses = collect_prerequisite_statuses();
    emit_statuses(initial_statuses.as_slice());

    let missing_tools = initial_statuses
        .iter()
        .filter(|status| !status.available)
        .collect::<Vec<_>>();

    if missing_tools.is_empty() {
        logger::log("PASS: All prerequisites are already installed");
        return Ok(());
    }

    let host_os = detect_host_os();
    let mut install_errors = Vec::new();

    for tool in missing_tools {
        logger::log(&format!("Installing {} ...", tool.name));
        if let Err(error) = install_missing_tool(tool, &host_os) {
            logger::warn(&format!("WARN: Failed to install {}: {}", tool.name, error));
            install_errors.push(format!("{}: {}", tool.name, error));
        } else {
            logger::log(&format!("PASS: Installed {}", tool.name));
        }
    }

    if let Err(error) = ensure_user_bin_dirs_on_path() {
        logger::warn(&format!(
            "WARN: Failed to update PATH profile entries: {}",
            error
        ));
    }

    logger::log("Re-checking prerequisite status after install");
    let final_statuses = collect_prerequisite_statuses();
    emit_statuses(final_statuses.as_slice());

    let still_missing = final_statuses
        .iter()
        .filter(|status| !status.available)
        .map(|status| status.name)
        .collect::<Vec<_>>();

    if still_missing.is_empty() {
        if !install_errors.is_empty() {
            logger::warn(
                "WARN: Some installers reported errors but all required tools are now available",
            );
        }
        return Ok(());
    }

    let mut message = format!(
        "Failed to install all prerequisites. Still missing: {}",
        still_missing.join(", ")
    );
    if !install_errors.is_empty() {
        message = format!(
            "{}\nInstall errors:\n{}",
            message,
            install_errors.join("\n")
        );
    }
    Err(message)
}
