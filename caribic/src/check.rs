use crate::logger;
use dirs::home_dir;
use std::ffi::OsStr;
use std::path::Path;
use std::process::Command;

#[derive(Clone, Debug)]
pub struct ToolStatus {
    pub name: &'static str,
    pub command: &'static str,
    pub install_instructions: &'static str,
    pub available: bool,
    pub version_line: Option<String>,
    pub detected_via: Option<String>,
}

#[derive(Clone, Copy)]
struct ToolRequirement {
    name: &'static str,
    command: &'static str,
    args: &'static [&'static str],
    install_instructions: &'static str,
}

const DOCKER_REQUIREMENT: ToolRequirement = ToolRequirement {
    name: "Docker",
    command: "docker",
    args: &["--version"],
    install_instructions: "Go to https://www.docker.com/ and install Docker.",
};

const AIKEN_REQUIREMENT: ToolRequirement = ToolRequirement {
    name: "Aiken",
    command: "aiken",
    args: &["--version"],
    install_instructions:
        "Please visit https://aiken-lang.org/installation-instructions to install Aiken.",
};

const DENO_REQUIREMENT: ToolRequirement = ToolRequirement {
    name: "Deno",
    command: "deno",
    args: &["--version"],
    install_instructions: "Please visit https://deno.com/ to install Deno.",
};

const GO_REQUIREMENT: ToolRequirement = ToolRequirement {
    name: "Go",
    command: "go",
    args: &["version"],
    install_instructions: "Install Go by following the instructions at https://go.dev/doc/install.",
};

fn base_requirements() -> [ToolRequirement; 4] {
    [
        DOCKER_REQUIREMENT,
        AIKEN_REQUIREMENT,
        DENO_REQUIREMENT,
        GO_REQUIREMENT,
    ]
}

/// Checks whether required local tools are installed and callable.
pub async fn check_prerequisites() -> bool {
    logger::info("Checking prerequisites...");
    let statuses = collect_prerequisite_statuses();
    emit_statuses(statuses.as_slice());
    statuses.iter().all(|status| status.available)
}

/// Returns tool availability without printing output.
pub fn collect_prerequisite_statuses() -> Vec<ToolStatus> {
    base_requirements()
        .iter()
        .map(|requirement| {
            if requirement.command == "deno" {
                probe_deno(requirement)
            } else {
                probe_standard_tool(requirement)
            }
        })
        .collect()
}

/// Prints the standard prerequisite status table.
pub fn emit_statuses(statuses: &[ToolStatus]) {
    for status in statuses {
        if status.available {
            let version_line = status
                .version_line
                .clone()
                .unwrap_or_else(|| format!("{} is available", status.name));
            let suffix = status
                .detected_via
                .as_ref()
                .map(|path| format!(" ({})", path))
                .unwrap_or_default();
            logger::log(&format!("PASS: {}{}", version_line, suffix));
        } else {
            logger::log(&format!(
                "ERROR: {} is not installed or not available in the PATH.",
                status.name
            ));
            logger::log(status.install_instructions);
        }
    }

    emit_path_hints();
}

fn probe_standard_tool(requirement: &ToolRequirement) -> ToolStatus {
    let version_line = run_version_command(requirement.command, requirement.args);
    ToolStatus {
        name: requirement.name,
        command: requirement.command,
        install_instructions: requirement.install_instructions,
        available: version_line.is_some(),
        version_line,
        detected_via: None,
    }
}

fn probe_deno(requirement: &ToolRequirement) -> ToolStatus {
    if let Some(version_line) = run_version_command(requirement.command, requirement.args) {
        return ToolStatus {
            name: requirement.name,
            command: requirement.command,
            install_instructions: requirement.install_instructions,
            available: true,
            version_line: Some(version_line),
            detected_via: Some("PATH".to_string()),
        };
    }

    let Some(home) = home_dir() else {
        return ToolStatus {
            name: requirement.name,
            command: requirement.command,
            install_instructions: requirement.install_instructions,
            available: false,
            version_line: None,
            detected_via: None,
        };
    };

    let local_deno_path = home.join(".deno/bin/deno");
    if local_deno_path.is_file() {
        if let Some(version_line) = run_version_command(&local_deno_path, requirement.args) {
            return ToolStatus {
                name: requirement.name,
                command: requirement.command,
                install_instructions: requirement.install_instructions,
                available: true,
                version_line: Some(version_line),
                detected_via: Some(local_deno_path.display().to_string()),
            };
        }
    }

    ToolStatus {
        name: requirement.name,
        command: requirement.command,
        install_instructions: requirement.install_instructions,
        available: false,
        version_line: None,
        detected_via: None,
    }
}

fn run_version_command<S: AsRef<OsStr>>(command: S, args: &[&str]) -> Option<String> {
    let output = Command::new(command).args(args).output().ok()?;
    if !output.status.success() {
        return None;
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    let line = stdout
        .lines()
        .find(|line| !line.trim().is_empty())
        .or_else(|| stderr.lines().find(|line| !line.trim().is_empty()))?;
    Some(line.trim().to_string())
}

fn emit_path_hints() {
    let Some(home_path) = home_dir() else {
        return;
    };

    let go_bin_path = home_path.join("go/bin");
    if go_bin_path.is_dir() && !path_contains_directory(go_bin_path.as_path()) {
        logger::warn(
            "WARN: ~/go/bin is not in PATH. osmosisd may fail to start from shell commands",
        );
    }

    let deno_bin_path = home_path.join(".deno/bin");
    if deno_bin_path.is_dir() && !path_contains_directory(deno_bin_path.as_path()) {
        logger::warn(
            "WARN: ~/.deno/bin is not in PATH. add it or restart shell after `caribic install`",
        );
    }
}

fn path_contains_directory(target_directory: &Path) -> bool {
    let Some(path_var) = std::env::var_os("PATH") else {
        return false;
    };

    std::env::split_paths(&path_var).any(|path| path == target_directory)
}
