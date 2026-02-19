use std::env;
use std::path::{Path, PathBuf};
use std::process::Command;

use dirs::home_dir;

use crate::check::{collect_prerequisite_statuses, emit_statuses, ToolStatus};
use crate::{logger, start};

const DENO_INSTALL_SCRIPT: &str = "curl -fsSL https://deno.land/install.sh | sh";

enum HostOs {
    MacOs,
    Linux,
    Unsupported(String),
}

/// Installs missing prerequisites for caribic without downloading external Hermes binaries.
pub fn run_install(project_root_path: &Path) -> Result<(), String> {
    logger::log("Checking current prerequisite status before install");
    let initial_statuses = collect_prerequisite_statuses(Some(project_root_path));
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
        if let Err(error) = install_missing_tool(tool, project_root_path, &host_os) {
            logger::warn(&format!("WARN: Failed to install {}: {}", tool.name, error));
            install_errors.push(format!("{}: {}", tool.name, error));
        } else {
            logger::log(&format!("PASS: Installed {}", tool.name));
        }
    }

    logger::log("Re-checking prerequisite status after install");
    let final_statuses = collect_prerequisite_statuses(Some(project_root_path));
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

fn install_missing_tool(
    tool: &ToolStatus,
    project_root_path: &Path,
    host_os: &HostOs,
) -> Result<(), String> {
    match tool.command {
        "docker" => install_docker(host_os),
        "aiken" => install_aiken(),
        "deno" => install_deno(host_os),
        "go" => install_go(host_os),
        "hermes" => build_local_hermes(project_root_path),
        _ => Err(format!("Unsupported tool installer for '{}'", tool.command)),
    }
}

fn detect_host_os() -> HostOs {
    match env::consts::OS {
        "macos" => HostOs::MacOs,
        "linux" => HostOs::Linux,
        other => HostOs::Unsupported(other.to_string()),
    }
}

fn install_docker(host_os: &HostOs) -> Result<(), String> {
    match host_os {
        HostOs::MacOs => {
            ensure_homebrew_available()?;
            run_command("brew", &["install", "--cask", "docker"])?;
            logger::warn(
                "WARN: Docker Desktop was installed. Start Docker Desktop once before running `caribic start`",
            );
            Ok(())
        }
        HostOs::Linux => {
            install_apt_packages(&["docker.io", "docker-compose-plugin"])?;
            let _ = run_privileged_command("systemctl", &["enable", "--now", "docker"]);
            Ok(())
        }
        HostOs::Unsupported(os) => Err(format!(
            "Automatic Docker install is not supported on '{}'. Install Docker manually",
            os
        )),
    }
}

fn install_aiken() -> Result<(), String> {
    if !command_exists("cargo") {
        return Err("`cargo` is required to install Aiken automatically".to_string());
    }

    run_command(
        "cargo",
        &[
            "install",
            "--locked",
            "--git",
            "https://github.com/aiken-lang/aiken.git",
            "aiken",
        ],
    )
}

fn install_deno(host_os: &HostOs) -> Result<(), String> {
    match host_os {
        HostOs::MacOs => {
            ensure_homebrew_available()?;
            run_command("brew", &["install", "deno"])
        }
        HostOs::Linux => {
            run_shell(DENO_INSTALL_SCRIPT)?;
            if let Some(path) = local_deno_binary() {
                logger::warn(&format!(
                    "WARN: Deno was installed at {}. Add ~/.deno/bin to PATH if needed",
                    path.display()
                ));
            }
            Ok(())
        }
        HostOs::Unsupported(os) => Err(format!(
            "Automatic Deno install is not supported on '{}'. Install Deno manually",
            os
        )),
    }
}

fn install_go(host_os: &HostOs) -> Result<(), String> {
    match host_os {
        HostOs::MacOs => {
            ensure_homebrew_available()?;
            run_command("brew", &["install", "go"])
        }
        HostOs::Linux => install_apt_packages(&["golang-go"]),
        HostOs::Unsupported(os) => Err(format!(
            "Automatic Go install is not supported on '{}'. Install Go manually",
            os
        )),
    }
}

fn build_local_hermes(project_root_path: &Path) -> Result<(), String> {
    let relayer_path = project_root_path.join("relayer");
    if !relayer_path.exists() {
        return Err(format!(
            "Relayer directory not found at {}",
            relayer_path.display()
        ));
    }

    start::build_hermes_if_needed(relayer_path.as_path())
        .map_err(|error| format!("Failed to build local Hermes binary: {}", error))
}

fn ensure_homebrew_available() -> Result<(), String> {
    if command_exists("brew") {
        return Ok(());
    }
    Err("Homebrew is not installed. Install Homebrew from https://brew.sh/ first".to_string())
}

fn install_apt_packages(packages: &[&str]) -> Result<(), String> {
    if !command_exists("apt-get") {
        return Err(
            "`apt-get` is not available. This installer supports Ubuntu/Debian Linux only"
                .to_string(),
        );
    }

    run_privileged_command("apt-get", &["update"])?;

    let mut args = vec!["install", "-y"];
    args.extend_from_slice(packages);
    run_privileged_command("apt-get", args.as_slice())
}

fn run_shell(shell_command: &str) -> Result<(), String> {
    run_command("sh", &["-lc", shell_command])
}

fn run_privileged_command(command: &str, args: &[&str]) -> Result<(), String> {
    if is_root_user() {
        return run_command(command, args);
    }

    if !command_exists("sudo") {
        return Err(format!(
            "`sudo` is required to run '{} {}' as a non-root user",
            command,
            args.join(" ")
        ));
    }

    let mut sudo_args = vec![command];
    sudo_args.extend_from_slice(args);
    run_command("sudo", sudo_args.as_slice())
}

fn run_command(command: &str, args: &[&str]) -> Result<(), String> {
    let output = Command::new(command).args(args).output().map_err(|error| {
        format!(
            "Failed to run `{}`: {}",
            format_command(command, args),
            error
        )
    })?;

    if output.status.success() {
        return Ok(());
    }

    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let details = if !stderr.is_empty() {
        stderr
    } else if !stdout.is_empty() {
        stdout
    } else {
        "no output".to_string()
    };

    Err(format!(
        "`{}` failed (exit code {}): {}",
        format_command(command, args),
        output.status.code().unwrap_or(-1),
        details
    ))
}

fn format_command(command: &str, args: &[&str]) -> String {
    if args.is_empty() {
        return command.to_string();
    }
    format!("{} {}", command, args.join(" "))
}

fn command_exists(binary: &str) -> bool {
    let Some(path_var) = env::var_os("PATH") else {
        return false;
    };

    env::split_paths(&path_var).any(|directory| {
        let candidate = directory.join(binary);
        candidate.is_file()
    })
}

fn is_root_user() -> bool {
    Command::new("id")
        .arg("-u")
        .output()
        .ok()
        .and_then(|output| String::from_utf8(output.stdout).ok())
        .map(|uid| uid.trim() == "0")
        .unwrap_or(false)
}

fn local_deno_binary() -> Option<PathBuf> {
    let home = home_dir()?;
    let deno_path = home.join(".deno/bin/deno");
    if deno_path.is_file() {
        Some(deno_path)
    } else {
        None
    }
}
