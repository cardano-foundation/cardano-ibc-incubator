use crate::logger;
use dirs::home_dir;
use serde::Deserialize;
use serde_json::Value;
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

const HERMES_NATIVE_TOOLCHAIN_REQUIREMENT: ToolRequirement = ToolRequirement {
    name: "Hermes native build toolchain (cc/clang/pkg-config/protoc + libc headers)",
    command: "hermes-native-toolchain",
    args: &[],
    install_instructions:
        "Install build prerequisites for Hermes. On Ubuntu/Debian: apt-get install -y build-essential clang pkg-config libclang-dev protobuf-compiler",
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
    emit_docker_space_summary(statuses.as_slice());
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

fn probe_hermes_native_toolchain(requirement: &ToolRequirement) -> ToolStatus {
    let command = "command -v cc >/dev/null 2>&1 && command -v clang >/dev/null 2>&1 && command -v pkg-config >/dev/null 2>&1 && command -v protoc >/dev/null 2>&1 && printf '#include <stddef.h>\\n' | cc -E -x c - >/dev/null 2>&1";
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

#[derive(Debug, Deserialize)]
struct DockerDfRow {
    #[serde(rename = "Type")]
    type_name: String,
    #[serde(rename = "Size")]
    size: String,
    #[serde(rename = "Reclaimable")]
    reclaimable: String,
}

#[derive(Debug)]
struct DockerDfSummary {
    rows: Vec<DockerDfRow>,
    total_size_bytes: u64,
    total_reclaimable_bytes: u64,
}

#[derive(Debug)]
struct DockerAvailableSpace {
    free_bytes: u64,
    total_bytes: Option<u64>,
    source: String,
}

fn emit_docker_space_summary(statuses: &[ToolStatus]) {
    let docker_available = statuses
        .iter()
        .any(|status| status.command == "docker" && status.available);
    if !docker_available {
        return;
    }

    let summary = match collect_docker_df_summary() {
        Ok(summary) => summary,
        Err(error) => {
            logger::warn(&format!(
                "WARN: Could not query Docker disk usage via `docker system df`: {}",
                error
            ));
            return;
        }
    };

    logger::log(&format!(
        "PASS: Docker storage usage: {} total, {} reclaimable",
        format_bytes(summary.total_size_bytes),
        format_bytes(summary.total_reclaimable_bytes)
    ));

    for row in &summary.rows {
        logger::log(&format!(
            "  - {}: {} (reclaimable: {})",
            row.type_name, row.size, row.reclaimable
        ));
    }

    if let Some(space) = detect_docker_available_space(summary.total_size_bytes) {
        if let Some(total_bytes) = space.total_bytes {
            logger::log(&format!(
                "PASS: Docker space available: {} free of {} ({})",
                format_bytes(space.free_bytes),
                format_bytes(total_bytes),
                space.source
            ));
        } else {
            logger::log(&format!(
                "PASS: Docker space available: {} free ({})",
                format_bytes(space.free_bytes),
                space.source
            ));
        }

        let low_space_threshold_bytes = 10_u64 * 1024 * 1024 * 1024;
        if space.free_bytes < low_space_threshold_bytes {
            logger::warn(
                "WARN: Docker free space is below 10 GiB. Clean builds may fail with `no space left on device`.",
            );
        }
    } else {
        logger::warn(
            "WARN: Could not determine Docker filesystem free space. Usage/reclaimable values are still shown above.",
        );
    }

    let high_reclaimable_threshold_bytes = 20_u64 * 1024 * 1024 * 1024;
    if summary.total_reclaimable_bytes >= high_reclaimable_threshold_bytes {
        logger::warn(&format!(
            "WARN: Docker has {} reclaimable data. Consider `docker image prune -af` and `docker builder prune -af`.",
            format_bytes(summary.total_reclaimable_bytes)
        ));
    }
}

fn collect_docker_df_summary() -> Result<DockerDfSummary, String> {
    let output = Command::new("docker")
        .args(["system", "df", "--format", "{{json .}}"])
        .output()
        .map_err(|error| format!("failed to execute docker: {}", error))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            "docker system df returned non-zero exit code".to_string()
        } else {
            stderr
        });
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut rows = Vec::new();
    let mut total_size_bytes = 0u64;
    let mut total_reclaimable_bytes = 0u64;

    for line in stdout
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
    {
        let row: DockerDfRow = serde_json::from_str(line)
            .map_err(|error| format!("failed to parse docker system df output: {}", error))?;
        total_size_bytes =
            total_size_bytes.saturating_add(parse_size_to_bytes(&row.size).unwrap_or(0));
        total_reclaimable_bytes = total_reclaimable_bytes
            .saturating_add(parse_size_to_bytes(&row.reclaimable).unwrap_or(0));
        rows.push(row);
    }

    if rows.is_empty() {
        return Err("docker system df produced no parsable rows".to_string());
    }

    Ok(DockerDfSummary {
        rows,
        total_size_bytes,
        total_reclaimable_bytes,
    })
}

fn detect_docker_available_space(estimated_used_bytes: u64) -> Option<DockerAvailableSpace> {
    detect_docker_filesystem_space().or_else(|| detect_colima_allocated_space(estimated_used_bytes))
}

fn detect_docker_filesystem_space() -> Option<DockerAvailableSpace> {
    let root_dir_output = Command::new("docker")
        .args(["info", "--format", "{{.DockerRootDir}}"])
        .output()
        .ok()?;
    if !root_dir_output.status.success() {
        return None;
    }

    let docker_root_dir = String::from_utf8_lossy(&root_dir_output.stdout)
        .trim()
        .to_string();
    if docker_root_dir.is_empty() {
        return None;
    }

    let docker_root_path = Path::new(&docker_root_dir);
    if !docker_root_path.exists() {
        return None;
    }

    let df_output = Command::new("df")
        .args(["-Pk", &docker_root_dir])
        .output()
        .ok()?;
    if !df_output.status.success() {
        return None;
    }

    let df_stdout = String::from_utf8_lossy(&df_output.stdout);
    let data_line = df_stdout.lines().nth(1)?.trim();
    let columns: Vec<&str> = data_line.split_whitespace().collect();
    if columns.len() < 4 {
        return None;
    }

    let total_kib = columns.get(1)?.parse::<u64>().ok()?;
    let free_kib = columns.get(3)?.parse::<u64>().ok()?;

    Some(DockerAvailableSpace {
        free_bytes: free_kib.saturating_mul(1024),
        total_bytes: Some(total_kib.saturating_mul(1024)),
        source: format!("filesystem for {}", docker_root_dir),
    })
}

fn detect_colima_allocated_space(estimated_used_bytes: u64) -> Option<DockerAvailableSpace> {
    let output = Command::new("colima")
        .args(["status", "--json"])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }

    let status: Value = serde_json::from_slice(&output.stdout).ok()?;
    let total_bytes = status.get("disk")?.as_u64()?;
    let free_bytes = total_bytes.saturating_sub(estimated_used_bytes);

    Some(DockerAvailableSpace {
        free_bytes,
        total_bytes: Some(total_bytes),
        source:
            "computed as (`colima status --json`.disk) minus (`docker system df` total size)"
                .to_string(),
    })
}

fn parse_size_to_bytes(raw: &str) -> Option<u64> {
    let token = raw.split_whitespace().next()?.trim();
    if token.is_empty() {
        return None;
    }

    let unit_start = token
        .char_indices()
        .find_map(|(index, ch)| (ch.is_ascii_alphabetic()).then_some(index))
        .unwrap_or(token.len());

    let number_part = token[..unit_start].trim();
    let unit_part = token[unit_start..].trim();

    if number_part.is_empty() {
        return None;
    }

    let numeric_value = number_part.parse::<f64>().ok()?;
    let multiplier = match unit_part.to_ascii_lowercase().as_str() {
        "" | "b" => 1f64,
        "kb" | "kib" => 1024f64,
        "mb" | "mib" => 1024f64 * 1024f64,
        "gb" | "gib" => 1024f64 * 1024f64 * 1024f64,
        "tb" | "tib" => 1024f64 * 1024f64 * 1024f64 * 1024f64,
        "pb" | "pib" => 1024f64 * 1024f64 * 1024f64 * 1024f64 * 1024f64,
        _ => return None,
    };

    Some((numeric_value * multiplier).round() as u64)
}

fn format_bytes(bytes: u64) -> String {
    let units = ["B", "KiB", "MiB", "GiB", "TiB", "PiB"];
    let mut value = bytes as f64;
    let mut unit_index = 0usize;

    while value >= 1024f64 && unit_index < units.len() - 1 {
        value /= 1024f64;
        unit_index += 1;
    }

    if unit_index == 0 {
        format!("{} {}", bytes, units[unit_index])
    } else {
        format!("{:.2} {}", value, units[unit_index])
    }
}
