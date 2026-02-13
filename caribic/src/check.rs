use crate::{
    logger,
    setup::{download_osmosis, install_osmosisd},
};
use std::{env, path::{Path, PathBuf}, process::Command, time::Instant};

pub struct AuditReport {
    pub output: String,
    pub failed: usize,
}

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

pub fn run_security_audit(project_root_path: &Path) -> AuditReport {
    let checks = vec![
        (
            "Gateway npm audit",
            project_root_path.join("cardano/gateway"),
            "npm",
            vec!["audit"],
            "Install Node.js and npm to run this check.",
        ),
        (
            "Caribic cargo audit",
            project_root_path.join("caribic"),
            "cargo",
            vec!["audit"],
            "Install cargo-audit: cargo install cargo-audit.",
        ),
        (
            "Aiken validator check",
            project_root_path.join("cardano/onchain"),
            "aiken",
            vec!["check"],
            "Install Aiken to run this check.",
        ),
    ];

    let mut output = String::new();
    output.push_str("\nAudit Report\n");
    output.push_str("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n");

    let mut failed = 0;

    for (label, directory, command, args, install_hint) in checks {
        let started = Instant::now();
        let command_text = format!("{} {}", command, args.join(" "));

        if !directory.exists() {
            failed += 1;
            output.push_str(&format!("[FAIL] {}\n", label));
            output.push_str(&format!(
                "    Directory not found: {}\n\n",
                directory.display()
            ));
            continue;
        }

        let result = Command::new(command)
            .args(&args)
            .current_dir(&directory)
            .output();

        match result {
            Ok(run_output) if run_output.status.success() => {
                output.push_str(&format!(
                    "[OK] {} ({}s)\n",
                    label,
                    started.elapsed().as_secs()
                ));
                output.push_str(&format!("    {}\n", command_text));
                output.push_str(&format!("    {}\n\n", directory.display()));
            }
            Ok(run_output) => {
                failed += 1;
                output.push_str(&format!(
                    "[FAIL] {} ({}s)\n",
                    label,
                    started.elapsed().as_secs()
                ));
                output.push_str(&format!("    {}\n", command_text));
                output.push_str(&format!("    {}\n", directory.display()));
                output.push_str(&format!(
                    "    Exit code: {}\n",
                    run_output.status.code().unwrap_or(-1)
                ));

                let details = summarize_command_output(&run_output.stdout, &run_output.stderr);
                if details.is_empty() {
                    output.push_str("    No command output was captured.\n");
                } else {
                    output.push_str(&format!("    {}\n", details.replace('\n', "\n    ")));
                }

                if should_show_install_hint(&run_output.stdout, &run_output.stderr) {
                    output.push_str(&format!("    {}\n", install_hint));
                }
                output.push('\n');
            }
            Err(error) => {
                failed += 1;
                output.push_str(&format!(
                    "[FAIL] {} ({}s)\n",
                    label,
                    started.elapsed().as_secs()
                ));
                output.push_str(&format!("    {}\n", command_text));
                output.push_str(&format!("    {}\n", directory.display()));
                output.push_str(&format!("    Failed to execute command: {}\n", error));
                output.push_str(&format!("    {}\n\n", install_hint));
            }
        }
    }

    let passed = 3usize.saturating_sub(failed);
    output.push_str("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
    output.push_str(&format!(
        "Audit checks: 3 total, {} passed, {} failed\n",
        passed, failed
    ));

    AuditReport { output, failed }
}

fn summarize_command_output(stdout: &[u8], stderr: &[u8]) -> String {
    let stdout_text = String::from_utf8_lossy(stdout).trim().to_string();
    let stderr_text = String::from_utf8_lossy(stderr).trim().to_string();

    let mut sections = Vec::new();
    if !stdout_text.is_empty() {
        sections.push(format!("stdout:\n{}", stdout_text));
    }
    if !stderr_text.is_empty() {
        sections.push(format!("stderr:\n{}", stderr_text));
    }

    let combined = sections.join("\n");
    let lines: Vec<&str> = combined.lines().take(20).collect();
    if combined.lines().count() > lines.len() {
        format!("{}\n... (truncated)", lines.join("\n"))
    } else {
        lines.join("\n")
    }
}

fn should_show_install_hint(stdout: &[u8], stderr: &[u8]) -> bool {
    let combined = format!(
        "{}\n{}",
        String::from_utf8_lossy(stdout),
        String::from_utf8_lossy(stderr)
    )
    .to_ascii_lowercase();

    combined.contains("no such command: `audit`")
        || combined.contains("command not found")
        || combined.contains("not installed")
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

    if let Some(osmosisd_binary) = binary {
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

                if !is_path_visible_binary(&osmosisd_binary) {
                    logger::warn(&format!(
                        "osmosisd is installed at {} but not visible in PATH. Add '$HOME/go/bin' to PATH to avoid repeated install prompts.",
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

fn locate_osmosisd_binary() -> Option<PathBuf> {
    find_binary_in_path("osmosisd")
        .or_else(|| {
            dirs::home_dir().and_then(|home| {
                let binary = home.join("go/bin/osmosisd");
                binary.is_file().then_some(binary)
            })
        })
        .or_else(|| find_go_env_binary("GOBIN"))
        .or_else(|| find_go_env_binary("GOPATH"))
}

fn find_binary_in_path(binary_name: &str) -> Option<PathBuf> {
    let path_var = env::var_os("PATH")?;
    env::split_paths(&path_var).find_map(|directory| {
        let candidate = directory.join(binary_name);
        candidate.is_file().then_some(candidate)
    })
}

fn find_go_env_binary(env_name: &str) -> Option<PathBuf> {
    let output = Command::new("go")
        .args(["env", env_name])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }

    let value = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if value.is_empty() {
        return None;
    }

    if env_name == "GOBIN" {
        let candidate = PathBuf::from(value).join("osmosisd");
        candidate.is_file().then_some(candidate)
    } else {
        value.split(':').find_map(|entry| {
            let candidate = PathBuf::from(entry).join("bin").join("osmosisd");
            candidate.is_file().then_some(candidate)
        })
    }
}

fn is_path_visible_binary(binary_path: &Path) -> bool {
    if let Some(path_binary) = find_binary_in_path("osmosisd") {
        return path_binary == binary_path;
    }
    false
}
