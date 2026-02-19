use std::env;
use std::fs;
use std::path::{Path, PathBuf};

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

pub fn ensure_user_bin_dirs_on_path() -> Result<(), String> {
    let Some(home_path) = home_dir() else {
        return Err("Unable to resolve home directory for PATH setup".to_string());
    };

    let path_entries = vec![
        ("$HOME/go/bin", home_path.join("go/bin")),
        ("$HOME/.deno/bin", home_path.join(".deno/bin")),
    ];

    prepend_entries_to_process_path(&path_entries);
    let profile_path = resolve_shell_profile_path(home_path.as_path());
    let mut profile_content = if profile_path.exists() {
        fs::read_to_string(profile_path.as_path()).map_err(|error| {
            format!(
                "Failed to read shell profile {}: {}",
                profile_path.display(),
                error
            )
        })?
    } else {
        String::new()
    };

    let mut appended = false;
    for (entry_expr, _) in &path_entries {
        let export_line = format!(
            "if [ -d \"{entry}\" ] && [[ \":$PATH:\" != *\":{entry}:\"* ]]; then export PATH=\"{entry}:$PATH\"; fi",
            entry = entry_expr
        );

        if !profile_content.contains(&export_line) {
            if !profile_content.ends_with('\n') && !profile_content.is_empty() {
                profile_content.push('\n');
            }
            profile_content.push_str(&export_line);
            profile_content.push('\n');
            appended = true;
        }
    }

    if appended {
        fs::write(profile_path.as_path(), profile_content).map_err(|error| {
            format!(
                "Failed to update shell profile {}: {}",
                profile_path.display(),
                error
            )
        })?;
        logger::log(&format!(
            "PASS: Added Go/Deno PATH exports to {}",
            profile_path.display()
        ));
        logger::warn("WARN: Restart the shell or run `source <profile>` to load PATH updates");
    }

    Ok(())
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

fn prepend_entries_to_process_path(path_entries: &[(&str, PathBuf)]) {
    let current_path = env::var_os("PATH").unwrap_or_default();
    let mut paths: Vec<PathBuf> = env::split_paths(&current_path).collect();
    let mut changed = false;

    for (_, absolute_path) in path_entries {
        if !absolute_path.is_dir() {
            continue;
        }

        if !paths.iter().any(|path| path == absolute_path) {
            paths.insert(0, absolute_path.clone());
            changed = true;
        }
    }

    if changed {
        if let Ok(joined) = env::join_paths(paths) {
            env::set_var("PATH", joined);
        }
    }
}

fn resolve_shell_profile_path(home_path: &Path) -> PathBuf {
    let shell_value = env::var("SHELL").unwrap_or_default();
    let shell_name = Path::new(shell_value.as_str())
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or_default();

    if shell_name.contains("zsh") {
        return home_path.join(".zshrc");
    }
    if shell_name.contains("bash") {
        return home_path.join(".bashrc");
    }

    home_path.join(".profile")
}
