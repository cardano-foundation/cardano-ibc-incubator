use crate::logger;
use std::process::Command;

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
