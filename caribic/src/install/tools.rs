use std::path::PathBuf;

use dirs::home_dir;

use crate::check::ToolStatus;
use crate::logger;

use super::platform::HostOs;
use super::runner::{
    command_exists, run_command, run_command_streaming, run_privileged_command, run_shell,
};

const DENO_INSTALL_SCRIPT: &str = "curl -fsSL https://deno.land/install.sh | sh";

pub fn install_missing_tool(tool: &ToolStatus, host_os: &HostOs) -> Result<(), String> {
    match tool.command {
        "docker" => install_docker(host_os),
        "aiken" => install_aiken(),
        "deno" => install_deno(host_os),
        "go" => install_go(host_os),
        _ => Err(format!("Unsupported tool installer for '{}'", tool.command)),
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
            install_docker_linux_packages()?;
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

    logger::log("Aiken install can take several minutes and prints live cargo output");
    run_command_streaming(
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
            ensure_linux_archive_tool_for_deno()?;
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

fn install_docker_linux_packages() -> Result<(), String> {
    if !command_exists("apt-get") {
        return Err(
            "`apt-get` is not available. This installer supports Ubuntu/Debian Linux only"
                .to_string(),
        );
    }

    run_privileged_command("apt-get", &["update"])?;

    let package_sets: [&[&str]; 3] = [
        &["docker.io", "docker-compose-plugin"],
        &["docker.io", "docker-compose-v2"],
        &["docker.io", "docker-compose"],
    ];

    let mut errors = Vec::new();
    for packages in package_sets {
        let mut args = vec!["install", "-y"];
        args.extend_from_slice(packages);
        match run_privileged_command("apt-get", args.as_slice()) {
            Ok(_) => return Ok(()),
            Err(error) => {
                errors.push(format!("{} => {}", packages.join(" "), error));
            }
        }
    }

    Err(format!(
        "Failed to install Docker packages with apt. Tried:\n{}",
        errors.join("\n")
    ))
}

fn ensure_linux_archive_tool_for_deno() -> Result<(), String> {
    if command_exists("unzip") || command_exists("7z") || command_exists("7zz") {
        return Ok(());
    }

    match install_apt_packages(&["unzip"]) {
        Ok(_) => Ok(()),
        Err(unzip_error) => match install_apt_packages(&["p7zip-full"]) {
            Ok(_) => Ok(()),
            Err(p7zip_error) => Err(format!(
                "Deno installer requires unzip or 7z. Failed to install unzip ({}) and p7zip-full ({})",
                unzip_error, p7zip_error
            )),
        },
    }
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
