use crate::logger;
use dirs::home_dir;
use std::ffi::OsStr;
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

const HERMES_NATIVE_TOOLCHAIN_REQUIREMENT: ToolRequirement = ToolRequirement {
    name: "Hermes native build toolchain (cc/clang/pkg-config + libc headers)",
    command: "hermes-native-toolchain",
    args: &[],
    install_instructions:
        "Install build prerequisites for Hermes. On Ubuntu/Debian: apt-get install -y build-essential clang pkg-config libclang-dev",
};

fn base_requirements() -> Vec<ToolRequirement> {
    let mut requirements = vec![
        DOCKER_REQUIREMENT,
        AIKEN_REQUIREMENT,
        DENO_REQUIREMENT,
        GO_REQUIREMENT,
    ];

    if cfg!(target_os = "linux") {
        requirements.push(HERMES_NATIVE_TOOLCHAIN_REQUIREMENT);
    }

    requirements
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
            } else if requirement.command == "hermes-native-toolchain" {
                probe_hermes_native_toolchain(requirement)
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

fn probe_hermes_native_toolchain(requirement: &ToolRequirement) -> ToolStatus {
    let command = "command -v cc >/dev/null 2>&1 && command -v clang >/dev/null 2>&1 && command -v pkg-config >/dev/null 2>&1 && printf '#include <stddef.h>\\n' | cc -E -x c - >/dev/null 2>&1";
    let available = Command::new("sh")
        .args(["-lc", command])
        .status()
        .map(|status| status.success())
        .unwrap_or(false);

    let version_line = if available {
        let cc_version =
            run_version_command("cc", &["--version"]).unwrap_or_else(|| "cc available".to_string());
        Some(format!("{} ({})", requirement.name, cc_version))
    } else {
        None
    };

    ToolStatus {
        name: requirement.name,
        command: requirement.command,
        install_instructions: requirement.install_instructions,
        available,
        version_line,
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
