use crate::{
    logger,
    setup::{download_osmosis, install_osmosisd},
};
use std::{
    env,
    path::{Path, PathBuf},
    process::Command,
};

/// Checks whether required local tools are installed and callable.
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

/// Runs `<tool> <version_flag>` and reports a pass or install guidance.
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

/// Ensures `osmosisd` is available and executable, installing it when needed.
pub async fn check_osmosisd(osmosis_dir: &Path) {
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

    let mut binary = locate_osmosisd_binary();
    if binary.is_none() {
        logger::log("ERROR: osmosisd is not installed or not available in the PATH.");

        match install_osmosisd(osmosis_dir).await {
            Ok(true) => {
                binary = locate_osmosisd_binary();
            }
            Ok(false) => return,
            Err(error) => {
                logger::error(&format!("ERROR: Failed to install osmosisd: {}", error));
                return;
            }
        }
    }

    if let Some((osmosisd_binary, path_visible)) = binary {
        match Command::new(&osmosisd_binary).arg("version").output() {
            Ok(output) if output.status.success() => {
                let stdout_version = String::from_utf8_lossy(&output.stdout);
                let stderr_version = String::from_utf8_lossy(&output.stderr);
                let version_line = stdout_version
                    .lines()
                    .next()
                    .or_else(|| stderr_version.lines().next())
                    .unwrap_or("version unavailable");

                logger::verbose(&format!(
                    "PASS: osmosisd {} ({})",
                    version_line,
                    osmosisd_binary.display()
                ));

                if !path_visible {
                    logger::warn(&format!(
                        "osmosisd is installed at {} but not visible in PATH. Add '$HOME/go/bin' to PATH for direct shell usage.",
                        osmosisd_binary.display()
                    ));
                }
            }
            Ok(output) => {
                logger::error(&format!(
                    "ERROR: osmosisd exists at {} but 'osmosisd version' failed (exit code {}).",
                    osmosisd_binary.display(),
                    output.status.code().unwrap_or(-1)
                ));
            }
            Err(error) => {
                logger::error(&format!(
                    "ERROR: Failed to run osmosisd at {}: {}",
                    osmosisd_binary.display(),
                    error
                ));
            }
        }
    }
}

/// Resolves `osmosisd` from PATH, then falls back to `$HOME/go/bin/osmosisd`.
///
/// Returns:
/// - the resolved path
/// - whether resolution came directly from PATH
fn locate_osmosisd_binary() -> Option<(PathBuf, bool)> {
    if let Some(path_var) = env::var_os("PATH") {
        for directory in env::split_paths(&path_var) {
            let candidate = directory.join("osmosisd");
            if candidate.is_file() {
                return Some((candidate, true));
            }
        }
    }

    dirs::home_dir().and_then(|home| {
        let candidate = home.join("go/bin/osmosisd");
        if candidate.is_file() {
            Some((candidate, false))
        } else {
            None
        }
    })
}
