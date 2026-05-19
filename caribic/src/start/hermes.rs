use crate::config;
use crate::logger::{self, log, log_or_show_progress};
use crate::process::hermes::HermesCli;
use crate::process::system::SystemChecks;
use dirs::home_dir;
use indicatif::{ProgressBar, ProgressStyle};
use std::fs::{self, OpenOptions};
#[cfg(unix)]
use std::os::unix::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Output, Stdio};
use std::thread;
use std::time::{Duration, Instant};

const HERMES_PROGRESS_LOG_INTERVAL_SECS: u64 = 30;
const HERMES_PID_FILE_NAME: &str = "hermes.pid";
const HERMES_STARTUP_CHECK_ATTEMPTS: u32 = 5;
const HERMES_STARTUP_CHECK_INTERVAL_MILLIS: u64 = 1000;
const CARDANO_PREPROD_CHAIN_ID: &str = "cardano-preprod";
const INJECTIVE_TESTNET_CHAIN_ID: &str = "injective-888";

pub(crate) fn hermes_pid_file_path() -> Option<PathBuf> {
    home_dir().map(|home| home.join(".hermes").join(HERMES_PID_FILE_NAME))
}

pub(crate) fn read_hermes_pid_file() -> Option<u32> {
    let pid_file = hermes_pid_file_path()?;
    let contents = fs::read_to_string(pid_file).ok()?;
    contents.trim().parse::<u32>().ok()
}

pub(crate) fn write_hermes_pid_file(pid: u32) -> Result<(), String> {
    let pid_file = hermes_pid_file_path().ok_or("Could not determine home directory")?;
    if let Some(parent) = pid_file.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create Hermes runtime directory: {}", e))?;
    }
    fs::write(&pid_file, format!("{}\n", pid)).map_err(|e| {
        format!(
            "Failed to write Hermes pid file '{}': {}",
            pid_file.display(),
            e
        )
    })
}

pub(crate) fn remove_hermes_pid_file() {
    if let Some(pid_file) = hermes_pid_file_path() {
        if pid_file.exists() {
            let _ = fs::remove_file(pid_file);
        }
    }
}

pub(crate) fn is_process_alive(pid: u32) -> bool {
    SystemChecks::is_process_alive(pid)
}

pub(crate) fn process_command(pid: u32) -> Option<String> {
    SystemChecks::process_command(pid)
}

pub(crate) fn is_expected_hermes_daemon_pid(pid: u32, expected_binary_path: Option<&str>) -> bool {
    process_command(pid)
        .map(|command| is_hermes_daemon_command(command.as_str(), expected_binary_path))
        .unwrap_or(false)
}

pub(crate) fn is_hermes_daemon_command(command: &str, expected_binary_path: Option<&str>) -> bool {
    let normalized_command = command.trim();
    if normalized_command.is_empty() || !normalized_command.contains("--config") {
        return false;
    }

    if let Some(path) = expected_binary_path {
        if normalized_command.starts_with(path) {
            return normalized_command.ends_with(" start");
        }
    }

    normalized_command.contains("hermes") && normalized_command.ends_with(" start")
}

fn hermes_config_chain_ids(config: &str) -> Vec<String> {
    let mut chain_ids = Vec::new();
    let mut in_chain_block = false;

    for raw_line in config.lines() {
        let line = raw_line.trim();

        if line == "[[chains]]" {
            in_chain_block = true;
            continue;
        }

        if line.starts_with("[[") {
            in_chain_block = false;
            continue;
        }

        if !in_chain_block {
            continue;
        }

        let Some((key, value)) = line.split_once('=') else {
            continue;
        };

        if key.trim() != "id" {
            continue;
        }

        let chain_id = value.trim().trim_matches('"').trim_matches('\'').trim();
        if !chain_id.is_empty() {
            chain_ids.push(chain_id.to_owned());
        }
    }

    chain_ids
}

fn validate_preprod_hermes_route_coverage(
    hermes_config: &Path,
) -> Result<(), Box<dyn std::error::Error>> {
    let config = fs::read_to_string(hermes_config).map_err(|error| {
        format!(
            "Failed to read Hermes config '{}': {}",
            hermes_config.display(),
            error
        )
    })?;
    let chain_ids = hermes_config_chain_ids(&config);

    if !chain_ids.iter().any(|id| id == CARDANO_PREPROD_CHAIN_ID) {
        return Ok(());
    }

    let required_chain_ids = [INJECTIVE_TESTNET_CHAIN_ID];
    let missing_chain_ids: Vec<&str> = required_chain_ids
        .iter()
        .copied()
        .filter(|required| !chain_ids.iter().any(|id| id == required))
        .collect();

    if missing_chain_ids.is_empty() {
        return Ok(());
    }

    let found_chain_ids = if chain_ids.is_empty() {
        "none".to_owned()
    } else {
        chain_ids.join(", ")
    };

    Err(format!(
        "Invalid Hermes route for Cardano preprod swaps.\n\
         Found chains: {}\n\
         Missing chains: {}\n\
         Configure the Injective testnet route before starting Hermes.",
        found_chain_ids,
        missing_chain_ids.join(", ")
    )
    .into())
}

fn run_hermes_command_with_progress(
    hermes_binary: &Path,
    args: &[&str],
) -> Result<Output, Box<dyn std::error::Error>> {
    run_hermes_command_with_progress_and_timeout(hermes_binary, args, None)
}

fn run_hermes_command_with_progress_and_timeout(
    hermes_binary: &Path,
    args: &[&str],
    timeout: Option<Duration>,
) -> Result<Output, Box<dyn std::error::Error>> {
    let hermes = HermesCli::new(hermes_binary);
    let heartbeat_interval = Duration::from_secs(HERMES_PROGRESS_LOG_INTERVAL_SECS);
    match timeout {
        Some(timeout) => {
            hermes.output_with_progress_and_timeout(None, args, heartbeat_interval, Some(timeout))
        }
        None => hermes.output_with_progress(None, args, heartbeat_interval),
    }
    .map_err(Into::into)
}

/// Resolves the Hermes binary from the relayer build output and fails if missing.
fn require_relayer_hermes_binary() -> Result<PathBuf, Box<dyn std::error::Error>> {
    let project_root = PathBuf::from(config::get_config().project_root);
    let hermes_binary = project_root.join("relayer/target/release/hermes");
    if !hermes_binary.exists() {
        return Err(format!(
            "Hermes binary not found at {}. Run 'caribic start bridge' first to build it.",
            hermes_binary.display()
        )
        .into());
    }
    Ok(hermes_binary)
}

/// Runs one Hermes command against the relayer build output.
pub fn run_hermes_command(args: &[&str]) -> Result<Output, Box<dyn std::error::Error>> {
    let hermes_binary = require_relayer_hermes_binary()?;
    let started_at = Instant::now();
    logger::verbose(&format!(
        "Running Hermes command: {} {}",
        hermes_binary.display(),
        args.join(" ")
    ));

    let output = run_hermes_command_with_progress(&hermes_binary, args)?;

    let elapsed = started_at.elapsed();
    if elapsed >= Duration::from_secs(HERMES_PROGRESS_LOG_INTERVAL_SECS) {
        log(&format!(
            "Hermes command completed in {}s: {}",
            elapsed.as_secs(),
            args.join(" ")
        ));
    }

    logger::verbose(&format!(
        "Hermes command completed in {:.2}s (success={})",
        elapsed.as_secs_f32(),
        output.status.success()
    ));
    logger::verbose(&format!(
        "Hermes stdout: {}",
        String::from_utf8_lossy(&output.stdout).trim()
    ));
    logger::verbose(&format!(
        "Hermes stderr: {}",
        String::from_utf8_lossy(&output.stderr).trim()
    ));

    Ok(output)
}

pub fn run_hermes_command_with_timeout(
    args: &[&str],
    timeout: Duration,
) -> Result<Output, Box<dyn std::error::Error>> {
    let hermes_binary = require_relayer_hermes_binary()?;
    let started_at = Instant::now();
    logger::verbose(&format!(
        "Running Hermes command with timeout={}s: {} {}",
        timeout.as_secs(),
        hermes_binary.display(),
        args.join(" ")
    ));

    let output = run_hermes_command_with_progress_and_timeout(&hermes_binary, args, Some(timeout))?;

    let elapsed = started_at.elapsed();
    if elapsed >= Duration::from_secs(HERMES_PROGRESS_LOG_INTERVAL_SECS) {
        log(&format!(
            "Hermes timed command completed in {}s: {}",
            elapsed.as_secs(),
            args.join(" ")
        ));
    }

    logger::verbose(&format!(
        "Hermes timed command completed in {:.2}s (success={})",
        elapsed.as_secs_f32(),
        output.status.success()
    ));

    Ok(output)
}

/// Start Hermes daemon in the background
pub fn start_hermes_daemon() -> Result<(), Box<dyn std::error::Error>> {
    let optional_progress_bar = match logger::get_verbosity() {
        logger::Verbosity::Verbose => None,
        _ => Some(ProgressBar::new_spinner()),
    };

    if let Some(progress_bar) = &optional_progress_bar {
        progress_bar.enable_steady_tick(Duration::from_millis(100));
        progress_bar.set_style(
            ProgressStyle::with_template("{prefix:.bold} {spinner} [{elapsed_precise}] {wide_msg}")
                .map_err(|error| format!("Failed to configure Hermes progress output: {error}"))?
                .tick_chars("⠁⠂⠄⡀⢀⠠⠐⠈ "),
        );
        progress_bar.set_prefix("Starting Hermes daemon ...".to_owned());
    } else {
        log("Starting Hermes daemon ...");
    }

    let hermes_binary = require_relayer_hermes_binary()?;

    let home_path = home_dir().ok_or("Could not determine home directory")?;
    let hermes_log = home_path.join(".hermes/hermes.log");
    let hermes_config = home_path.join(".hermes/config.toml");
    let hermes_err_log = hermes_log.with_extension("err");
    let expected_binary_str = hermes_binary.to_str();

    validate_preprod_hermes_route_coverage(&hermes_config)?;

    if let Some(existing_pid) = read_hermes_pid_file() {
        if is_process_alive(existing_pid)
            && is_expected_hermes_daemon_pid(existing_pid, expected_binary_str)
        {
            log_or_show_progress(
                &format!("Hermes daemon already running (pid={})", existing_pid),
                &optional_progress_bar,
            );
            if let Some(progress_bar) = &optional_progress_bar {
                progress_bar.finish_and_clear();
            }
            return Ok(());
        }
        remove_hermes_pid_file();
    }

    // Validate config before starting
    log_or_show_progress("Validating Hermes configuration", &optional_progress_bar);
    let config_check = HermesCli::new(hermes_binary.as_path()).output(
        None,
        &[
            "--config",
            hermes_config.to_str().ok_or("Invalid Hermes config path")?,
            "config",
            "validate",
        ],
    );

    if let Ok(output) = config_check {
        if !output.status.success() {
            let error_msg = String::from_utf8_lossy(&output.stderr);
            return Err(format!("Hermes configuration is invalid:\n{}", error_msg).into());
        }
        log_or_show_progress(
            "Configuration validated successfully",
            &optional_progress_bar,
        );
    }

    log_or_show_progress("Launching Hermes daemon process", &optional_progress_bar);

    fs::create_dir_all(home_path.join(".hermes"))
        .map_err(|e| format!("Failed to create Hermes runtime directory: {}", e))?;
    let _ = fs::remove_file(&hermes_err_log);

    let hermes_stdout = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&hermes_log)
        .map_err(|e| {
            format!(
                "Failed to open Hermes log '{}': {}",
                hermes_log.display(),
                e
            )
        })?;
    let hermes_stderr = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&hermes_err_log)
        .map_err(|e| {
            format!(
                "Failed to open Hermes error log '{}': {}",
                hermes_err_log.display(),
                e
            )
        })?;
    let dev_null = OpenOptions::new()
        .read(true)
        .open("/dev/null")
        .map_err(|e| format!("Failed to open /dev/null for Hermes stdin: {}", e))?;

    let mut child_command = Command::new(&hermes_binary);
    child_command
        .args([
            "--config",
            hermes_config.to_str().ok_or("Invalid Hermes config path")?,
            "start",
        ])
        .stdin(Stdio::from(dev_null))
        .stdout(Stdio::from(hermes_stdout))
        .stderr(Stdio::from(hermes_stderr));

    #[cfg(unix)]
    {
        // Put Hermes into its own process group so `caribic` exiting does not keep it tied
        // to the caller's foreground job control state.
        child_command.process_group(0);
    }

    let child = child_command
        .spawn()
        .map_err(|e| format!("Failed to launch Hermes daemon: {}", e))?;
    let pid = child.id();
    drop(child);
    write_hermes_pid_file(pid)?;

    log(&format!("Hermes started (PID: {})", pid));
    log(&format!("   Logs: {}", hermes_log.display()));
    log("   Monitor: tail -f ~/.hermes/hermes.log");

    // Verify Hermes survives a short startup window and that the tracked pid really is the
    // expected Hermes daemon command, not just a short-lived child that happened to exist.
    log_or_show_progress("Verifying daemon startup", &optional_progress_bar);
    let mut is_running = false;
    for _ in 0..HERMES_STARTUP_CHECK_ATTEMPTS {
        thread::sleep(Duration::from_millis(HERMES_STARTUP_CHECK_INTERVAL_MILLIS));
        if is_process_alive(pid) && is_expected_hermes_daemon_pid(pid, expected_binary_str) {
            is_running = true;
            break;
        }
    }

    if !is_running {
        remove_hermes_pid_file();
        let error_content = std::fs::read_to_string(&hermes_err_log)
            .unwrap_or_else(|_| "Could not read error log".to_string());
        return Err(format!(
            "Hermes daemon exited immediately (pid={}):\n{}",
            pid,
            error_content
                .lines()
                .take(10)
                .collect::<Vec<_>>()
                .join("\n")
        )
        .into());
    }
    log_or_show_progress("Hermes daemon is running", &optional_progress_bar);

    if let Some(progress_bar) = &optional_progress_bar {
        progress_bar.finish_and_clear();
    }

    Ok(())
}

/// Add a key to Hermes keyring via caribic
pub fn hermes_keys_add(
    chain: &str,
    mnemonic_file: &Path,
    key_name: Option<&str>,
    hd_path: Option<&str>,
    overwrite: bool,
) -> Result<String, Box<dyn std::error::Error>> {
    if !mnemonic_file.exists() {
        return Err(format!("Mnemonic file not found: {}", mnemonic_file.display()).into());
    }

    log(&format!("Adding key for chain '{}'...", chain));

    let mut args = vec!["keys", "add", "--chain", chain, "--mnemonic-file"];
    let mnemonic_file = mnemonic_file.to_str().ok_or_else(|| {
        format!(
            "Mnemonic path is not valid UTF-8: {}",
            mnemonic_file.display()
        )
    })?;
    args.push(mnemonic_file);

    if let Some(name) = key_name {
        args.push("--key-name");
        args.push(name);
    }

    if let Some(path) = hd_path {
        args.push("--hd-path");
        args.push(path);
    }

    if overwrite {
        args.push("--overwrite");
    }

    let output = run_hermes_command(&args)?;

    if !output.status.success() {
        return Err(format!(
            "Failed to add key: {}",
            String::from_utf8_lossy(&output.stderr)
        )
        .into());
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    Ok(format!("Key added for chain '{}'\n{}", chain, stdout))
}

/// Parse a Hermes key list "- key_name (address)" into (key_name, address)
fn parse_hermes_key_line(line: &str) -> Option<(String, String)> {
    let line = line.trim();
    if !line.starts_with('-') && !line.starts_with("SUCCESS") {
        return None;
    }

    // Skip "SUCCESS" lines
    if line.starts_with("SUCCESS") {
        return None;
    }

    // Format: "- key_name (address)"
    let line = line.trim_start_matches('-').trim();
    if let Some(paren_pos) = line.find('(') {
        let key_name = line[..paren_pos].trim().to_string();
        let address = line[paren_pos..]
            .trim_matches(|c| c == '(' || c == ')')
            .to_string();
        if !key_name.is_empty() && !address.is_empty() {
            return Some((key_name, address));
        }
    }
    None
}

fn parse_toml_quoted_assignment(line: &str, key: &str) -> Option<String> {
    let (lhs, rhs) = line.split_once('=')?;
    if lhs.trim() != key {
        return None;
    }

    let rhs = rhs.trim();
    let quote = rhs.chars().next()?;
    if quote != '\'' && quote != '"' {
        return None;
    }

    let value = &rhs[1..];
    let end = value.find(quote)?;
    Some(value[..end].to_string())
}

fn hermes_chain_ids_from_config() -> Result<Vec<String>, Box<dyn std::error::Error>> {
    let home = home_dir().ok_or("Could not determine home directory")?;
    let config_path = home.join(".hermes").join("config.toml");
    let config_contents = fs::read_to_string(&config_path).map_err(|error| {
        format!(
            "Failed to read Hermes config at {}: {}",
            config_path.display(),
            error
        )
    })?;

    let mut chain_ids = Vec::new();
    let mut in_chain_block = false;
    let mut current_chain_id: Option<String> = None;

    for raw_line in config_contents.lines() {
        let line = raw_line.split('#').next().unwrap_or("").trim();
        if line.is_empty() {
            continue;
        }

        if line == "[[chains]]" {
            if let Some(id) = current_chain_id.take() {
                chain_ids.push(id);
            }
            in_chain_block = true;
            continue;
        }

        if line.starts_with("[[") {
            if let Some(id) = current_chain_id.take() {
                chain_ids.push(id);
            }
            in_chain_block = false;
            continue;
        }

        if in_chain_block && current_chain_id.is_none() {
            if let Some(id) = parse_toml_quoted_assignment(line, "id") {
                current_chain_id = Some(id);
            }
        }
    }

    if let Some(id) = current_chain_id.take() {
        chain_ids.push(id);
    }

    let mut unique_chain_ids = Vec::new();
    for id in chain_ids {
        if !unique_chain_ids.contains(&id) {
            unique_chain_ids.push(id);
        }
    }

    if unique_chain_ids.is_empty() {
        return Err(format!(
            "No [[chains]] ids found in Hermes config at {}",
            config_path.display()
        )
        .into());
    }

    Ok(unique_chain_ids)
}

/// List keys in Hermes keyring via caribic
pub fn hermes_keys_list(chain: Option<&str>) -> Result<String, Box<dyn std::error::Error>> {
    if let Some(chain_id) = chain {
        log(&format!("Listing keys for chain '{}'...", chain_id));

        let output = run_hermes_command(&["keys", "list", "--chain", chain_id])?;

        if !output.status.success() {
            return Err(format!(
                "Failed to list keys: {}",
                String::from_utf8_lossy(&output.stderr)
            )
            .into());
        }

        let output_str = String::from_utf8_lossy(&output.stdout).to_string();
        if output_str.trim().is_empty() {
            Ok(format!("No keys found for chain '{}'.\n\nTo add a key, use:\n  caribic keys add --chain {} --mnemonic-file <path>\n", chain_id, chain_id))
        } else {
            Ok(output_str)
        }
    } else {
        // List keys for all chains currently present in ~/.hermes/config.toml
        log("Listing keys for all chains...");

        let chain_ids = hermes_chain_ids_from_config()?;
        let mut result = String::new();
        let mut found_any_keys = false;

        for chain_id in chain_ids {
            let output = run_hermes_command(&["keys", "list", "--chain", chain_id.as_str()])?;
            result.push_str(&format!("{}:\n", chain_id));

            if !output.status.success() {
                let stderr = String::from_utf8_lossy(&output.stderr);
                result.push_str(&format!("  Failed to list keys: {}\n\n", stderr.trim()));
                continue;
            }

            let output_str = String::from_utf8_lossy(&output.stdout);
            if output_str.trim().is_empty() {
                result.push_str("  No keys found\n");
            } else {
                let mut parsed_any = false;
                for line in output_str.lines() {
                    if let Some(key_info) = parse_hermes_key_line(line) {
                        result.push_str(&format!("  key_name: {}\n", key_info.0));
                        result.push_str(&format!("  address:  {}\n", key_info.1));
                        parsed_any = true;
                    }
                }

                if !parsed_any {
                    for line in output_str.lines() {
                        let trimmed = line.trim();
                        if !trimmed.is_empty() {
                            result.push_str(&format!("  {}\n", trimmed));
                        }
                    }
                }

                found_any_keys = true;
            }

            result.push('\n');
        }

        if !found_any_keys {
            result.push_str("\nTo add keys, use:\n");
            result.push_str("  caribic keys add --chain <chain-id> --mnemonic-file <path>\n");
        }

        Ok(result)
    }
}

/// Delete a key from Hermes keyring via caribic
pub fn hermes_keys_delete(
    chain: &str,
    key_name: Option<&str>,
) -> Result<String, Box<dyn std::error::Error>> {
    log(&format!("Deleting key for chain '{}'...", chain));

    let mut args = vec!["keys", "delete", "--chain", chain];

    if let Some(name) = key_name {
        args.push("--key-name");
        args.push(name);
    }

    args.push("--yes"); // Auto-confirm deletion

    let output = run_hermes_command(&args)?;

    if !output.status.success() {
        return Err(format!(
            "Failed to delete key: {}",
            String::from_utf8_lossy(&output.stderr)
        )
        .into());
    }

    Ok(format!("Key deleted for chain '{}'", chain))
}

/// Create IBC client via caribic
pub fn hermes_create_client(
    host_chain: &str,
    reference_chain: &str,
) -> Result<String, Box<dyn std::error::Error>> {
    log(&format!(
        "Creating IBC client for '{}' on '{}'...",
        reference_chain, host_chain
    ));

    let output = run_hermes_command(&[
        "create",
        "client",
        "--host-chain",
        host_chain,
        "--reference-chain",
        reference_chain,
    ])?;

    if !output.status.success() {
        return Err(format!(
            "Failed to create client: {}",
            String::from_utf8_lossy(&output.stderr)
        )
        .into());
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    Ok(format!("IBC client created\n{}", stdout))
}

/// Create IBC connection via caribic
pub fn hermes_create_connection(
    a_chain: &str,
    b_chain: &str,
) -> Result<String, Box<dyn std::error::Error>> {
    log(&format!(
        "Creating IBC connection between '{}' and '{}'...",
        a_chain, b_chain
    ));

    let output = run_hermes_command(&[
        "create",
        "connection",
        "--a-chain",
        a_chain,
        "--b-chain",
        b_chain,
    ])?;

    if !output.status.success() {
        return Err(format!(
            "Failed to create connection: {}",
            String::from_utf8_lossy(&output.stderr)
        )
        .into());
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    Ok(format!("IBC connection created\n{}", stdout))
}

/// Create IBC channel via caribic
pub fn hermes_create_channel(
    a_chain: &str,
    b_chain: &str,
    a_port: &str,
    b_port: &str,
) -> Result<String, Box<dyn std::error::Error>> {
    log(&format!(
        "Creating IBC channel between '{}:{}' and '{}:{}'...",
        a_chain, a_port, b_chain, b_port
    ));

    let output = run_hermes_command(&[
        "create",
        "channel",
        "--a-chain",
        a_chain,
        "--a-port",
        a_port,
        "--b-port",
        b_port,
        "--b-chain",
        b_chain,
    ])?;

    if !output.status.success() {
        return Err(format!(
            "Failed to create channel: {}",
            String::from_utf8_lossy(&output.stderr)
        )
        .into());
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    Ok(format!("IBC channel created\n{}", stdout))
}
