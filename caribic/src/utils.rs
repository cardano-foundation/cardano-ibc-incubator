use crate::logger::{self, verbose};
use console::style;
use dirs::home_dir;
use indicatif::ProgressBar;
use indicatif::ProgressStyle;
use regex::Regex;
use reqwest::Client;
use serde_json::Value;
use std::collections::VecDeque;
use std::fs::File;
use std::fs::Permissions;
use std::io::BufRead;
use std::io::{self, BufReader, Write};
#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::thread;
use std::time::Duration;
use std::{collections::HashMap, fs};
use std::{error::Error, process::Output};
use tokio::io::AsyncWriteExt;
use zip::read::ZipArchive;

#[cfg(target_os = "linux")]
use nix::unistd::{Gid, Uid};

pub fn print_header() {
    println!(
        r#"
 ________  ________  ________  ___  ________  ___  ________     
|\   ____\|\   __  \|\   __  \|\  \|\   __  \|\  \|\   ____\    
\ \  \___|\ \  \|\  \ \  \|\  \ \  \ \  \|\ /\ \  \ \  \___|    
 \ \  \    \ \   __  \ \   _  _\ \  \ \   __  \ \  \ \  \       
  \ \  \____\ \  \ \  \ \  \\  \\ \  \ \  \|\  \ \  \ \  \____   Cardano IBC
   \ \_______\ \__\ \__\ \__\\ _\\ \__\ \_______\ \__\ \_______\ PFM IBC CLI
    \|_______|\|__|\|__|\|__|\|__|\|__|\|_______|\|__|\|_______| v0.2.0
    "#
    );
}

pub struct IndicatorMessage {
    pub message: String,
    pub step: String,
    pub emoji: String,
}

pub fn default_config_path() -> PathBuf {
    let mut config_path = home_dir().unwrap_or_else(|| PathBuf::from("~"));
    config_path.push(".caribic");
    config_path.push("config.json");
    config_path
}

pub fn get_cardano_tip_state(
    project_root_dir: &Path,
) -> Result<String, Box<dyn std::error::Error>> {
    let mut command = Command::new("docker");
    let query_output = command
        .current_dir(&project_root_dir.join("chains/cardano"))
        .args(&[
            "compose",
            "exec",
            "cardano-node",
            "cardano-cli",
            "query",
            "tip",
            "--cardano-mode",
            "--testnet-magic",
            "42",
        ]);

    let output = query_output.output().map_err(|error| {
        format!(
            "Failed to query tip from cardano-node: {}",
            error.to_string()
        )
    })?;

    if output.status.success() {
        verbose(&format!(
            "Querying tip from cardano-node: {}",
            String::from_utf8_lossy(&output.stdout)
        ));
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        Err(format!(
            "Failed to query tip from cardano-node: {}",
            String::from_utf8_lossy(&output.stderr)
        )
        .into())
    }
}

pub enum CardanoQuery {
    Epoch,
    Slot,
    SlotInEpoch,
    SlotsToEpochEnd,
}

impl CardanoQuery {
    fn as_str(&self) -> &'static str {
        match self {
            CardanoQuery::Epoch => "epoch",
            CardanoQuery::Slot => "slot",
            CardanoQuery::SlotInEpoch => "slotInEpoch",
            CardanoQuery::SlotsToEpochEnd => "slotsToEpochEnd",
        }
    }
}

pub fn get_cardano_state(
    project_root_dir: &Path,
    query: CardanoQuery,
) -> Result<u64, Box<dyn std::error::Error>> {
    let cardano_tip_state = get_cardano_tip_state(project_root_dir)?;
    let cardano_tip_json: Value = serde_json::from_str(&cardano_tip_state)?;
    let epoch_json = cardano_tip_json.get(query.as_str());
    if let Some(epoch) = epoch_json {
        if epoch.is_i64() {
            return Ok(epoch.as_i64().unwrap() as u64);
        } else {
            return Err(format!(
                "Failed to parse {} from cardano-node: {}",
                query.as_str(),
                cardano_tip_state
            )
            .into());
        }
    } else {
        return Err(format!(
            "Failed to extract {} from cardano-node: {}",
            query.as_str(),
            cardano_tip_state
        )
        .into());
    }
}

pub fn replace_text_in_file(path: &Path, pattern: &str, replacement: &str) -> io::Result<()> {
    let content = fs::read_to_string(path)?;
    let re = Regex::new(pattern).unwrap();
    let new_content = re.replace(&content, replacement).to_string();
    let mut file = fs::File::create(path)?;
    file.write_all(new_content.as_bytes())?;

    Ok(())
}

pub fn change_dir_permissions_read_only(
    dir: &Path,
    exclude_files: &Vec<&str>,
) -> std::io::Result<()> {
    if dir.is_dir() {
        for entry in fs::read_dir(dir)? {
            let entry = entry?;
            let path = entry.path();

            if path.is_dir() {
                change_dir_permissions_read_only(&path, &exclude_files)?;
            } else if path.is_file()
                && !exclude_files.contains(&path.file_name().unwrap().to_str().unwrap())
            {
                verbose(&format!(
                    "Set permissions to read-only for file: {}",
                    path.display()
                ));
                set_read_only(&path)?;
            }
        }
    }
    Ok(())
}

#[cfg(unix)]
fn set_read_only(path: &Path) -> std::io::Result<()> {
    let permissions = Permissions::from_mode(0o400);
    fs::set_permissions(path, permissions)
}

#[cfg(windows)]
fn set_read_only(path: &Path) -> std::io::Result<()> {
    let mut permissions = fs::metadata(path)?.permissions();
    permissions.set_readonly(true);
    fs::set_permissions(path, permissions)
}

pub fn wait_until_file_exists(
    file_path: &Path,
    retries: u32,
    interval: u64,
    retry_command: impl Fn() -> (),
) -> Result<(), String> {
    let mut file_exists = file_path.exists();
    for _ in 0..retries {
        if file_exists {
            return Ok(());
        }
        retry_command();

        thread::sleep(Duration::from_millis(interval));
        file_exists = file_path.exists();
    }
    Err(format!("File {} does not exist", file_path.display()))
}

pub async fn download_file(
    url: &str,
    path: &Path,
    indicator_message: Option<IndicatorMessage>,
) -> Result<(), Box<dyn Error>> {
    let client = Client::builder().no_proxy().build()?;
    let mut response = client.get(url).send().await?.error_for_status()?;

    let total_size = response.content_length();
    let mut fallback_message = String::from("Downloading ...");

    if let Some(indicator_message) = indicator_message {
        println!(
            "{} {}{}",
            style(indicator_message.step).bold().dim(),
            indicator_message.emoji,
            indicator_message.message
        );
        fallback_message = indicator_message.message;
    }

    let progress_bar = match total_size {
        Some(size) => ProgressBar::new(size),
        None => ProgressBar::new_spinner().with_message(fallback_message),
    };

    let mut file = tokio::fs::File::create(path).await?;
    while let Some(chunk) = response.chunk().await? {
        file.write_all(&chunk).await?;
        progress_bar.inc(chunk.len() as u64);
    }

    progress_bar.finish_with_message(format!("Downloaded {} to {}", url, path.to_string_lossy()));
    return Ok(());
}

pub fn delete_file(file_path: &Path) -> io::Result<()> {
    fs::remove_file(file_path)
}

pub async fn wait_for_health_check(
    url: &str,
    retries: u32,
    interval: u64,
    custom_condition: Option<impl Fn(&String) -> bool>,
) -> Result<(), String> {
    let client = Client::builder()
        .no_proxy()
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {e}"))?;

    for retry in 0..retries {
        let response = client.get(url).send().await;

        match response {
            Ok(resp) if resp.status().is_success() => match custom_condition {
                Some(ref condition) => {
                    let body = resp.text().await.unwrap_or_default();
                    if condition(&body) {
                        verbose(&format!(
                            "Health on {} check passed on retry {}",
                            url,
                            retry + 1
                        ));
                        return Ok(());
                    }
                }
                None => {
                    verbose(&format!(
                        "Health on {} check passed on retry {}",
                        url,
                        retry + 1
                    ));
                    return Ok(());
                }
            },
            Ok(resp) => {
                verbose(&format!(
                    "Health check {} failed with status: {} on retry {}",
                    url,
                    resp.status(),
                    retry + 1
                ));
            }
            Err(e) => {
                verbose(&format!(
                    "Failed to send request to {} on retry {}: {}",
                    url,
                    retry + 1,
                    e
                ));
            }
        }

        thread::sleep(Duration::from_millis(interval));
    }

    return Err(format!(
        "Health check on {} failed after {} attempts",
        url, retries
    ));
}

pub fn execute_script(
    script_dir: &Path,
    script_name: &str,
    script_args: Vec<&str>,
    script_env: Option<Vec<(&str, &str)>>,
) -> io::Result<String> {
    let script_args_display = script_args.join(" ");
    logger::verbose(&format!(
        "{} {} {}",
        script_dir.display(),
        script_name,
        script_args_display
    ));
    let envs = script_env.unwrap_or_default();

    let mut cmd = Command::new(script_name)
        .current_dir(script_dir)
        .args(script_args)
        .envs(envs)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?;

    let stdout = cmd.stdout.take().expect("Failed to capture stdout");
    let stderr = cmd.stderr.take().expect("Failed to capture stderr");

    let stdout_reader = io::BufReader::new(stdout);
    let stderr_reader = io::BufReader::new(stderr);

    let mut output = String::new();
    let mut stderr_output = String::new();
    for line in stdout_reader.lines() {
        let line = line?;
        output.push_str(&line);
        output.push('\n');
        logger::info(&line);
    }

    for line in stderr_reader.lines() {
        let line = line?;
        stderr_output.push_str(&line);
        stderr_output.push('\n');
        logger::info(&line);
    }

    let status = cmd.wait()?;
    logger::info(&format!("Script exited with status: {}", status));
    if !status.success() {
        return Err(io::Error::new(
            io::ErrorKind::Other,
            format!(
                "Command failed (status={}): {} {}\nstdout:\n{}\nstderr:\n{}",
                status,
                script_name,
                script_args_display,
                output.trim(),
                stderr_output.trim()
            ),
        ));
    }
    Ok(output)
}

pub fn execute_script_interactive(
    script_dir: &Path,
    script_name: &str,
    script_args: Vec<&str>,
) -> Result<(), Box<dyn std::error::Error>> {
    let script_args_display = script_args.join(" ");
    let status = Command::new(script_name)
        .current_dir(script_dir)
        .args(&script_args)
        .status()?;

    if !status.success() {
        return Err(io::Error::new(
            io::ErrorKind::Other,
            format!(
                "Command failed (status={}): {} {}",
                status, script_name, script_args_display
            ),
        )
        .into());
    }

    Ok(())
}

pub fn execute_script_with_progress(
    script_dir: &Path,
    script_name: &str,
    script_args: Vec<&str>,
    start_message: &str,
) -> Result<(), Box<dyn std::error::Error>> {
    let progress_bar = ProgressBar::new_spinner();
    progress_bar.enable_steady_tick(Duration::from_millis(100));
    progress_bar.set_style(
        ProgressStyle::with_template("{prefix:.bold} {spinner} {wide_msg}")
            .unwrap()
            .tick_chars("⠁⠂⠄⡀⢀⠠⠐⠈ "),
    );

    progress_bar.set_prefix(start_message.to_owned());

    let mut command = Command::new(script_name)
        .current_dir(script_dir)
        .args(script_args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("Failed to initialize localnet: {}", error))?;

    match logger::get_verbosity() {
        logger::Verbosity::Verbose => {
            let stdout = command.stdout.as_mut().expect("Failed to open stdout");
            let reader = BufReader::new(stdout);

            for line in reader.lines() {
                let line = line.unwrap_or_else(|_| "Failed to read line".to_string());
                progress_bar.set_message(format!("{}", line.trim()));
            }
        }
        logger::Verbosity::Info => {
            let mut last_lines = VecDeque::with_capacity(5);

            if let Some(stdout) = command.stdout.take() {
                let reader = BufReader::new(stdout);

                for line in reader.lines() {
                    let line = line.unwrap_or_else(|_| "Failed to read line".to_string());
                    if last_lines.len() == 5 {
                        last_lines.pop_front();
                    }
                    last_lines.push_back(line);
                    let output = last_lines
                        .iter()
                        .cloned()
                        .collect::<Vec<String>>()
                        .join("\n");

                    progress_bar.set_message(format!("{}", output));
                }
            }
        }
        logger::Verbosity::Standard => {
            if let Some(stdout) = command.stdout.take() {
                let reader = BufReader::new(stdout);

                for line in reader.lines() {
                    let last_line = line.unwrap_or_else(|_| "Failed to read line".to_string());
                    progress_bar.set_message(format!("{}", last_line.trim()));
                }
            }
        }
        _ => {}
    }

    let status = command
        .wait()
        .map_err(|error| format!("Command wasn't running: {}", error))?;
    progress_bar.finish_and_clear();
    if status.success() {
        Ok(())
    } else {
        let mut error_output = String::new();
        if let Some(stderr) = command.stderr.take() {
            let reader = BufReader::new(stderr);
            for line in reader.lines() {
                let line = line.unwrap_or_else(|_| "Failed to read line".to_string());
                error_output.push_str(&line);
            }
            Err(error_output.into())
        } else {
            Err("Failed to execute script".into())
        }
    }
}

pub fn unzip_file(file_path: &Path, destination: &Path) -> Result<(), Box<dyn std::error::Error>> {
    // Open the ZIP file
    let file = File::open(file_path)?;
    let mut archive = ZipArchive::new(BufReader::new(file))?;

    let file_count = archive.len();
    let progress_bar = ProgressBar::new(file_count as u64);

    let mut root_folder: Option<PathBuf> = None;

    for i in 0..file_count {
        let mut file = archive.by_index(i)?;
        let outpath = destination.join(file.name());

        if i == 1 {
            if let Some(parent) = outpath.parent() {
                root_folder = Some(parent.to_path_buf());
            }
        }

        if file.name().ends_with('/') {
            fs::create_dir_all(&outpath)?;
        } else {
            if let Some(p) = outpath.parent() {
                if !p.exists() {
                    fs::create_dir_all(&p)?;
                }
            }
            let mut outfile = File::create(&outpath)?;
            io::copy(&mut file, &mut outfile)?;
        }

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            if let Some(mode) = file.unix_mode() {
                fs::set_permissions(&outpath, fs::Permissions::from_mode(mode))?;
            }
        }

        progress_bar.set_message(file.name().to_string());
        progress_bar.inc(1);
    }

    if let Some(root_folder) = root_folder {
        if root_folder != *destination {
            for entry in fs::read_dir(&root_folder)? {
                let entry = entry?;
                let path = entry.path();
                let file_name = path.file_name().unwrap(); // safe unwrap
                let new_path = destination.join(file_name);
                fs::rename(path, new_path)?;
            }
            fs::remove_dir_all(root_folder)?;
        }
    }

    Ok(())
}

/// Parses a Tendermint client id from Hermes output text.
pub fn parse_tendermint_client_id(output: &str) -> Option<String> {
    let regex = Regex::new(r#"client_id:\s*ClientId\(\s*"([^"]+)""#).ok()?;
    let captures = regex.captures(output)?;
    Some(captures.get(1)?.as_str().to_string())
}

/// Parses a Tendermint connection id from Hermes output text.
pub fn parse_tendermint_connection_id(output: &str) -> Option<String> {
    let regex = Regex::new(r#"\s*(connection-\d+)"#).ok()?;
    let captures = regex.captures(output)?;
    Some(captures.get(1)?.as_str().to_string())
}

/// Parses a Tendermint client id from Hermes process output.
pub fn extract_tendermint_client_id(output: Output) -> Option<String> {
    if output.status.success() {
        return parse_tendermint_client_id(String::from_utf8_lossy(&output.stdout).as_ref());
    }
    None
}

/// Parses a Tendermint connection id from Hermes process output.
pub fn extract_tendermint_connection_id(output: Output) -> Option<String> {
    if output.status.success() {
        return parse_tendermint_connection_id(String::from_utf8_lossy(&output.stdout).as_ref());
    }
    None
}

pub fn query_balance(project_root_path: &Path, address: &str) -> u64 {
    let cardano_dir = project_root_path.join("chains/cardano");

    let cardano_cli_args = vec!["compose", "exec", "cardano-node", "cardano-cli"];
    let build_address_args = vec![
        "query",
        "utxo",
        "--address",
        address,
        "--testnet-magic",
        "42",
        "--output-json",
    ];
    let balance = Command::new("docker")
        .current_dir(cardano_dir)
        .args(&cardano_cli_args)
        .args(build_address_args)
        .output()
        .expect("Failed to build address")
        .stdout;

    let v: HashMap<String, Value> =
        serde_json::from_str(String::from_utf8(balance).unwrap().as_str()).unwrap();

    v.values()
        .map(|k| k["value"]["lovelace"].as_u64().unwrap())
        .sum()
}

/// Check if a Docker container is running and healthy
pub fn check_container_status(container_name: &str) -> Result<String, Box<dyn Error>> {
    let output = Command::new("docker")
        .args(["inspect", "--format", "{{.State.Status}}", container_name])
        .output()?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        Err(format!("Failed to inspect container {}", container_name).into())
    }
}

/// Get the last N lines of Docker container logs
pub fn get_container_logs(container_name: &str, lines: usize) -> Result<String, Box<dyn Error>> {
    let output = Command::new("docker")
        .args(["logs", "--tail", &lines.to_string(), container_name])
        .output()?;

    Ok(String::from_utf8_lossy(&output.stderr).to_string())
}

/// Check if a container has exited and return the exit code
pub fn get_container_exit_code(container_name: &str) -> Result<Option<i32>, Box<dyn Error>> {
    let output = Command::new("docker")
        .args(["inspect", "--format", "{{.State.ExitCode}}", container_name])
        .output()?;

    if output.status.success() {
        let exit_code_str = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if let Ok(code) = exit_code_str.parse::<i32>() {
            if code != 0 {
                return Ok(Some(code));
            }
        }
    }
    Ok(None)
}

/// Check if container logs contain errors that require immediate intervention
fn has_unrecoverable_error(logs: &str) -> bool {
    logs.contains("permission denied")
        || logs.contains("Permission denied")
        || logs.contains("bind: address already in use")
        || logs.contains("no space left on device")
        || logs.contains("command not found")
        || logs.contains("No such file or directory")
}

/// Diagnose why Docker containers failed to start
/// Returns (diagnostics_string, should_fail_fast)
pub fn diagnose_container_failure(container_names: &[&str]) -> (String, bool) {
    let mut diagnostics = String::new();
    let mut should_fail_fast = false;

    for container_name in container_names {
        match check_container_status(container_name) {
            Ok(status) => {
                if status != "running" {
                    diagnostics.push_str(&format!(
                        "\n\nContainer '{}' is not running (status: {})",
                        container_name, status
                    ));

                    // Get exit code if container exited
                    if let Ok(Some(exit_code)) = get_container_exit_code(container_name) {
                        diagnostics.push_str(&format!("\n   Exit code: {}", exit_code));
                    }

                    // Get last 20 lines of logs
                    if let Ok(logs) = get_container_logs(container_name, 20) {
                        // Check for errors that require immediate intervention
                        if logs.contains("permission denied") || logs.contains("Permission denied")
                        {
                            diagnostics.push_str("\n   PERMISSION ERROR detected - requires fixing volume/socket permissions");
                            should_fail_fast = true;
                        }
                        if logs.contains("bind: address already in use") {
                            diagnostics.push_str("\n   PORT CONFLICT detected - requires stopping conflicting services");
                            should_fail_fast = true;
                        }
                        if logs.contains("no space left on device") {
                            diagnostics.push_str(
                                "\n   DISK SPACE ERROR detected - requires freeing up disk space",
                            );
                            should_fail_fast = true;
                        }

                        // Determine if we should fail fast based on container state and error type
                        if has_unrecoverable_error(&logs) {
                            // Unrecoverable errors should always fail fast, regardless of container state
                            diagnostics.push_str("\n   UNRECOVERABLE ERROR detected - requires developer intervention");
                            should_fail_fast = true;
                        } else if status == "restarting" {
                            // Container is restarting with transient errors, Docker may recover
                            diagnostics.push_str(
                                "\n   Container is restarting, Docker may recover automatically",
                            );
                            should_fail_fast = false;
                        }

                        diagnostics.push_str(&format!(
                            "\n   Last log entries:\n{}",
                            logs.lines()
                                .take(10)
                                .map(|line| format!("   {}", line))
                                .collect::<Vec<_>>()
                                .join("\n")
                        ));
                    }
                }
            }
            Err(e) => {
                diagnostics.push_str(&format!(
                    "\n\nFailed to check container '{}': {}",
                    container_name, e
                ));
            }
        }
    }

    if diagnostics.is_empty() {
        diagnostics
            .push_str("\n\nAll containers appear to be running, but services are not responding.");
        diagnostics.push_str(
            "\n   This might be a network issue or the services need more time to initialize.",
        );
    }

    (diagnostics, should_fail_fast)
}

/// Get current user's UID and GID for Docker containers
/// - macOS: Returns 0:0 (root) for compatibility
/// - Linux: Returns actual user UID/GID
/// - Windows: Returns default 1000:1000
pub fn get_user_ids() -> (String, String) {
    #[cfg(target_os = "macos")]
    {
        // Use root permissions on macOS
        ("0".to_string(), "0".to_string())
    }

    #[cfg(target_os = "linux")]
    {
        // Use actual user UID/GID on Linux
        let uid = Uid::current().as_raw();
        let gid = Gid::current().as_raw();
        (uid.to_string(), gid.to_string())
    }

    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    {
        // Default UID/GID for other systems (Windows, etc.)
        ("1000".to_string(), "1000".to_string())
    }
}
