use crate::logger::{log_or_print_progress, log_or_show_progress, verbose};
use crate::process::docker::DockerCli;
use crate::process::hermes::HermesCli;
use crate::process::http::HttpHealthClient;
use crate::process::system::SystemChecks;
use crate::setup::{
    configure_cardano_preprod_runtime, configure_local_cardano_devnet, copy_cardano_env_file,
    download_mithril, local_cardano_spo_count, prepare_db_sync_and_gateway, seed_cardano_devnet,
    write_cardano_runtime_selection,
};
use crate::utils::{
    diagnose_container_failure, execute_script, execute_script_with_progress, get_cardano_era,
    get_cardano_state, get_user_ids, replace_text_in_file, wait_for_health_check, CardanoQuery,
};
use crate::{
    chains, config,
    logger::{self, log},
};
use console::style;
use dirs::home_dir;
use fs_extra::file::copy;
use indicatif::{ProgressBar, ProgressStyle};
use serde_json::Value;
use std::cmp::min;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Once;
use std::thread;
use std::time::{Duration, Instant};

const GATEWAY_HTTP_READINESS_ATTEMPTS: u32 = 4;
const GATEWAY_HTTP_READINESS_RETRY_INTERVAL_MILLIS: u64 = 5000;
const IBC_SWAP_DAPP_SERVICE: &str = "ibc-swap-client";
const IBC_SWAP_DAPP_DEFAULT_HOST_PORT: u16 = 3000;
const IBC_SWAP_DAPP_READINESS_ATTEMPTS: u32 = 60;
const IBC_SWAP_DAPP_READINESS_INTERVAL_MILLIS: u64 = 2000;
const YACI_HEALTH_CHECK_ATTEMPTS: u32 = 36;
const YACI_HEALTH_CHECK_INTERVAL_MILLIS: u64 = 5000;
const LOCAL_CARDANO_NODE_CLOCK_IMAGE: &str = "cardano-node-local-clock:10.1.4-3";
static RELAYER_REMOTE_TIP_CHECK_ONCE: Once = Once::new();

mod hermes;

pub use hermes::{
    hermes_create_channel, hermes_create_client, hermes_create_connection, hermes_keys_add,
    hermes_keys_delete, hermes_keys_list, run_hermes_command, run_hermes_command_with_timeout,
    start_hermes_daemon,
};
pub(crate) use hermes::{
    is_expected_hermes_daemon_pid, is_hermes_daemon_command, is_process_alive,
    read_hermes_pid_file, remove_hermes_pid_file,
};

/// Get environment variables for Docker Compose, including UID/GID
/// - macOS: Uses 0:0 (root) for compatibility
/// - Linux: Uses actual user UID/GID
fn get_docker_env_vars() -> Vec<(&'static str, String)> {
    let (uid, gid) = get_user_ids();
    vec![("UID", uid), ("GID", gid)]
}

fn ibc_swap_cardano_chain_id(network: config::CoreCardanoNetwork) -> &'static str {
    match network {
        config::CoreCardanoNetwork::Local => "42",
        config::CoreCardanoNetwork::Preprod => "1",
    }
}

fn ibc_swap_cardano_ibc_chain_id(network: config::CoreCardanoNetwork) -> &'static str {
    match network {
        config::CoreCardanoNetwork::Local => "cardano-devnet",
        config::CoreCardanoNetwork::Preprod => "cardano-preprod",
    }
}

fn ibc_swap_mode(network: config::CoreCardanoNetwork) -> &'static str {
    match network {
        config::CoreCardanoNetwork::Local => "local",
        config::CoreCardanoNetwork::Preprod => "testnet",
    }
}

fn ibc_swap_host_port() -> Result<u16, String> {
    match std::env::var("IBC_SWAP_HOST_PORT") {
        Ok(value) if !value.trim().is_empty() => value.trim().parse::<u16>().map_err(|_| {
            format!(
                "IBC_SWAP_HOST_PORT must be a numeric host port, got '{}'",
                value.trim()
            )
        }),
        _ => Ok(IBC_SWAP_DAPP_DEFAULT_HOST_PORT),
    }
}

pub(crate) fn ibc_swap_dapp_url() -> String {
    let port = ibc_swap_host_port().unwrap_or(IBC_SWAP_DAPP_DEFAULT_HOST_PORT);
    format!("http://localhost:{port}")
}

fn managed_cardano_network_running(cardano_dir: &Path) -> bool {
    DockerCli::new(cardano_dir)
        .compose_output(["ps", "-q"].as_slice())
        .ok()
        .map(|output| !String::from_utf8_lossy(&output.stdout).trim().is_empty())
        .unwrap_or(false)
}

fn gateway_env_path_from_cardano_dir(cardano_dir: &Path) -> PathBuf {
    cardano_dir.join("../../cardano/gateway/.env")
}

fn read_preprod_runtime_kupo_endpoint(gateway_env_path: &Path) -> Option<String> {
    crate::setup::read_gateway_env_value(gateway_env_path, "GATEWAY_RUNTIME_KUPO_ENDPOINT")
        .ok()
        .flatten()
        .or_else(|| {
            crate::setup::read_gateway_env_value(gateway_env_path, "KUPO_ENDPOINT")
                .ok()
                .flatten()
        })
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn preprod_uses_local_kupo_runtime(
    gateway_env_path: &Path,
) -> Result<bool, Box<dyn std::error::Error>> {
    Ok(crate::setup::resolve_preprod_kupo_mode(gateway_env_path)?
        == crate::setup::PreprodKupoMode::Local)
}

fn read_preprod_remote_kupmios_url(
    gateway_env_path: &Path,
) -> Result<Option<String>, Box<dyn std::error::Error>> {
    if preprod_uses_local_kupo_runtime(gateway_env_path)? {
        return Ok(None);
    }

    let kupo_endpoint = read_preprod_runtime_kupo_endpoint(gateway_env_path).ok_or(
        "PREPROD_KUPO_MODE=remote requires GATEWAY_RUNTIME_KUPO_ENDPOINT or KUPO_ENDPOINT",
    )?;
    let ogmios_endpoint =
        crate::setup::read_gateway_env_value(gateway_env_path, "OGMIOS_ENDPOINT")?
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .ok_or("PREPROD_KUPO_MODE=remote requires OGMIOS_ENDPOINT")?;

    Ok(Some(format!("{kupo_endpoint},{ogmios_endpoint}")))
}

fn read_preprod_remote_kupmios_api_keys(
    gateway_env_path: &Path,
) -> Result<Option<(String, String)>, Box<dyn std::error::Error>> {
    if preprod_uses_local_kupo_runtime(gateway_env_path)? {
        return Ok(None);
    }

    let kupo_api_key =
        crate::setup::read_gateway_env_value(gateway_env_path, "GATEWAY_RUNTIME_KUPO_API_KEY")?
            .or_else(|| {
                crate::setup::read_gateway_env_value(gateway_env_path, "KUPO_API_KEY")
                    .ok()
                    .flatten()
            })
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .ok_or(
                "PREPROD_KUPO_MODE=remote requires GATEWAY_RUNTIME_KUPO_API_KEY or KUPO_API_KEY",
            )?;
    let ogmios_api_key = crate::setup::read_gateway_env_value(gateway_env_path, "OGMIOS_API_KEY")?
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .ok_or("PREPROD_KUPO_MODE=remote requires OGMIOS_API_KEY")?;

    Ok(Some((kupo_api_key, ogmios_api_key)))
}

fn managed_cardano_runtime_services_running(
    cardano_dir: &Path,
    network: config::CoreCardanoNetwork,
) -> bool {
    let output = match Command::new("docker")
        .current_dir(cardano_dir)
        .args(["compose", "ps", "--services", "--status", "running"])
        .output()
    {
        Ok(output) if output.status.success() => output,
        _ => return false,
    };

    let running_services: std::collections::HashSet<String> =
        String::from_utf8_lossy(&output.stdout)
            .lines()
            .map(|line| line.trim().to_string())
            .filter(|line| !line.is_empty())
            .collect();

    let configuration = config::get_config().cardano;
    let mut required_services: Vec<&str> = Vec::new();

    if configuration.services.cardano_node {
        required_services.push("cardano-node");
    }
    if configuration.services.postgres {
        required_services.push("postgres");
    }
    if configuration.services.history_backend_enabled() {
        required_services.push("yaci-store-postgres");
        required_services.push("yaci-store");
    }
    let gateway_env_path = gateway_env_path_from_cardano_dir(cardano_dir);
    let use_local_kupo = !matches!(network, config::CoreCardanoNetwork::Preprod)
        || preprod_uses_local_kupo_runtime(gateway_env_path.as_path()).unwrap_or(false);

    if configuration.services.kupo && use_local_kupo {
        required_services.push("kupo");
    }
    if configuration.services.ogmios && matches!(network, config::CoreCardanoNetwork::Local) {
        required_services.push("cardano-node-ogmios");
    }

    required_services
        .into_iter()
        .all(|service| running_services.contains(service))
}

pub fn start_relayer(
    relayer_path: &Path,
    _relayer_env_template_path: &Path,
    _relayer_config_source_path: &Path,
    _chain_handler_path: &Path,
    cardano_chain_id: &str,
    allow_devnet_key_fallback: bool,
    runtime_deployer_sk: Option<&str>,
) -> Result<(), Box<dyn std::error::Error>> {
    let optional_progress_bar = match logger::get_verbosity() {
        logger::Verbosity::Verbose => None,
        _ => Some(ProgressBar::new_spinner()),
    };

    if let Some(progress_bar) = &optional_progress_bar {
        progress_bar.enable_steady_tick(Duration::from_millis(100));
        progress_bar.set_style(
            ProgressStyle::with_template("{prefix:.bold} {spinner} [{elapsed_precise}] {wide_msg}")
                .map_err(|error| format!("Failed to configure progress output: {error}"))?
                .tick_chars("⠁⠂⠄⡀⢀⠠⠐⠈ "),
        );
        progress_bar.set_prefix("Configuring Hermes relayer ...".to_owned());
    } else {
        log("Configuring Hermes relayer ...");
    }

    // Build Hermes with Cardano support if needed
    let hermes_binary = relayer_path.join("target/release/hermes");

    if !hermes_binary.exists() {
        ensure_relayer_sources_available(relayer_path)?;
        warn_if_relayer_submodule_is_not_remote_tip(relayer_path);
        log_or_show_progress(
            "Building Hermes with Cardano support (this may take a few minutes)...",
            &optional_progress_bar,
        );
        execute_script_with_progress(
            relayer_path,
            "cargo",
            Vec::from(["build", "--release", "--bin", "hermes"]),
            "Building Hermes relayer...",
        )?;
    } else {
        warn_if_relayer_submodule_is_not_remote_tip(relayer_path);
        log_or_show_progress(
            "Hermes binary already built, skipping compilation",
            &optional_progress_bar,
        );
    }

    // Set up Hermes configuration directory
    log_or_show_progress("Setting up Hermes configuration", &optional_progress_bar);
    let home_path = home_dir().ok_or("Could not determine home directory")?;
    let hermes_dir = home_path.join(".hermes");
    let hermes_keys_dir = hermes_dir.join("keys");

    fs::create_dir_all(&hermes_keys_dir)
        .map_err(|e| format!("Failed to create Hermes keys directory: {}", e))?;

    // Copy hermes-config.example.toml to ~/.hermes/config.toml
    let options = fs_extra::file::CopyOptions::new().overwrite(true);
    let caribic_dir = relayer_path
        .parent()
        .ok_or_else(|| format!("Relayer path has no parent: {}", relayer_path.display()))?
        .join("caribic");
    let hermes_config_path = hermes_dir.join("config.toml");
    copy(
        caribic_dir.join("config/hermes-config.example.toml"),
        &hermes_config_path,
        &options,
    )
    .map_err(|e| format!("Failed to copy Hermes config: {}", e))?;
    replace_text_in_file(
        hermes_config_path.as_path(),
        r#"id = 'cardano-devnet'"#,
        format!("id = '{}'", cardano_chain_id).as_str(),
    )
    .map_err(|e| format!("Failed to update Hermes Cardano chain id: {}", e))?;
    if cardano_chain_id == "cardano-devnet" || cardano_chain_id == "cardano-preprod" {
        // Cardano relaying uses the gateway's accepted stability/Mithril view instead
        // of the live tip. That certified view can lag the chain by minutes, so Hermes
        // clients need a larger timestamp tolerance when validating EntryPoint headers
        // against the latest Cardano header they can actually certify.
        replace_text_in_file(
            hermes_config_path.as_path(),
            "clock_drift = '5s'",
            "clock_drift = '15m'",
        )
        .map_err(|e| {
            format!(
                "Failed to relax Hermes Cardano clock_drift for local devnet: {}",
                e
            )
        })?;
    }

    log_or_show_progress(
        &format!("Configuration copied to {}", hermes_config_path.display()),
        &optional_progress_bar,
    );

    // Auto-configure the Cardano Hermes key.
    log_or_show_progress(
        &format!("Setting up Hermes key for {}", cardano_chain_id),
        &optional_progress_bar,
    );

    // Cardano: Prefer DEPLOYER_SK if explicitly provided, otherwise fall back to the
    // devnet-funded deployer key (`chains/cardano/config/credentials/me.sk`).
    //
    // This keeps Hermes (sender/signer identity) aligned with the Gateway's Lucid wallet
    // context and the seeded devnet funds. If we fall back to a random default key, the
    // test suite will see an unfunded sender and transfers will fail or behave unexpectedly.
    let project_root = relayer_path
        .parent()
        .ok_or("Failed to resolve project root from relayer path")?;
    let cardano_key = runtime_deployer_sk
        .map(|key| key.trim().to_string())
        .filter(|key| !key.is_empty())
        .or_else(|| {
            std::env::var("DEPLOYER_SK")
                .ok()
                .map(|k| k.trim().to_string())
                .filter(|k| !k.is_empty())
        })
        .or_else(|| {
            if !allow_devnet_key_fallback {
                return None;
            }
            let deployer_sk_path = project_root.join("chains/cardano/config/credentials/me.sk");
            fs::read_to_string(&deployer_sk_path)
                .ok()
                .map(|k| k.trim().to_string())
                .filter(|k| !k.is_empty())
        })
        .ok_or_else(|| {
            format!(
                "No Cardano signing key available for {}. Set DEPLOYER_SK before starting Hermes.",
                cardano_chain_id
            )
        })?;
    let cardano_key_file = std::env::temp_dir().join("cardano-key.txt");
    fs::write(&cardano_key_file, &cardano_key)
        .map_err(|e| format!("Failed to write cardano key: {}", e))?;

    let cardano_key_output = HermesCli::new(hermes_binary.as_path()).output(
        None,
        &[
            "keys",
            "add",
            "--chain",
            cardano_chain_id,
            "--mnemonic-file",
            cardano_key_file.to_str().ok_or_else(|| {
                format!(
                    "Temporary Cardano key path is not valid UTF-8: {}",
                    cardano_key_file.display()
                )
            })?,
            "--overwrite",
        ],
    );

    let _ = fs::remove_file(&cardano_key_file);

    match cardano_key_output {
        Ok(output) if output.status.success() => {
            log_or_show_progress(
                &format!("Added key for {}", cardano_chain_id),
                &optional_progress_bar,
            );
        }
        Ok(output) => {
            verbose(&format!(
                "Warning: Failed to add {} key: {}",
                cardano_chain_id,
                String::from_utf8_lossy(&output.stderr)
            ));
        }
        Err(e) => {
            verbose(&format!(
                "Warning: Failed to add {} key: {}",
                cardano_chain_id, e
            ));
        }
    }

    // Hermes runs as a local process (see `start_hermes_daemon`), not as a docker-compose service.
    // Any previous docker-compose calls here were legacy and would fail in a clean setup.

    if let Some(progress_bar) = &optional_progress_bar {
        progress_bar.finish_and_clear();
    }

    Ok(())
}

fn ensure_relayer_sources_available(relayer_path: &Path) -> Result<(), Box<dyn std::error::Error>> {
    if relayer_path.join("Cargo.toml").exists() {
        return Ok(());
    }

    let project_root = relayer_path
        .parent()
        .ok_or("Failed to resolve project root from relayer path")?;

    if project_root.join(".git").exists() {
        execute_script(
            project_root,
            "git",
            Vec::from(["submodule", "update", "--init", "--recursive", "relayer"]),
            None,
        )?;

        if relayer_path.join("Cargo.toml").exists() {
            return Ok(());
        }
    }

    Err(format!(
        "Hermes relayer sources are missing at {} (Cargo.toml not found). \
Clone the repository with submodules or run `git submodule update --init --recursive relayer`.",
        relayer_path.display()
    )
    .into())
}

fn run_git_stdout(current_dir: &Path, args: &[&str]) -> Result<String, String> {
    let output = Command::new("git")
        .current_dir(current_dir)
        .env("GIT_TERMINAL_PROMPT", "0")
        .args(args)
        .output()
        .map_err(|error| format!("failed to run `git {}`: {}", args.join(" "), error))?;

    if output.status.success() {
        return Ok(String::from_utf8_lossy(&output.stdout).trim().to_string());
    }

    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let details = if !stderr.is_empty() { stderr } else { stdout };
    Err(format!(
        "`git {}` failed (exit code {}): {}",
        args.join(" "),
        output.status.code().unwrap_or(-1),
        details
    ))
}

fn short_commit(commit: &str) -> &str {
    let length = commit.len().min(12);
    &commit[..length]
}

fn warn_if_relayer_submodule_is_not_remote_tip(relayer_path: &Path) {
    if !relayer_path.join("Cargo.toml").exists() {
        verbose("Skipping Hermes relayer branch-tip check because relayer sources are missing");
        return;
    }

    RELAYER_REMOTE_TIP_CHECK_ONCE.call_once(|| {
        if let Err(error) = check_relayer_submodule_remote_tip(relayer_path) {
            verbose(&format!(
                "Skipping Hermes relayer branch-tip check: {}",
                error
            ));
        }
    });
}

fn check_relayer_submodule_remote_tip(relayer_path: &Path) -> Result<(), String> {
    let project_root = relayer_path
        .parent()
        .ok_or_else(|| "failed to resolve project root from relayer path".to_string())?;
    let branch = run_git_stdout(
        project_root,
        &[
            "config",
            "--file",
            ".gitmodules",
            "--get",
            "submodule.relayer.branch",
        ],
    )?;
    let remote_url = run_git_stdout(
        project_root,
        &[
            "config",
            "--file",
            ".gitmodules",
            "--get",
            "submodule.relayer.url",
        ],
    )?;
    let local_head = run_git_stdout(relayer_path, &["rev-parse", "HEAD"])?;
    let remote_ref = format!("refs/heads/{branch}");
    let remote_output = run_git_stdout(
        project_root,
        &[
            "-c",
            "http.lowSpeedLimit=1",
            "-c",
            "http.lowSpeedTime=5",
            "ls-remote",
            "--exit-code",
            remote_url.as_str(),
            remote_ref.as_str(),
        ],
    )?;
    let remote_tip = remote_output
        .split_whitespace()
        .next()
        .ok_or_else(|| format!("remote branch '{}' returned no commit", branch))?;

    if local_head != remote_tip {
        logger::warn(&format!(
            "WARN: Hermes relayer submodule is checked out at {}, but {} is at {} on {}. \
Startup will continue; run `git submodule update --remote relayer` if you intended to use the latest Hermes Cardano integration branch.",
            short_commit(local_head.as_str()),
            branch,
            short_commit(remote_tip),
            remote_url,
        ));
    }

    Ok(())
}

pub fn build_hermes_if_needed(relayer_path: &Path) -> Result<(), Box<dyn std::error::Error>> {
    let hermes_binary = relayer_path.join("target/release/hermes");
    if hermes_binary.exists() {
        warn_if_relayer_submodule_is_not_remote_tip(relayer_path);
        return Ok(());
    }

    ensure_relayer_sources_available(relayer_path)?;
    warn_if_relayer_submodule_is_not_remote_tip(relayer_path);

    // This helper intentionally does not use a progress bar because it is used by
    // `caribic start` to build Hermes in parallel with other startup tasks.
    //
    // Output still becomes visible in higher verbosity modes via `execute_script`.
    execute_script(
        relayer_path,
        "cargo",
        Vec::from(["build", "--release", "--bin", "hermes"]),
        None,
    )?;

    Ok(())
}

pub fn build_aiken_validators_if_needed(
    project_root_path: &Path,
    _clean: bool,
) -> Result<(), Box<dyn std::error::Error>> {
    // Always rebuild deployment validators with silent traces so a stale debug
    // `plutus.json` cannot bloat reference-script transactions.
    execute_script(
        project_root_path.join("cardano").join("onchain").as_path(),
        "aiken",
        Vec::from(["build", "--trace-level", "silent"]),
        None,
    )?;

    // If the on-chain validators were rebuilt, the off-chain deployment artifacts need to be
    // regenerated. This clean step is safe to run even if the subsequent deploy step is skipped.
    let _ = execute_script(
        project_root_path.join("cardano").join("offchain").as_path(),
        "deno",
        Vec::from(["task", "clean"]),
        None,
    );

    Ok(())
}

pub async fn start_local_cardano_network(
    project_root_path: &Path,
    clean: bool,
    with_mithril: bool,
    network: config::CoreCardanoNetwork,
) -> Result<Option<tokio::task::JoinHandle<Result<(), String>>>, Box<dyn std::error::Error>> {
    if with_mithril {
        return Err("Mithril setup is deprecated, disabled, and not maintained. Use the default stake-weighted-stability light-client mode.".into());
    }

    let optional_progress_bar = match logger::get_verbosity() {
        logger::Verbosity::Verbose => None,
        _ => Some(ProgressBar::new_spinner()),
    };

    if let Some(progress_bar) = &optional_progress_bar {
        progress_bar.enable_steady_tick(Duration::from_millis(100));
        progress_bar.set_style(
            ProgressStyle::with_template("{prefix:.bold} {spinner} [{elapsed_precise}] {wide_msg}")
                .map_err(|error| format!("Failed to configure progress output: {error}"))?
                .tick_chars("⠁⠂⠄⡀⢀⠠⠐⠈ "),
        );
        progress_bar.set_prefix("Creating Cardano runtime ...".to_owned());
    } else {
        log("Creating Cardano runtime ...");
    }

    let cardano_dir = project_root_path.join("chains/cardano");
    let local_spo_count = local_cardano_spo_count(with_mithril, network);
    let active_network = config::active_core_cardano_network(project_root_path);
    let reset_runtime_state = clean || active_network != network;
    if managed_cardano_network_running(cardano_dir.as_path()) && active_network != network {
        return Err(format!(
            "Managed Cardano runtime '{}' is already running. Stop it before starting '{}'.",
            active_network.as_str(),
            network.as_str()
        )
        .into());
    }

    write_cardano_runtime_selection(cardano_dir.as_path(), network, local_spo_count)?;
    if clean {
        let mut compose_down_args = vec!["compose", "down", "--remove-orphans"];
        if matches!(network, config::CoreCardanoNetwork::Local) {
            compose_down_args.insert(2, "-v");
        } else {
            verbose("Preserving preprod Yaci history volume during clean Cardano restart");
        }
        execute_script(cardano_dir.as_path(), "docker", compose_down_args, None)?;
    }
    log_or_show_progress(
        &format!(
            "{} Configuring Cardano {} runtime",
            style("Step 1/3").bold().dim(),
            network.as_str(),
        ),
        &optional_progress_bar,
    );
    match network {
        config::CoreCardanoNetwork::Local => {
            configure_local_cardano_devnet(cardano_dir.as_path(), local_spo_count)?;
        }
        config::CoreCardanoNetwork::Preprod => {
            configure_cardano_preprod_runtime(cardano_dir.as_path(), reset_runtime_state).await?;
        }
    }
    log_or_show_progress(
        &format!(
            "{} Starting Cardano services",
            style("Step 2/3").bold().dim(),
        ),
        &optional_progress_bar,
    );
    start_local_cardano_services(cardano_dir.as_path(), network, local_spo_count)?;

    log_or_show_progress(
        "Waiting for the Cardano services to start ...",
        &optional_progress_bar,
    );

    if matches!(network, config::CoreCardanoNetwork::Local) {
        let ogmios_connected = wait_for_health_check(
            "http://localhost:1337",
            20,
            5000,
            None::<fn(&String) -> bool>,
        )
        .await;

        if ogmios_connected.is_ok() {
            ensure_local_spo_services_running(cardano_dir.as_path(), local_spo_count)?;
            verbose("Cardano services started successfully");
        } else {
            let container_names = if local_spo_count > 1 {
                let mut names = vec!["cardano-node".to_string()];
                names.extend((2..=local_spo_count).map(|index| format!("cardano-node-spo{index}")));
                names.extend([
                    "cardano-cardano-node-ogmios-1".to_string(),
                    "cardano-postgres-1".to_string(),
                    "cardano-yaci-store-postgres-1".to_string(),
                    "cardano-yaci-store-1".to_string(),
                ]);
                names
            } else {
                vec![
                    "cardano-node".to_string(),
                    "cardano-cardano-node-ogmios-1".to_string(),
                    "cardano-postgres-1".to_string(),
                    "cardano-yaci-store-postgres-1".to_string(),
                    "cardano-yaci-store-1".to_string(),
                ]
            };
            let container_refs: Vec<&str> = container_names.iter().map(String::as_str).collect();
            let (diagnostics, _should_fail_fast) = diagnose_container_failure(&container_refs);
            return Err(format!(
                "Failed to start Cardano services - Ogmios health check failed after 100 seconds{}",
                diagnostics
            )
            .into());
        }
    } else {
        verbose("Cardano preprod relay and history services started successfully");
    }

    if config::get_config()
        .cardano
        .services
        .history_backend_enabled()
    {
        let yaci_ready = wait_for_health_check(
            "http://localhost:8081/actuator/health",
            YACI_HEALTH_CHECK_ATTEMPTS,
            YACI_HEALTH_CHECK_INTERVAL_MILLIS,
            Some(|body: &String| {
                body.contains("\"status\":\"UP\"") || body.contains("\"status\": \"UP\"")
            }),
        )
        .await;

        if yaci_ready.is_err() {
            let container_names = ["cardano-yaci-store-postgres-1", "cardano-yaci-store-1"];
            let (diagnostics, _should_fail_fast) = diagnose_container_failure(&container_names);
            return Err(format!(
                "Failed to start Yaci services - health check failed after {} seconds{}",
                (YACI_HEALTH_CHECK_ATTEMPTS as u64 * YACI_HEALTH_CHECK_INTERVAL_MILLIS) / 1000,
                diagnostics
            )
            .into());
        }
    }

    // wait until network is running (with timeout)
    let mut slot_querried = u64::MAX;
    let max_retries = 24; // 24 retries × 5 seconds = 120 seconds timeout
    let mut retry_count = 0;

    while slot_querried == u64::MAX {
        match get_cardano_state(project_root_path, CardanoQuery::Slot) {
            Ok(value) => slot_querried = value,
            Err(_e) => {
                retry_count += 1;

                // Check container health every 3 retries (15 seconds) to fail fast on unrecoverable errors.
                // We should NOT continue retrying if we detect issues that require developer intervention:
                // - Permission errors (requires fixing volume/socket permissions)
                // - Port conflicts (requires stopping conflicting services)
                // - Disk space errors (requires freeing up disk space)
                // However, we DO continue retrying for transient failures:
                // - Container crashes with restart policies (Docker may be restarting the container)
                // - Temporary network issues
                // This approach fails fast for fixable issues while allowing recovery for transient ones.
                if retry_count % 3 == 0 {
                    let container_names = ["cardano-node", "cardano-cardano-node-ogmios-1"];
                    let (diagnostics, should_fail_fast) =
                        diagnose_container_failure(&container_names);
                    if should_fail_fast {
                        return Err(format!(
                            "Cardano node has unrecoverable errors that require developer intervention:{}",
                            diagnostics
                        )
                        .into());
                    }
                }

                if retry_count >= max_retries {
                    let container_names = ["cardano-node", "cardano-cardano-node-ogmios-1"];
                    let (diagnostics, _should_fail_fast) =
                        diagnose_container_failure(&container_names);
                    return Err(format!(
                        "Failed to query cardano-node state after {} seconds. The node may have crashed or is not responding.{}",
                        max_retries * 5,
                        diagnostics
                    )
                    .into());
                }
                log_or_show_progress("Waiting for node to start up ...", &optional_progress_bar);
                std::thread::sleep(Duration::from_secs(5))
            }
        }
    }

    // Local Mithril used to be started here. It is now intentionally disabled
    // while the historical code remains in-tree for reference.
    let mithril_genesis_handle = None;
    let skip_message = if network.uses_local_mithril() {
        "Mithril services are deprecated and disabled; using stake-weighted-stability light-client mode"
            .to_string()
    } else {
        "Using managed Cardano preprod history runtime with stake-weighted-stability light-client mode".to_string()
    };
    log_or_print_progress(skip_message.as_str(), &optional_progress_bar);

    if matches!(network, config::CoreCardanoNetwork::Local) {
        let mut current_era = get_cardano_era(project_root_path)?;
        let target_era = "Conway";
        let target_slot = get_cardano_state(project_root_path, CardanoQuery::SlotInEpoch)?;

        if current_era != target_era {
            if let Some(progress_bar) = &optional_progress_bar {
                progress_bar.enable_steady_tick(Duration::from_millis(100));
                progress_bar.set_style(
                    ProgressStyle::with_template("{prefix:.bold} {spinner} [{elapsed_precise}] [{bar:40.cyan/blue}] {pos}/{len} {wide_msg}")
                        .map_err(|error| format!("Failed to configure progress output: {error}"))?
                        .tick_chars("⠁⠂⠄⡀⢀⠠⠐⠈ ")
                        .progress_chars("#>-"),
                );
                progress_bar.set_prefix(
                    "Seeding the network needs to wait until the local network enters Conway .."
                        .to_owned(),
                );
                progress_bar.set_length(target_slot);
                progress_bar.set_position(get_cardano_state(
                    project_root_path,
                    CardanoQuery::SlotInEpoch,
                )?);
            } else {
                log("Seeding the network needs to wait until the local network enters Conway ..");
            }
        }

        while current_era != target_era {
            current_era = get_cardano_era(project_root_path)?;

            if let Some(progress_bar) = &optional_progress_bar {
                progress_bar.set_position(min(
                    get_cardano_state(project_root_path, CardanoQuery::SlotInEpoch)?,
                    target_slot,
                ));
            } else {
                verbose(&format!(
                    "Current era: {}, slot in epoch: {}, slots left in epoch: {}",
                    current_era,
                    get_cardano_state(project_root_path, CardanoQuery::SlotInEpoch)?,
                    get_cardano_state(project_root_path, CardanoQuery::SlotsToEpochEnd)?
                ));
            }
            std::thread::sleep(Duration::from_secs(10));
        }

        seed_cardano_devnet(cardano_dir.as_path(), &optional_progress_bar)?;
        log_or_show_progress(
            "Deploying the client, channel and connection contracts",
            &optional_progress_bar,
        );
    } else {
        log_or_show_progress(
            "Skipping local devnet seeding/deployment for preprod runtime",
            &optional_progress_bar,
        );
    }

    if config::get_config()
        .cardano
        .services
        .history_backend_enabled()
    {
        prepare_db_sync_and_gateway(
            cardano_dir.as_path(),
            clean,
            network,
            "stake-weighted-stability",
        )?;
    }

    log_or_show_progress(
        &format!(
            "{} Copying Cardano environment file",
            style("Step 3/3").bold().dim(),
        ),
        &optional_progress_bar,
    );
    copy_cardano_env_file(project_root_path.join("cardano").as_path())?;

    if let Some(progress_bar) = &optional_progress_bar {
        progress_bar.finish_and_clear();
    }

    Ok(mithril_genesis_handle)
}

pub async fn deploy_contracts(
    project_root_path: &Path,
    _clean: bool,
    validators_already_built: bool,
) -> Result<(), Box<dyn std::error::Error>> {
    let profile = config::cardano_network_profile(config::CoreCardanoNetwork::Local);
    let handler_json_path = PathBuf::from(profile.handler_json_path.clone());
    let bridge_manifest_path = profile
        .bridge_manifest_path
        .clone()
        .map(PathBuf::from)
        .ok_or("Local bridge manifest path is not configured")?;
    let gateway_dir = project_root_path.join("cardano").join("gateway");
    let offchain_dir = project_root_path.join("cardano").join("offchain");
    let network_magic = profile.network_magic.to_string();
    let optional_progress_bar = match logger::get_verbosity() {
        logger::Verbosity::Verbose => None,
        _ => Some(ProgressBar::new_spinner()),
    };

    if let Some(progress_bar) = &optional_progress_bar {
        progress_bar.enable_steady_tick(Duration::from_millis(100));
        progress_bar.set_style(
            ProgressStyle::with_template("{prefix:.bold} {spinner} [{elapsed_precise}] {wide_msg}")
                .map_err(|error| format!("Failed to configure progress output: {error}"))?
                .tick_chars("⠁⠂⠄⡀⢀⠠⠐⠈ "),
        );
        progress_bar.set_prefix("Deploying IBC contracts ...".to_owned());
    } else {
        log("Deploying IBC contracts ...");
    }

    if validators_already_built {
        log_or_show_progress(
            &format!(
                "{} Aiken validators already built",
                style("Step 1/3").bold().dim()
            ),
            &optional_progress_bar,
        );
    } else {
        log_or_show_progress(
            &format!(
                "{} Building Aiken validators with silent traces",
                style("Step 1/3").bold().dim()
            ),
            &optional_progress_bar,
        );

        // Deployment artifacts must not inherit verbose Aiken traces from a local debug build.
        execute_script(
            project_root_path.join("cardano").join("onchain").as_path(),
            "aiken",
            Vec::from(["build", "--trace-level", "silent"]),
            None,
        )?;
    }

    log_or_show_progress(
        &format!(
            "{} Cleaning local deployment artifacts",
            style("Step 2/3").bold().dim()
        ),
        &optional_progress_bar,
    );
    // Local devnet deployments are ephemeral. A restarted or re-created local
    // chain must not reuse the previous handler.json / bridge-manifest.json,
    // because those artifacts point at UTxOs from an older chain instance.
    execute_script(
        offchain_dir.as_path(),
        "deno",
        Vec::from(["task", "clean"]),
        None,
    )?;

    log_or_show_progress(
        &format!(
            "{} Running offchain deployment for the local Cardano runtime",
            style("Step 2/3").bold().dim()
        ),
        &optional_progress_bar,
    );

    wait_for_local_offchain_wallet_utxos(project_root_path, &optional_progress_bar)?;

    let deployment_result = execute_script(
        offchain_dir.as_path(),
        "deno",
        Vec::from([
            "run",
            "--frozen",
            "--env-file=.env.default",
            "--allow-net",
            "--allow-env",
            "--allow-read",
            "--allow-run",
            "--allow-ffi",
            "--allow-write",
            "index.ts",
        ]),
        Some(vec![
            ("KUPO_URL", "http://localhost:1442"),
            ("OGMIOS_URL", "http://localhost:1337"),
            ("CARDANO_NETWORK_MAGIC", network_magic.as_str()),
        ]),
    );

    if let Err(error) = deployment_result {
        if let Some(progress_bar) = &optional_progress_bar {
            progress_bar.finish_and_clear();
        }
        return Err(format!(
            "ERROR: Offchain deployment failed while generating local deployment artifacts: {}",
            error
        )
        .into());
    }

    if !handler_json_path.exists() {
        if let Some(progress_bar) = &optional_progress_bar {
            progress_bar.finish_and_clear();
        }
        return Err(format!(
            "ERROR: Offchain deployment finished but handler.json was not created at {}",
            handler_json_path.display()
        )
        .into());
    }

    log_or_show_progress(
        &format!(
            "{} Exporting public bridge manifest",
            style("Step 3/3").bold().dim()
        ),
        &optional_progress_bar,
    );

    let export_result = execute_script(
        gateway_dir.as_path(),
        "npm",
        vec![
            "run",
            "export:bridge-manifest",
            "--",
            handler_json_path
                .to_str()
                .ok_or("Failed to stringify local handler path")?,
            bridge_manifest_path
                .to_str()
                .ok_or("Failed to stringify local bridge manifest path")?,
        ],
        Some(vec![
            ("CARDANO_CHAIN_ID", profile.chain_id.as_str()),
            ("CARDANO_CHAIN_NETWORK_MAGIC", network_magic.as_str()),
            ("CARDANO_NETWORK", "local"),
        ]),
    );

    if let Some(progress_bar) = &optional_progress_bar {
        progress_bar.finish_and_clear();
    }

    if let Err(error) = export_result {
        return Err(format!(
            "ERROR: Failed to export local bridge manifest after deployment: {}",
            error
        )
        .into());
    }

    if !bridge_manifest_path.exists() {
        return Err(format!(
            "ERROR: Bridge manifest export finished but bridge-manifest.json was not created at {}",
            bridge_manifest_path.display()
        )
        .into());
    }

    Ok(())
}

fn backup_handler_json(
    handler_json_path: &Path,
) -> Result<Option<PathBuf>, Box<dyn std::error::Error>> {
    if !handler_json_path.exists() {
        return Ok(None);
    }

    let backup_suffix = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();
    let backup_path = std::env::temp_dir().join(format!(
        "caribic-handler-backup-{}-{}.json",
        std::process::id(),
        backup_suffix
    ));

    fs::copy(handler_json_path, &backup_path).map_err(|error| {
        format!(
            "Failed to back up handler.json from {} to {}: {}",
            handler_json_path.display(),
            backup_path.display(),
            error
        )
    })?;

    Ok(Some(backup_path))
}

fn restore_handler_json(
    handler_json_path: &Path,
    backup_path: Option<PathBuf>,
) -> Result<(), Box<dyn std::error::Error>> {
    match backup_path {
        Some(backup_path) => {
            fs::copy(&backup_path, handler_json_path).map_err(|error| {
                format!(
                    "Failed to restore handler.json from {} to {}: {}",
                    backup_path.display(),
                    handler_json_path.display(),
                    error
                )
            })?;
            let _ = fs::remove_file(backup_path);
        }
        None => {
            if handler_json_path.exists() {
                fs::remove_file(handler_json_path).map_err(|error| {
                    format!(
                        "Failed to remove temporary handler.json at {}: {}",
                        handler_json_path.display(),
                        error
                    )
                })?;
            }
        }
    }

    Ok(())
}

fn wait_for_local_offchain_wallet_utxos(
    project_root_path: &Path,
    optional_progress_bar: &Option<ProgressBar>,
) -> Result<(), Box<dyn std::error::Error>> {
    const MAX_ATTEMPTS: u64 = 24;
    const POLL_INTERVAL_SECS: u64 = 5;

    let offchain_dir = project_root_path.join("cardano").join("offchain");
    let local_kupmios_env = vec![
        ("KUPO_URL", "http://localhost:1442"),
        ("OGMIOS_URL", "http://localhost:1337"),
        ("CARDANO_NETWORK_MAGIC", "42"),
    ];

    for attempt in 1..=MAX_ATTEMPTS {
        let probe = execute_script(
            offchain_dir.as_path(),
            "deno",
            vec![
                "run",
                "--env-file=.env.default",
                "--allow-net",
                "--allow-env",
                "--allow-read",
                "--allow-run",
                "--allow-ffi",
                "scripts/check-wallet-utxos.ts",
            ],
            Some(local_kupmios_env.clone()),
        );

        match probe {
            Ok(_) => return Ok(()),
            Err(error) if attempt < MAX_ATTEMPTS => {
                log_or_show_progress(
                    &format!(
                        "Waiting for seeded deployer UTxOs to become visible to local Kupmios at localhost:1442/1337 (attempt {}/{})",
                        attempt, MAX_ATTEMPTS
                    ),
                    optional_progress_bar,
                );
                verbose(&format!(
                    "Wallet UTxO readiness probe failed on attempt {}: {}",
                    attempt, error
                ));
                std::thread::sleep(Duration::from_secs(POLL_INTERVAL_SECS));
            }
            Err(error) => {
                return Err(format!(
                    "Wallet UTxOs never became visible to the offchain Kupmios provider after {} attempts: {}",
                    MAX_ATTEMPTS, error
                )
                .into())
            }
        }
    }

    Ok(())
}

async fn wait_for_ogmios_protocol_parameters(
    ogmios_url: &str,
    optional_progress_bar: &Option<ProgressBar>,
) -> Result<(), Box<dyn std::error::Error>> {
    const MAX_ATTEMPTS: u64 = 12;
    const POLL_INTERVAL_SECS: u64 = 5;
    fn resolve_optional_env(keys: &[&str]) -> Option<String> {
        keys.iter()
            .find_map(|key| std::env::var(key).ok())
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
    }

    fn derive_http_url(ogmios_url: &str) -> Option<String> {
        let mut parsed = reqwest::Url::parse(ogmios_url).ok()?;
        let next_scheme = match parsed.scheme() {
            "wss" => "https".to_string(),
            "ws" => "http".to_string(),
            current => current.to_string(),
        };
        parsed.set_scheme(next_scheme.as_str()).ok()?;
        Some(parsed.to_string())
    }

    fn should_attach_dmtr_api_key(url: &str, api_key: &str) -> bool {
        reqwest::Url::parse(url)
            .ok()
            .map(|parsed| {
                !parsed
                    .host_str()
                    .unwrap_or_default()
                    .starts_with(&format!("{}.", api_key))
            })
            .unwrap_or(true)
    }

    let ogmios_api_key = resolve_optional_env(&["CARIBIC_OGMIOS_API_KEY", "OGMIOS_API_KEY"]);
    let ogmios_http_url = resolve_optional_env(&["CARIBIC_OGMIOS_HTTP_URL", "OGMIOS_HTTP_URL"])
        .or_else(|| derive_http_url(ogmios_url))
        .unwrap_or_else(|| ogmios_url.to_string());
    let mut default_headers = reqwest::header::HeaderMap::new();
    if let Some(api_key) = ogmios_api_key.as_deref() {
        if should_attach_dmtr_api_key(ogmios_http_url.as_str(), api_key) {
            default_headers.insert(
                "Dmtr-api-key",
                reqwest::header::HeaderValue::from_str(api_key)
                    .map_err(|error| format!("Invalid OGMIOS API key header value: {}", error))?,
            );
        }
    }
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(POLL_INTERVAL_SECS))
        .default_headers(default_headers)
        .build()
        .map_err(|error| format!("Failed to initialize Ogmios readiness client: {}", error))?;
    let request_body = serde_json::json!({
        "jsonrpc": "2.0",
        "method": "queryLedgerState/protocolParameters",
        "params": {},
        "id": null
    });

    let mut attempt: u64 = 0;
    loop {
        attempt += 1;
        let readiness_check = client
            .post(ogmios_http_url.as_str())
            .json(&request_body)
            .send()
            .await;

        match readiness_check {
            Ok(response) => {
                let status = response.status();
                let response_body = response.text().await.unwrap_or_default();
                let parsed_response = serde_json::from_str::<Value>(&response_body).ok();
                if status.is_success()
                    && parsed_response
                        .as_ref()
                        .is_some_and(|json| json.get("error").is_none())
                {
                    return Ok(());
                }

                verbose(&format!(
                    "Cardano deployment readiness not met yet at {} (attempt {}): status={}, response={}",
                    ogmios_http_url, attempt, status, response_body
                ));
            }
            Err(error) => {
                verbose(&format!(
                    "Cardano deployment readiness check failed at {} (attempt {}): {}",
                    ogmios_http_url, attempt, error
                ));
            }
        }

        if attempt >= MAX_ATTEMPTS {
            return Err(format!(
                "Ogmios at {} did not answer protocolParameters after {} attempts. Confirm your external Cardano infrastructure is reachable, authenticated, and synced enough for deployment.",
                ogmios_http_url, MAX_ATTEMPTS
            )
            .into());
        }

        log_or_show_progress(
            &format!(
                "Waiting for Ogmios readiness before deployment at {} (attempt {})",
                ogmios_http_url, attempt
            ),
            optional_progress_bar,
        );
        tokio::time::sleep(Duration::from_secs(POLL_INTERVAL_SECS)).await;
    }
}

pub async fn deploy_preprod_bridge(
    project_root_path: &Path,
    validators_already_built: bool,
    deployer_sk: &str,
) -> Result<(), Box<dyn std::error::Error>> {
    let optional_progress_bar = match logger::get_verbosity() {
        logger::Verbosity::Verbose => None,
        _ => Some(ProgressBar::new_spinner()),
    };

    if let Some(progress_bar) = &optional_progress_bar {
        progress_bar.enable_steady_tick(Duration::from_millis(100));
        progress_bar.set_style(
            ProgressStyle::with_template("{prefix:.bold} {spinner} [{elapsed_precise}] {wide_msg}")
                .map_err(|error| format!("Failed to configure progress output: {error}"))?
                .tick_chars("⠁⠂⠄⡀⢀⠠⠐⠈ "),
        );
        progress_bar.set_prefix("Deploying Cardano preprod bridge ...".to_owned());
    } else {
        log("Deploying Cardano preprod bridge ...");
    }

    let profile = config::cardano_network_profile(config::CoreCardanoNetwork::Preprod);
    let cardano_dir = project_root_path.join("chains/cardano");
    let offchain_dir = project_root_path.join("cardano/offchain");
    let gateway_dir = project_root_path.join("cardano/gateway");
    let deployment_dir = offchain_dir.join("deployments");
    let generic_handler_path = deployment_dir.join("handler.json");
    let generic_cost_report_path = deployment_dir.join("deployment-cost-report.json");
    let preprod_handler_path = PathBuf::from(profile.handler_json_path.clone());
    let preprod_manifest_path = profile
        .bridge_manifest_path
        .clone()
        .map(PathBuf::from)
        .ok_or("Preprod bridge manifest path is not configured")?;
    let preprod_cost_report_path =
        preprod_manifest_path.with_file_name("cardano-preprod-deployment-costs.json");
    let network_magic = profile.network_magic.to_string();
    let kupmios_submit_timeout_ms = String::from("120000");

    fs::create_dir_all(&deployment_dir).map_err(|error| {
        format!(
            "Failed to create offchain deployments directory {}: {}",
            deployment_dir.display(),
            error
        )
    })?;
    if let Some(parent) = preprod_handler_path.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            format!(
                "Failed to create preprod handler directory {}: {}",
                parent.display(),
                error
            )
        })?;
    }
    if let Some(parent) = preprod_manifest_path.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            format!(
                "Failed to create preprod manifest directory {}: {}",
                parent.display(),
                error
            )
        })?;
    }

    let force_preprod_redeploy = std::env::var("CARIBIC_FORCE_PREPROD_DEPLOY")
        .ok()
        .map(|value| {
            matches!(
                value.trim().to_ascii_lowercase().as_str(),
                "1" | "true" | "yes" | "on"
            )
        })
        .unwrap_or(false);

    if !force_preprod_redeploy {
        if preprod_handler_path.exists() && preprod_manifest_path.exists() {
            log_or_show_progress(
                &format!(
                    "{} Reusing existing preprod bridge artifacts",
                    style("Step 1/3").bold().dim()
                ),
                &optional_progress_bar,
            );
            if let Some(progress_bar) = &optional_progress_bar {
                progress_bar.finish_and_clear();
            }
            return Ok(());
        }

        if preprod_handler_path.exists() {
            log_or_show_progress(
                &format!(
                    "{} Reusing existing preprod handler.json",
                    style("Step 1/3").bold().dim()
                ),
                &optional_progress_bar,
            );
            log_or_show_progress(
                &format!(
                    "{} Exporting public bridge manifest from existing handler.json",
                    style("Step 2/3").bold().dim()
                ),
                &optional_progress_bar,
            );

            let export_env = vec![
                ("CARDANO_CHAIN_ID", profile.chain_id.as_str()),
                ("CARDANO_CHAIN_NETWORK_MAGIC", network_magic.as_str()),
                ("CARDANO_NETWORK", "preprod"),
            ];
            let export_result = execute_script(
                gateway_dir.as_path(),
                "npm",
                vec![
                    "run",
                    "export:bridge-manifest",
                    "--",
                    preprod_handler_path
                        .to_str()
                        .ok_or("Failed to stringify preprod handler path")?,
                    preprod_manifest_path
                        .to_str()
                        .ok_or("Failed to stringify preprod bridge manifest path")?,
                ],
                Some(export_env),
            );

            if let Some(progress_bar) = &optional_progress_bar {
                progress_bar.finish_and_clear();
            }

            if let Err(error) = export_result {
                return Err(format!("Failed to export preprod bridge manifest: {}", error).into());
            }
            return Ok(());
        }
    }

    if validators_already_built {
        log_or_show_progress(
            &format!(
                "{} Aiken validators already built",
                style("Step 1/3").bold().dim()
            ),
            &optional_progress_bar,
        );
    } else {
        log_or_show_progress(
            &format!(
                "{} Building Aiken validators with silent traces",
                style("Step 1/3").bold().dim()
            ),
            &optional_progress_bar,
        );

        // Deployment artifacts must not inherit verbose Aiken traces from a local debug build.
        execute_script(
            project_root_path.join("cardano").join("onchain").as_path(),
            "aiken",
            Vec::from(["build", "--trace-level", "silent"]),
            None,
        )?;
    }

    let (ogmios_url, kupo_url) =
        crate::setup::resolve_external_cardano_deploy_endpoints(cardano_dir.as_path())?;
    let normalized_ogmios_http_url =
        reqwest::Url::parse(ogmios_url.as_str())
            .ok()
            .and_then(|mut parsed| {
                let next_scheme = match parsed.scheme() {
                    "wss" => Some("https"),
                    "ws" => Some("http"),
                    "https" | "http" => None,
                    _ => return None,
                };
                if let Some(next_scheme) = next_scheme {
                    parsed.set_scheme(next_scheme).ok()?;
                }
                Some(parsed.to_string())
            });
    let ogmios_http_url = ["CARIBIC_OGMIOS_HTTP_URL", "OGMIOS_HTTP_URL"]
        .iter()
        .find_map(|key| std::env::var(key).ok())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let ogmios_api_key = ["CARIBIC_OGMIOS_API_KEY", "OGMIOS_API_KEY"]
        .iter()
        .find_map(|key| std::env::var(key).ok())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let kupo_api_key = ["CARIBIC_KUPO_API_KEY", "KUPO_API_KEY"]
        .iter()
        .find_map(|key| std::env::var(key).ok())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());

    // Preprod deployment targets live Cardano infra; the local managed runtime
    // only supports history/indexing and gateway bootstrap around that network.
    wait_for_ogmios_protocol_parameters(ogmios_url.as_str(), &optional_progress_bar).await?;

    // The offchain deploy still emits the generic handler.json used by local mode.
    // Keep that behavior intact, then copy out a preprod-specific artifact beside it.
    let handler_backup = backup_handler_json(generic_handler_path.as_path())?;

    log_or_show_progress(
        &format!(
            "{} Running offchain deployment against preprod",
            style("Step 2/3").bold().dim()
        ),
        &optional_progress_bar,
    );

    let mut offchain_env = vec![
        ("DEPLOYER_SK", deployer_sk),
        ("KUPO_URL", kupo_url.as_str()),
        (
            "OGMIOS_URL",
            ogmios_http_url
                .as_deref()
                .or(normalized_ogmios_http_url.as_deref())
                .unwrap_or(ogmios_url.as_str()),
        ),
        ("CARDANO_NETWORK_MAGIC", network_magic.as_str()),
        (
            "DEPLOYMENT_COST_REPORT_PATH",
            generic_cost_report_path
                .to_str()
                .ok_or("Failed to stringify deployment cost report path")?,
        ),
        (
            "KUPMIOS_SUBMIT_TIMEOUT_MS",
            kupmios_submit_timeout_ms.as_str(),
        ),
    ];
    if ogmios_url.starts_with("ws://") || ogmios_url.starts_with("wss://") {
        offchain_env.push(("OGMIOS_WS_URL", ogmios_url.as_str()));
    }
    if let Some(ogmios_http_url) = ogmios_http_url.as_deref() {
        offchain_env.push(("OGMIOS_HTTP_URL", ogmios_http_url));
    } else if let Some(normalized_ogmios_http_url) = normalized_ogmios_http_url.as_deref() {
        offchain_env.push(("OGMIOS_HTTP_URL", normalized_ogmios_http_url));
    }
    if let Some(ogmios_api_key) = ogmios_api_key.as_deref() {
        offchain_env.push(("OGMIOS_API_KEY", ogmios_api_key));
    }
    if let Some(kupo_api_key) = kupo_api_key.as_deref() {
        offchain_env.push(("KUPO_API_KEY", kupo_api_key));
    }
    let deployment_result = execute_script(
        offchain_dir.as_path(),
        "deno",
        vec![
            "run",
            "--frozen",
            "--allow-net",
            "--allow-env",
            "--allow-read",
            "--allow-run",
            "--allow-ffi",
            "--allow-write",
            "index.ts",
        ],
        Some(offchain_env),
    );

    if let Err(error) = deployment_result {
        let _ = restore_handler_json(generic_handler_path.as_path(), handler_backup);
        if let Some(progress_bar) = &optional_progress_bar {
            progress_bar.finish_and_clear();
        }
        return Err(format!("Preprod offchain deployment failed: {}", error).into());
    }

    if !generic_handler_path.exists() {
        let _ = restore_handler_json(generic_handler_path.as_path(), handler_backup);
        if let Some(progress_bar) = &optional_progress_bar {
            progress_bar.finish_and_clear();
        }
        return Err(format!(
            "Offchain deployment finished but handler.json was not created at {}",
            generic_handler_path.display()
        )
        .into());
    }

    if let Err(error) = fs::copy(&generic_handler_path, &preprod_handler_path) {
        let _ = restore_handler_json(generic_handler_path.as_path(), handler_backup);
        if let Some(progress_bar) = &optional_progress_bar {
            progress_bar.finish_and_clear();
        }
        return Err(format!(
            "Failed to publish preprod handler.json from {} to {}: {}",
            generic_handler_path.display(),
            preprod_handler_path.display(),
            error
        )
        .into());
    }

    if generic_cost_report_path.exists() {
        if let Err(error) = fs::copy(&generic_cost_report_path, &preprod_cost_report_path) {
            let _ = restore_handler_json(generic_handler_path.as_path(), handler_backup);
            if let Some(progress_bar) = &optional_progress_bar {
                progress_bar.finish_and_clear();
            }
            return Err(format!(
                "Failed to publish preprod deployment cost report from {} to {}: {}",
                generic_cost_report_path.display(),
                preprod_cost_report_path.display(),
                error
            )
            .into());
        }
    } else {
        log_or_show_progress(
            &format!(
                "WARN: Deployment completed without a cost report at {}",
                generic_cost_report_path.display()
            ),
            &optional_progress_bar,
        );
    }

    log_or_show_progress(
        &format!(
            "{} Exporting public bridge manifest",
            style("Step 3/3").bold().dim()
        ),
        &optional_progress_bar,
    );

    let export_env = vec![
        ("CARDANO_CHAIN_ID", profile.chain_id.as_str()),
        ("CARDANO_CHAIN_NETWORK_MAGIC", network_magic.as_str()),
        ("CARDANO_NETWORK", "preprod"),
    ];
    let export_result = execute_script(
        gateway_dir.as_path(),
        "npm",
        vec![
            "run",
            "export:bridge-manifest",
            "--",
            preprod_handler_path
                .to_str()
                .ok_or("Failed to stringify preprod handler path")?,
            preprod_manifest_path
                .to_str()
                .ok_or("Failed to stringify preprod bridge manifest path")?,
        ],
        Some(export_env),
    );

    restore_handler_json(generic_handler_path.as_path(), handler_backup)?;

    if let Some(progress_bar) = &optional_progress_bar {
        progress_bar.finish_and_clear();
    }

    if let Err(error) = export_result {
        return Err(format!("Failed to export preprod bridge manifest: {}", error).into());
    }

    Ok(())
}

fn ensure_local_spo_services_running(
    cardano_dir: &Path,
    local_spo_count: usize,
) -> Result<(), Box<dyn std::error::Error>> {
    if local_spo_count <= 1 {
        return Ok(());
    }

    let output = DockerCli::new(cardano_dir)
        .compose_output(["ps", "--services", "--status", "running"].as_slice())
        .map_err(|error| format!("Failed to inspect local SPO service status: {}", error))?;

    let running_services: std::collections::HashSet<String> =
        String::from_utf8_lossy(&output.stdout)
            .lines()
            .map(|line| line.trim().to_string())
            .filter(|line| !line.is_empty())
            .collect();
    let expected_services: Vec<String> = (2..=local_spo_count)
        .map(|index| format!("cardano-node-spo{}", index))
        .collect();
    let missing_services: Vec<&String> = expected_services
        .iter()
        .filter(|service| !running_services.contains(*service))
        .collect();

    if missing_services.is_empty() {
        return Ok(());
    }

    let missing_names: Vec<&str> = missing_services
        .iter()
        .map(|service| service.as_str())
        .collect();
    let (diagnostics, _should_fail_fast) = diagnose_container_failure(&missing_names);
    Err(format!(
        "Local stability runtime is missing SPO services: {}{}",
        missing_names.join(", "),
        diagnostics
    )
    .into())
}

pub fn start_local_cardano_services(
    cardano_dir: &Path,
    network: config::CoreCardanoNetwork,
    local_spo_count: usize,
) -> Result<(), Box<dyn std::error::Error>> {
    let configuration = config::get_config().cardano;
    let gateway_env_path = gateway_env_path_from_cardano_dir(cardano_dir);
    let use_local_kupo = !matches!(network, config::CoreCardanoNetwork::Preprod)
        || preprod_uses_local_kupo_runtime(gateway_env_path.as_path())?;

    let mut all_services: Vec<String> = vec![];
    let mut base_services: Vec<String> = vec![];
    let mut follow_up_services: Vec<String> = vec![];

    if configuration.services.cardano_node {
        all_services.push("cardano-node".to_string());
        base_services.push("cardano-node".to_string());
        if matches!(network, config::CoreCardanoNetwork::Local) {
            for index in 2..=local_spo_count {
                let service_name = format!("cardano-node-spo{}", index);
                all_services.push(service_name.clone());
                base_services.push(service_name);
            }
        }
    }
    if configuration.services.postgres {
        all_services.push("postgres".to_string());
        base_services.push("postgres".to_string());
    }
    if configuration.services.history_backend_enabled() {
        all_services.push("yaci-store-postgres".to_string());
        all_services.push("yaci-store".to_string());
        base_services.push("yaci-store-postgres".to_string());
        follow_up_services.push("yaci-store".to_string());
    }
    if configuration.services.kupo
        && matches!(network, config::CoreCardanoNetwork::Preprod)
        && use_local_kupo
    {
        all_services.push("ogmios-proxy".to_string());
        follow_up_services.push("ogmios-proxy".to_string());
    }
    if configuration.services.kupo && use_local_kupo {
        all_services.push("kupo".to_string());
        follow_up_services.push("kupo".to_string());
    }
    if configuration.services.ogmios && matches!(network, config::CoreCardanoNetwork::Local) {
        all_services.push("cardano-node-ogmios".to_string());
        follow_up_services.push("cardano-node-ogmios".to_string());
    }

    let mut script_stop_args = vec!["compose", "stop"];
    let mut all_service_args: Vec<&str> = all_services
        .iter()
        .map(|service| service.as_str())
        .collect();
    script_stop_args.append(&mut all_service_args);
    execute_script(cardano_dir, "docker", script_stop_args, None)?;

    if matches!(network, config::CoreCardanoNetwork::Preprod)
        && configuration.services.kupo
        && !use_local_kupo
    {
        // Remote-Kupo preprod mode must not try to manage local proxy services that
        // are only present in local-Kupo compose setups.
        execute_script(cardano_dir, "docker", vec!["compose", "stop", "kupo"], None)?;
    }

    let docker_env = get_docker_env_vars();
    let docker_env_refs: Vec<(&str, &str)> =
        docker_env.iter().map(|(k, v)| (*k, v.as_str())).collect();

    if matches!(network, config::CoreCardanoNetwork::Local) {
        execute_script(
            cardano_dir,
            "docker",
            vec![
                "build",
                "-f",
                "Dockerfile.local-clock",
                "-t",
                LOCAL_CARDANO_NODE_CLOCK_IMAGE,
                ".",
            ],
            None,
        )?;

        // Docker Desktop can race bind-mount creation for ./devnet/db on a clean restart if Ogmios
        // starts at the same time as cardano-node. Precreate the runtime paths and bring the node
        // up first so follow-up services see a stable database directory.
        fs::create_dir_all(cardano_dir.join("devnet").join("db")).map_err(|error| {
            format!(
                "Failed to precreate Cardano local runtime database directory: {}",
                error
            )
        })?;
        fs::create_dir_all(cardano_dir.join("devnet").join("ipc")).map_err(|error| {
            format!(
                "Failed to precreate Cardano local runtime IPC directory: {}",
                error
            )
        })?;
        for index in 2..=local_spo_count {
            fs::create_dir_all(
                cardano_dir
                    .join("devnet")
                    .join(format!("spo{}", index))
                    .join("db"),
            )
            .map_err(|error| {
                format!(
                    "Failed to precreate Cardano local SPO database directory: {}",
                    error
                )
            })?;
        }
    }

    if !base_services.is_empty() {
        let mut script_start_args = vec!["compose", "up", "-d"];
        let mut base_service_args: Vec<&str> = base_services
            .iter()
            .map(|service| service.as_str())
            .collect();
        script_start_args.append(&mut base_service_args);
        execute_script(
            cardano_dir,
            "docker",
            script_start_args,
            Some(docker_env_refs.clone()),
        )?;
    }

    if matches!(network, config::CoreCardanoNetwork::Local) && configuration.services.cardano_node {
        let db_dir = cardano_dir.join("devnet").join("db");
        let mut attempts_remaining = 20;
        while attempts_remaining > 0 && !db_dir.is_dir() {
            thread::sleep(Duration::from_millis(250));
            attempts_remaining -= 1;
        }

        if !db_dir.is_dir() {
            return Err(format!(
                "Cardano local runtime database directory did not become available at {}",
                db_dir.display()
            )
            .into());
        }
    }

    if !follow_up_services.is_empty() {
        let mut script_start_args = vec!["compose", "up", "-d"];
        let mut follow_up_service_args: Vec<&str> = follow_up_services
            .iter()
            .map(|service| service.as_str())
            .collect();
        script_start_args.append(&mut follow_up_service_args);
        execute_script(
            cardano_dir,
            "docker",
            script_start_args,
            Some(docker_env_refs),
        )?;
    }
    Ok(())
}

pub async fn ensure_managed_cardano_runtime(
    project_root_path: &Path,
    clean: bool,
    network: config::CoreCardanoNetwork,
) -> Result<(), Box<dyn std::error::Error>> {
    let cardano_dir = project_root_path.join("chains/cardano");
    let active_network = config::active_core_cardano_network(project_root_path);

    if managed_cardano_network_running(cardano_dir.as_path())
        && managed_cardano_runtime_services_running(cardano_dir.as_path(), network)
        && active_network == network
        && !clean
    {
        return Ok(());
    }

    let _ = start_local_cardano_network(project_root_path, clean, false, network).await?;
    Ok(())
}

/// Deprecated and disabled from the maintained CLI path.
/// Retained only so the historical local Mithril setup remains inspectable.
#[allow(dead_code)]
pub async fn start_mithril(project_root_dir: &Path) -> Result<u64, Box<dyn std::error::Error>> {
    let optional_progress_bar = match logger::get_verbosity() {
        logger::Verbosity::Verbose => None,
        _ => Some(ProgressBar::new_spinner()),
    };

    let current_cardano_epoch =
        start_mithril_with_progress(project_root_dir, &optional_progress_bar).await?;

    if let Some(progress_bar) = &optional_progress_bar {
        progress_bar.finish_and_clear();
    }

    Ok(current_cardano_epoch)
}

#[allow(dead_code)]
async fn start_mithril_with_progress(
    project_root_dir: &Path,
    optional_progress_bar: &Option<ProgressBar>,
) -> Result<u64, Box<dyn std::error::Error>> {
    let mithril_dir = project_root_dir.join("chains/mithrils");
    let mithril_data_dir = mithril_dir.join("data");
    let mithril_script_dir = mithril_dir.join("scripts");
    let mithril_project_dir = mithril_dir.join("mithril");

    if mithril_data_dir.exists() && mithril_data_dir.is_dir() {
        fs::remove_dir_all(&mithril_data_dir).map_err(|error| {
            format!(
                "Failed to remove existing mithril data directory: {}",
                error
            )
        })?;
    }
    fs::create_dir_all(&mithril_data_dir)
        .map_err(|error| format!("Failed to create mithril data directory: {}", error))?;

    if !mithril_project_dir.exists() {
        download_mithril(&mithril_project_dir)
            .await
            .map_err(|error| {
                format!(
                    "Unable to download and extract mithril repository: {}",
                    error
                )
            })?;
    }

    if let Some(progress_bar) = &optional_progress_bar {
        progress_bar.enable_steady_tick(Duration::from_millis(100));
        progress_bar.set_style(
            ProgressStyle::with_template("{prefix:.bold} {spinner} {wide_msg}")
                .map_err(|error| format!("Failed to configure progress output: {error}"))?
                .tick_chars("⠁⠂⠄⡀⢀⠠⠐⠈ "),
        );
        progress_bar.set_prefix("Power up Mithril to get started ...".to_owned());
    } else {
        log("Power up Mithril to get started ...");
    }

    let mithril_config = config::get_config().mithril;

    log_or_show_progress(
        &format!(
            "{} Configuring Mithril services",
            style("Step 1/2").bold().dim()
        ),
        optional_progress_bar,
    );
    let docker_env = get_docker_env_vars();
    let mithril_data_dir = mithril_data_dir.to_str().ok_or_else(|| {
        format!(
            "Mithril data path is not valid UTF-8: {}",
            mithril_data_dir.display()
        )
    })?;
    let mut mithril_env = vec![
        (
            "MITHRIL_AGGREGATOR_IMAGE",
            mithril_config.aggregator_image.as_str(),
        ),
        ("MITHRIL_CLIENT_IMAGE", mithril_config.client_image.as_str()),
        ("MITHRIL_SIGNER_IMAGE", mithril_config.signer_image.as_str()),
        (
            "CARDANO_NODE_VERSION",
            mithril_config.cardano_node_version.as_str(),
        ),
        (
            "CHAIN_OBSERVER_TYPE",
            mithril_config.chain_observer_type.as_str(),
        ),
        ("CARDANO_NODE_DIR", mithril_config.cardano_node_dir.as_str()),
        ("MITHRIL_DATA_DIR", mithril_data_dir),
        (
            "GENESIS_VERIFICATION_KEY",
            mithril_config.genesis_verification_key.as_str(),
        ),
        (
            "GENESIS_SECRET_KEY",
            mithril_config.genesis_secret_key.as_str(),
        ),
        ("MITHRIL_SIGNER_IMAGE", mithril_config.signer_image.as_str()),
    ];

    // Add UID/GID to environment
    for (key, value) in &docker_env {
        mithril_env.push((key, value.as_str()));
    }

    execute_script(
        &mithril_script_dir,
        "docker",
        vec!["compose", "rm", "-f"],
        Some(mithril_env.clone()),
    )
    .map_err(|error| format!("Failed to bring down mithril services: {}", error))?;

    log_or_show_progress(
        &format!(
            "{} Starting Mithril services",
            style("Step 2/2").bold().dim()
        ),
        optional_progress_bar,
    );
    execute_script(
        &mithril_script_dir,
        "docker",
        vec![
            "compose",
            "-f",
            "docker-compose.yaml",
            "--profile",
            "mithril",
            "up",
            "--remove-orphans",
            "--force-recreate",
            "-d",
            "--no-build",
        ],
        Some(mithril_env.clone()),
    )
    .map_err(|error| {
        format!(
            "docker compose up command failed for the mithril services: {}",
            error
        )
    })?;

    let current_cardano_epoch = get_cardano_state(project_root_dir, CardanoQuery::Epoch)?;

    Ok(current_cardano_epoch)
}

#[allow(dead_code)]
pub fn wait_and_start_mithril_genesis(
    project_root_dir: &Path,
    _cardano_epoch_on_mithril_start: u64,
) -> Result<(), Box<dyn std::error::Error>> {
    // Mithril has two practical prerequisites on a fresh local Cardano devnet:
    //
    // 1) Cardano immutable files must exist.
    //    The aggregator or signer timepoint logic reads immutable files, if started too early it can
    //    error with messages like "no immutable file was returned".
    //
    // 2) A genesis certificate chain must exist.
    //    The aggregator serves `/aggregator` even when it has zero certificates, but in that
    //    state it will never be able to certify artifacts, and the artifact endpoints will keep
    //    returning `[]`. The `genesis bootstrap` job seeds the first certificate using the genesis
    //    keys in `~/.caribic/config.json`.
    //
    // After bootstrap, the running aggregator/signer processes should start producing stake
    // distributions and Cardano transaction snapshots. If they remain empty, a Mithril restart
    // can be required to pick up the seeded certificate chain cleanly.
    let mithril_dir = project_root_dir.join("chains/mithrils");
    let mithril_script_dir = mithril_dir.join("scripts");
    let mithril_data_dir = mithril_dir.join("data");

    let mithril_config = config::get_config().mithril;
    let cardano_node_dir = Path::new(mithril_config.cardano_node_dir.as_str());
    let aggregator_base_url = mithril_config
        .aggregator_url
        .trim_end_matches('/')
        .to_string();

    wait_for_cardano_immutable_files(cardano_node_dir, Duration::from_secs(20 * 60))?;

    // Reuse the same environment variables with UID/GID
    let docker_env = get_docker_env_vars();
    let mithril_data_dir = mithril_data_dir.to_str().ok_or_else(|| {
        format!(
            "Mithril data path is not valid UTF-8: {}",
            mithril_data_dir.display()
        )
    })?;
    let mut mithril_genesis_env = vec![
        (
            "MITHRIL_AGGREGATOR_IMAGE",
            mithril_config.aggregator_image.as_str(),
        ),
        ("MITHRIL_CLIENT_IMAGE", mithril_config.client_image.as_str()),
        ("MITHRIL_SIGNER_IMAGE", mithril_config.signer_image.as_str()),
        (
            "CARDANO_NODE_VERSION",
            mithril_config.cardano_node_version.as_str(),
        ),
        (
            "CHAIN_OBSERVER_TYPE",
            mithril_config.chain_observer_type.as_str(),
        ),
        ("CARDANO_NODE_DIR", mithril_config.cardano_node_dir.as_str()),
        ("MITHRIL_DATA_DIR", mithril_data_dir),
        (
            "GENESIS_VERIFICATION_KEY",
            mithril_config.genesis_verification_key.as_str(),
        ),
        (
            "GENESIS_SECRET_KEY",
            mithril_config.genesis_secret_key.as_str(),
        ),
        ("MITHRIL_SIGNER_IMAGE", mithril_config.signer_image.as_str()),
    ];

    // Add UID/GID to environment
    for (key, value) in &docker_env {
        mithril_genesis_env.push((key, value.as_str()));
    }

    // Wait for the aggregator to observe and expose the next signers set.
    //
    // The genesis bootstrap command requires signers for the *next signer retrieval epoch*.
    // On fresh devnets this can lag behind the Cardano epoch progression, running bootstrap too
    // early results in "Missing signers for epoch X".
    let epoch_settings_url = format!("{aggregator_base_url}/aggregator/epoch-settings");
    let required_next_signers = 1;
    let signers_poll_interval = Duration::from_secs(5);
    let signers_poll_attempts = 240; // 20 minutes
    let http_client = reqwest::blocking::Client::builder()
        .no_proxy()
        .build()
        .map_err(|e| format!("Failed to build HTTP client for Mithril checks: {e}"))?;
    let mut last_epoch_settings_error: Option<String> = None;
    for attempt in 1..=signers_poll_attempts {
        match http_client.get(epoch_settings_url.as_str()).send() {
            Ok(resp) if resp.status().is_success() => match resp.text() {
                Ok(body) => match serde_json::from_str::<Value>(&body) {
                    Ok(json) => {
                        let next_signers_count = json
                            .get("next_signers")
                            .and_then(|v| v.as_array())
                            .map(|v| v.len())
                            .unwrap_or(0);

                        if next_signers_count >= required_next_signers {
                            last_epoch_settings_error = None;
                            break;
                        }

                        verbose(&format!(
                            "Mithril epoch-settings not ready yet (next_signers={}); retry {}/{}",
                            next_signers_count, attempt, signers_poll_attempts
                        ));
                        last_epoch_settings_error = Some(format!(
                            "next_signers count is {} (expected >= {})",
                            next_signers_count, required_next_signers
                        ));
                    }
                    Err(err) => {
                        last_epoch_settings_error =
                            Some(format!("Failed to parse epoch-settings JSON: {err}"));
                    }
                },
                Err(err) => {
                    last_epoch_settings_error = Some(format!(
                        "Failed to read epoch-settings response body: {err}"
                    ));
                }
            },
            Ok(resp) => {
                last_epoch_settings_error =
                    Some(format!("epoch-settings HTTP status {}", resp.status()));
            }
            Err(err) => {
                last_epoch_settings_error = Some(format!(
                    "Failed to call Mithril epoch-settings endpoint: {err}"
                ));
            }
        }

        std::thread::sleep(signers_poll_interval);
    }
    if let Some(error) = last_epoch_settings_error {
        return Err(format!(
            "Mithril signers were not ready for genesis bootstrap after {} minutes: {}",
            (signers_poll_attempts as u64 * signers_poll_interval.as_secs()) / 60,
            error
        )
        .into());
    }

    // Seed the first Mithril certificate chain.
    //
    // If Mithril was previously started with different genesis keys and the data directory was
    // not cleaned, the aggregator may report certificate-chain/AVK mismatches. In that case,
    // restart Mithril with a clean data directory so the on-disk store matches the configured
    // keys.
    // NOTE: On fresh devnets, the aggregator may not have any registered signers yet.
    // In that case `genesis bootstrap` fails with "Missing signers for epoch X".
    // Retry a few times to give the signers/registration rounds time to populate.
    let mut attempts = 0;
    loop {
        attempts += 1;
        // The genesis bootstrap job uses the same SQLite store as the running aggregator service.
        // If the aggregator is running, the store can be locked and bootstrap will fail with
        // `database is locked (code 5)`. Stop the aggregator while running bootstrap, then start it
        // again so it picks up the newly-seeded certificate chain.
        execute_script(
            &mithril_script_dir,
            "docker",
            vec![
                "compose",
                "-f",
                "docker-compose.yaml",
                "stop",
                "mithril-aggregator",
            ],
            Some(mithril_genesis_env.clone()),
        )
        .map_err(|e| {
            format!(
                "Failed to stop Mithril aggregator before genesis bootstrap attempt {}: {}",
                attempts, e
            )
        })?;

        let result = execute_script(
            &mithril_script_dir,
            "docker",
            vec![
                "compose",
                "-f",
                "docker-compose.yaml",
                "--profile",
                "mithril-genesis",
                "run",
                "--rm",
                "mithril-aggregator-genesis",
            ],
            Some(mithril_genesis_env.clone()),
        );

        // Bring the aggregator back up (best-effort) regardless of bootstrap success.
        let aggregator_restart_result = execute_script(
            &mithril_script_dir,
            "docker",
            vec![
                "compose",
                "-f",
                "docker-compose.yaml",
                "--profile",
                "mithril",
                "up",
                "-d",
                "--no-build",
                "mithril-aggregator",
            ],
            Some(mithril_genesis_env.clone()),
        );
        if let Err(err) = aggregator_restart_result {
            return Err(format!(
                "Failed to restart Mithril aggregator after genesis bootstrap attempt {}: {}",
                attempts, err
            )
            .into());
        }

        match result {
            Ok(_) => break,
            Err(err) => {
                let err_str = err.to_string();
                let retryable = err_str.contains("Missing signers for epoch")
                    || err_str.contains("The list of signers must not be empty");

                if retryable && attempts < 10 {
                    verbose(&format!(
                        "Mithril genesis bootstrap not ready yet (attempt {}/10). Retrying in 15s...",
                        attempts
                    ));
                    std::thread::sleep(Duration::from_secs(15));
                    continue;
                }

                return Err(err.into());
            }
        }
    }

    const ARTIFACT_READY_ATTEMPTS: usize = 240; // 20 minutes @ 5s
    const ARTIFACT_READY_POLL_INTERVAL: Duration = Duration::from_secs(5);
    if let Err(error) = wait_for_mithril_artifact_readiness(
        &http_client,
        aggregator_base_url.as_str(),
        ARTIFACT_READY_ATTEMPTS,
        ARTIFACT_READY_POLL_INTERVAL,
    ) {
        // Recovery attempt:
        // On some starts, bootstrap succeeds but the running aggregator/signer set remains in a
        // bad epoch-service state. Restarting all Mithril runtime services once is often enough to
        // recover and start producing artifacts.
        verbose(&format!(
            "Mithril artifacts not ready after bootstrap, restarting runtime services once: {}",
            error
        ));

        execute_script(
            &mithril_script_dir,
            "docker",
            vec![
                "compose",
                "-f",
                "docker-compose.yaml",
                "--profile",
                "mithril",
                "up",
                "-d",
                "--no-build",
                "mithril-aggregator",
                "mithril-signer-1",
                "mithril-signer-2",
            ],
            Some(mithril_genesis_env.clone()),
        )
        .map_err(|restart_error| {
            format!(
                "Failed to restart Mithril runtime services after bootstrap: {}",
                restart_error
            )
        })?;

        wait_for_mithril_artifact_readiness(
            &http_client,
            aggregator_base_url.as_str(),
            ARTIFACT_READY_ATTEMPTS,
            ARTIFACT_READY_POLL_INTERVAL,
        )
        .map_err(|final_error| {
            format!(
                "Mithril artifacts were not ready after bootstrap and one runtime restart: {}",
                final_error
            )
        })?;
    }

    Ok(())
}

#[allow(dead_code)]
fn wait_for_cardano_immutable_files(
    cardano_node_dir: &Path,
    timeout: Duration,
) -> Result<(), Box<dyn std::error::Error>> {
    let immutable_dir = cardano_node_dir.join("db").join("immutable");
    let poll_interval = Duration::from_secs(5);
    let started_at = Instant::now();

    while started_at.elapsed() < timeout {
        if has_any_immutable_chunk(immutable_dir.as_path()) {
            return Ok(());
        }
        verbose(&format!(
            "Waiting for Cardano immutable files at {} ...",
            immutable_dir.display()
        ));
        std::thread::sleep(poll_interval);
    }

    Err(format!(
        "Timed out after {}s waiting for Cardano immutable files at {}",
        timeout.as_secs(),
        immutable_dir.display()
    )
    .into())
}

#[allow(dead_code)]
fn has_any_immutable_chunk(immutable_dir: &Path) -> bool {
    let Ok(entries) = fs::read_dir(immutable_dir) else {
        return false;
    };

    entries
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.path())
        .any(|path| path.extension().and_then(|ext| ext.to_str()) == Some("chunk"))
}

#[allow(dead_code)]
fn wait_for_mithril_artifact_readiness(
    http_client: &reqwest::blocking::Client,
    aggregator_base_url: &str,
    attempts: usize,
    poll_interval: Duration,
) -> Result<(), String> {
    let stake_distributions_url =
        format!("{aggregator_base_url}/aggregator/artifact/mithril-stake-distributions");
    let cardano_transactions_url =
        format!("{aggregator_base_url}/aggregator/artifact/cardano-transactions");
    let epoch_settings_url = format!("{aggregator_base_url}/aggregator/epoch-settings");

    let mut last_status = String::from("unknown");
    for attempt in 1..=attempts {
        let mut stake_ready = false;
        let mut tx_ready = false;
        let mut epoch_settings_summary = String::from("unavailable");

        match http_client.get(stake_distributions_url.as_str()).send() {
            Ok(response) if response.status().is_success() => match response.json::<Value>() {
                Ok(value) => {
                    let count = value.as_array().map(|v| v.len()).unwrap_or(0);
                    stake_ready = count > 0;
                    epoch_settings_summary = format!(
                        "{}; stake_distributions_count={}",
                        epoch_settings_summary, count
                    );
                }
                Err(error) => {
                    epoch_settings_summary = format!(
                        "{}; stake_distributions_parse_error={}",
                        epoch_settings_summary, error
                    );
                }
            },
            Ok(response) => {
                epoch_settings_summary = format!(
                    "{}; stake_distributions_status={}",
                    epoch_settings_summary,
                    response.status()
                );
            }
            Err(error) => {
                epoch_settings_summary = format!(
                    "{}; stake_distributions_error={}",
                    epoch_settings_summary, error
                );
            }
        }

        match http_client.get(cardano_transactions_url.as_str()).send() {
            Ok(response) if response.status().is_success() => match response.json::<Value>() {
                Ok(value) => {
                    let count = value.as_array().map(|v| v.len()).unwrap_or(0);
                    tx_ready = count > 0;
                    epoch_settings_summary = format!(
                        "{}; cardano_transactions_count={}",
                        epoch_settings_summary, count
                    );
                }
                Err(error) => {
                    epoch_settings_summary = format!(
                        "{}; cardano_transactions_parse_error={}",
                        epoch_settings_summary, error
                    );
                }
            },
            Ok(response) => {
                epoch_settings_summary = format!(
                    "{}; cardano_transactions_status={}",
                    epoch_settings_summary,
                    response.status()
                );
            }
            Err(error) => {
                epoch_settings_summary = format!(
                    "{}; cardano_transactions_error={}",
                    epoch_settings_summary, error
                );
            }
        }

        match http_client.get(epoch_settings_url.as_str()).send() {
            Ok(response) if response.status().is_success() => match response.json::<Value>() {
                Ok(value) => {
                    let next_signers = value
                        .get("next_signers")
                        .and_then(Value::as_array)
                        .map(|v| v.len())
                        .unwrap_or(0);
                    epoch_settings_summary = format!(
                        "{}; epoch_settings_next_signers={}",
                        epoch_settings_summary, next_signers
                    );
                }
                Err(error) => {
                    epoch_settings_summary = format!(
                        "{}; epoch_settings_parse_error={}",
                        epoch_settings_summary, error
                    );
                }
            },
            Ok(response) => {
                epoch_settings_summary = format!(
                    "{}; epoch_settings_status={}",
                    epoch_settings_summary,
                    response.status()
                );
            }
            Err(error) => {
                epoch_settings_summary =
                    format!("{}; epoch_settings_error={}", epoch_settings_summary, error);
            }
        }

        last_status = format!(
            "attempt {attempt}/{attempts}: stake_ready={stake_ready}, tx_ready={tx_ready}, {}",
            epoch_settings_summary
        );
        if stake_ready && tx_ready {
            return Ok(());
        }

        verbose(&format!(
            "Mithril artifact readiness check: {}",
            last_status.as_str()
        ));
        std::thread::sleep(poll_interval);
    }

    Err(format!(
        "artifact endpoints were not ready after {} attempts: {}",
        attempts, last_status
    ))
}

pub fn start_gateway(gateway_dir: &Path, clean: bool) -> Result<(), Box<dyn std::error::Error>> {
    const SHARED_CARDANO_NETWORK: &str = "cardano_ibc_net";
    let optional_progress_bar = match logger::get_verbosity() {
        logger::Verbosity::Verbose => None,
        _ => Some(ProgressBar::new_spinner()),
    };

    if let Some(progress_bar) = &optional_progress_bar {
        progress_bar.enable_steady_tick(Duration::from_millis(100));
        progress_bar.set_style(
            ProgressStyle::with_template("{prefix:.bold} {spinner} [{elapsed_precise}] {wide_msg}")
                .map_err(|error| format!("Failed to configure progress output: {error}"))?
                .tick_chars("⠁⠂⠄⡀⢀⠠⠐⠈ "),
        );
        progress_bar.set_prefix("Starting Gateway ...".to_owned());
    } else {
        log("Starting Gateway ...");
    }

    let network_exists = DockerCli::new(Path::new("."))
        .raw_output(["network", "inspect", SHARED_CARDANO_NETWORK].as_slice())
        .is_ok();
    if !network_exists {
        log_or_show_progress(
            &format!(
                "Creating shared Docker network '{}' for gateway dependencies",
                SHARED_CARDANO_NETWORK
            ),
            &optional_progress_bar,
        );
        execute_script(
            gateway_dir,
            "docker",
            vec!["network", "create", SHARED_CARDANO_NETWORK],
            None,
        )?;
    }

    log_or_show_progress(
        "Stopping existing Gateway containers",
        &optional_progress_bar,
    );
    if clean {
        execute_script(
            gateway_dir,
            "docker",
            Vec::from(["compose", "down", "--remove-orphans"]),
            None,
        )?;
    } else {
        execute_script(gateway_dir, "docker", Vec::from(["compose", "stop"]), None)?;
    }

    let script_args = vec!["compose", "up", "-d", "--build"];
    if clean {
        log_or_show_progress(
            "Building and starting Gateway containers",
            &optional_progress_bar,
        );
    } else {
        log_or_show_progress(
            "Building and starting Gateway containers",
            &optional_progress_bar,
        );
    }

    execute_script(gateway_dir, "docker", script_args, None)?;

    // Wait for Gateway to stay up long enough to answer both gRPC and proof-readiness
    // checks. A transient open gRPC port is not sufficient if the app exits immediately
    // after binding, and a plain /health pass is not sufficient if Yaci history has not
    // caught up enough for proof-serving.
    log_or_show_progress(
        "Waiting for Gateway proof readiness",
        &optional_progress_bar,
    );
    let health_config = config::get_config().health;

    let max_retries = health_config.gateway_max_retries;
    if max_retries == 0 {
        return Err(
            "Invalid config: health.gateway_max_retries must be > 0 in ~/.caribic/config.json"
                .into(),
        );
    }
    let interval_ms = health_config.gateway_retry_interval_ms;
    if interval_ms == 0 {
        return Err(
            "Invalid config: health.gateway_retry_interval_ms must be > 0 in ~/.caribic/config.json"
                .into(),
        );
    }
    let mut gateway_ready = false;
    let mut last_gateway_status = "Gateway readiness checks have not completed yet".to_string();

    verbose(&format!(
        "Gateway readiness polling configured with max_retries={} interval_ms={}",
        max_retries, interval_ms
    ));

    for i in 0..max_retries {
        let (ready, status) = check_gateway_service_readiness();
        last_gateway_status = status;
        if ready {
            gateway_ready = true;
            break;
        }

        if i < max_retries - 1 {
            thread::sleep(Duration::from_millis(interval_ms));
            log_or_show_progress(
                &format!(
                    "Waiting for Gateway proof readiness... ({}/{})",
                    i + 1,
                    max_retries
                ),
                &optional_progress_bar,
            );
        }
    }

    if !gateway_ready {
        dump_gateway_startup_logs(gateway_dir, &optional_progress_bar);
        if let Some(progress_bar) = &optional_progress_bar {
            progress_bar.finish_and_clear();
        }
        return Err(format!(
            "Gateway readiness checks (container, gRPC, proof readiness) did not become ready in time: {}",
            last_gateway_status
        )
        .into());
    }

    log_or_show_progress(
        "Gateway gRPC and proof readiness endpoints are ready",
        &optional_progress_bar,
    );

    if let Some(progress_bar) = &optional_progress_bar {
        progress_bar.finish_and_clear();
    }

    Ok(())
}

pub fn start_dapp(
    project_root_path: &Path,
    clean: bool,
    core_cardano_network: config::CoreCardanoNetwork,
) -> Result<(), Box<dyn std::error::Error>> {
    let dapps_dir = project_root_path.join("dapps");
    if !dapps_dir.join("docker-compose.yml").exists() {
        return Err("Missing dapps/docker-compose.yml; cannot start IBC Swap dapp".into());
    }

    let optional_progress_bar = match logger::get_verbosity() {
        logger::Verbosity::Verbose => None,
        _ => Some(ProgressBar::new_spinner()),
    };

    if let Some(progress_bar) = &optional_progress_bar {
        progress_bar.enable_steady_tick(Duration::from_millis(100));
        progress_bar.set_style(
            ProgressStyle::with_template("{prefix:.bold} {spinner} [{elapsed_precise}] {wide_msg}")
                .map_err(|error| format!("Failed to configure progress output: {error}"))?
                .tick_chars("⠁⠂⠄⡀⢀⠠⠐⠈ "),
        );
        progress_bar.set_prefix("Starting IBC Swap dapp ...".to_owned());
    } else {
        log("Starting IBC Swap dapp ...");
    }

    if clean {
        log_or_show_progress(
            "Removing existing IBC Swap dapp container",
            &optional_progress_bar,
        );
        run_dapp_compose_command(
            dapps_dir.as_path(),
            &["compose", "rm", "-f", "-s", IBC_SWAP_DAPP_SERVICE],
            core_cardano_network,
        )?;
    }

    log_or_show_progress(
        "Building and starting IBC Swap dapp container",
        &optional_progress_bar,
    );
    run_dapp_compose_command(
        dapps_dir.as_path(),
        &["compose", "up", "-d", "--build", IBC_SWAP_DAPP_SERVICE],
        core_cardano_network,
    )?;

    let mut dapp_ready = false;
    let mut last_status = "IBC Swap dapp readiness checks have not completed yet".to_string();

    for attempt in 0..IBC_SWAP_DAPP_READINESS_ATTEMPTS {
        let (ready, status) = check_dapp_service_readiness();
        last_status = status;
        if ready {
            dapp_ready = true;
            break;
        }

        if attempt + 1 < IBC_SWAP_DAPP_READINESS_ATTEMPTS {
            thread::sleep(Duration::from_millis(
                IBC_SWAP_DAPP_READINESS_INTERVAL_MILLIS,
            ));
            log_or_show_progress(
                &format!(
                    "Waiting for IBC Swap dapp readiness... ({}/{})",
                    attempt + 1,
                    IBC_SWAP_DAPP_READINESS_ATTEMPTS
                ),
                &optional_progress_bar,
            );
        }
    }

    if !dapp_ready {
        dump_dapp_startup_logs(dapps_dir.as_path(), &optional_progress_bar);
        if let Some(progress_bar) = &optional_progress_bar {
            progress_bar.finish_and_clear();
        }
        return Err(format!(
            "IBC Swap dapp did not become ready in time: {}",
            last_status
        )
        .into());
    }

    log_or_show_progress(
        &format!("IBC Swap dapp is ready at {}", ibc_swap_dapp_url()),
        &optional_progress_bar,
    );

    if let Some(progress_bar) = &optional_progress_bar {
        progress_bar.finish_and_clear();
    }

    Ok(())
}

fn run_dapp_compose_command(
    dapps_dir: &Path,
    args: &[&str],
    core_cardano_network: config::CoreCardanoNetwork,
) -> Result<(), Box<dyn std::error::Error>> {
    let cardano_chain_id = std::env::var("IBC_SWAP_CARDANO_CHAIN_ID")
        .unwrap_or_else(|_| ibc_swap_cardano_chain_id(core_cardano_network).to_string());
    let cardano_ibc_chain_id = std::env::var("IBC_SWAP_CARDANO_IBC_CHAIN_ID")
        .unwrap_or_else(|_| ibc_swap_cardano_ibc_chain_id(core_cardano_network).to_string());
    let dapp_mode = std::env::var("IBC_SWAP_MODE")
        .unwrap_or_else(|_| ibc_swap_mode(core_cardano_network).to_string());
    let mut command = Command::new("docker");
    command
        .current_dir(dapps_dir)
        .env("IBC_SWAP_MODE", dapp_mode)
        .env("IBC_SWAP_CARDANO_CHAIN_ID", cardano_chain_id)
        .env("IBC_SWAP_CARDANO_IBC_CHAIN_ID", cardano_ibc_chain_id);

    if core_cardano_network == config::CoreCardanoNetwork::Preprod {
        let project_root_path = dapps_dir
            .parent()
            .ok_or("Failed to derive project root from dapps directory")?;
        let gateway_env_path = project_root_path
            .join("cardano")
            .join("gateway")
            .join(".env");
        if let Some(kupmios_url) = read_preprod_remote_kupmios_url(gateway_env_path.as_path())? {
            command
                .env("IBC_SWAP_KUPMIOS_URL", kupmios_url.as_str())
                .env("IBC_SWAP_KUPMIOS_INTERNAL_URL", kupmios_url.as_str());
        }
        if let Some((kupo_api_key, ogmios_api_key)) =
            read_preprod_remote_kupmios_api_keys(gateway_env_path.as_path())?
        {
            command
                .env("IBC_SWAP_KUPO_API_KEY", kupo_api_key)
                .env("IBC_SWAP_OGMIOS_API_KEY", ogmios_api_key);
        }
    }

    let output = command.args(args).output()?;

    let command_label = format!("docker {}", args.join(" "));
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let combined = match (stdout.is_empty(), stderr.is_empty()) {
        (false, false) => format!("{}\n{}", stdout, stderr),
        (false, true) => stdout,
        (true, false) => stderr,
        (true, true) => String::new(),
    };

    if output.status.success() {
        if !combined.is_empty() {
            verbose(&format!("{} output:\n{}", command_label, combined));
        }
        return Ok(());
    }

    let details = if combined.is_empty() {
        "no output".to_string()
    } else {
        combined
    };
    Err(format!(
        "{} exited with status {}: {}",
        command_label,
        output.status.code().unwrap_or(-1),
        details
    )
    .into())
}

fn dump_dapp_startup_logs(dapps_dir: &Path, optional_progress_bar: &Option<ProgressBar>) {
    log_or_print_progress(
        "IBC Swap dapp did not become ready in time. Collecting startup diagnostics",
        optional_progress_bar,
    );

    let compose_ps = run_command_capture(Command::new("docker").current_dir(dapps_dir).args([
        "compose",
        "ps",
        IBC_SWAP_DAPP_SERVICE,
    ]));
    match compose_ps {
        Ok(output) if !output.trim().is_empty() => {
            log_or_print_progress("IBC Swap dapp compose status", optional_progress_bar);
            logger::log(output.as_str());
        }
        Ok(_) => {}
        Err(error) => {
            log_or_print_progress(
                &format!("WARN: Failed to collect dapp compose status: {}", error),
                optional_progress_bar,
            );
        }
    }

    let compose_logs = run_command_capture(Command::new("docker").current_dir(dapps_dir).args([
        "compose",
        "logs",
        "--tail",
        "200",
        IBC_SWAP_DAPP_SERVICE,
    ]));
    match compose_logs {
        Ok(output) if !output.trim().is_empty() => {
            log_or_print_progress(
                "IBC Swap dapp compose logs (last 200 lines)",
                optional_progress_bar,
            );
            logger::log(output.as_str());
        }
        Ok(_) => {}
        Err(error) => {
            log_or_print_progress(
                &format!("WARN: Failed to collect dapp compose logs: {}", error),
                optional_progress_bar,
            );
        }
    }
}

fn dump_gateway_startup_logs(gateway_dir: &Path, optional_progress_bar: &Option<ProgressBar>) {
    log_or_print_progress(
        "Gateway gRPC did not become ready in time. Collecting startup diagnostics",
        optional_progress_bar,
    );

    let mut compose_ps_command = DockerCli::new(gateway_dir).compose_command(["ps"].as_slice());
    let compose_ps = run_command_capture(&mut compose_ps_command);
    match compose_ps {
        Ok(output) if !output.trim().is_empty() => {
            log_or_print_progress("Gateway compose status", optional_progress_bar);
            logger::log(output.as_str());
        }
        Ok(_) => {}
        Err(error) => {
            log_or_print_progress(
                &format!("WARN: Failed to collect `docker compose ps`: {}", error),
                optional_progress_bar,
            );
        }
    }

    let mut compose_logs_command =
        DockerCli::new(gateway_dir).compose_command(["logs", "--tail", "200", "app"].as_slice());
    let compose_logs = run_command_capture(&mut compose_logs_command);
    match compose_logs {
        Ok(output) if !output.trim().is_empty() => {
            log_or_print_progress(
                "Gateway compose logs (last 200 lines)",
                optional_progress_bar,
            );
            logger::log(output.as_str());
            return;
        }
        Ok(_) => {}
        Err(error) => {
            log_or_print_progress(
                &format!(
                    "WARN: Failed to collect compose logs for app service: {}",
                    error
                ),
                optional_progress_bar,
            );
        }
    }

    let mut docker_logs_command = DockerCli::new(Path::new("."))
        .raw_command(["logs", "--tail", "200", "gateway-app"].as_slice());
    let docker_logs = run_command_capture(&mut docker_logs_command);
    match docker_logs {
        Ok(output) if !output.trim().is_empty() => {
            log_or_print_progress(
                "Gateway container logs (last 200 lines)",
                optional_progress_bar,
            );
            logger::log(output.as_str());
        }
        Ok(_) => {}
        Err(error) => {
            log_or_print_progress(
                &format!(
                    "WARN: Failed to collect `docker logs gateway-app`: {}",
                    error
                ),
                optional_progress_bar,
            );
        }
    }
}

fn run_command_capture(command: &mut Command) -> Result<String, String> {
    let output = command
        .output()
        .map_err(|error| format!("failed to execute command: {}", error))?;

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let combined = match (stdout.is_empty(), stderr.is_empty()) {
        (false, false) => format!("{}\n{}", stdout, stderr),
        (false, true) => stdout,
        (true, false) => stderr,
        (true, true) => String::new(),
    };

    if output.status.success() {
        Ok(combined)
    } else {
        let details = if combined.is_empty() {
            "no output".to_string()
        } else {
            combined
        };
        Err(format!(
            "command exited with status {}: {}",
            output.status.code().unwrap_or(-1),
            details
        ))
    }
}

#[derive(Copy, Clone)]
enum CoreHealthCheckType {
    Gateway,
    Dapp,
    CardanoNode,
    Postgres,
    Yaci,
    Kupo,
    Ogmios,
    Mithril,
    HermesDaemon,
}

#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub(crate) enum CoreServiceId {
    Gateway,
    Dapp,
    Cardano,
    Postgres,
    Yaci,
    Kupo,
    Ogmios,
    Mithril,
    Hermes,
}

impl CoreServiceId {
    pub(crate) fn name(self) -> &'static str {
        match self {
            CoreServiceId::Gateway => "gateway",
            CoreServiceId::Dapp => "dapp",
            CoreServiceId::Cardano => "cardano",
            CoreServiceId::Postgres => "postgres",
            CoreServiceId::Yaci => "yaci",
            CoreServiceId::Kupo => "kupo",
            CoreServiceId::Ogmios => "ogmios",
            CoreServiceId::Mithril => "mithril",
            CoreServiceId::Hermes => "hermes",
        }
    }

    fn label(self) -> &'static str {
        match self {
            CoreServiceId::Gateway => "Gateway (NestJS gRPC Server)",
            CoreServiceId::Dapp => "IBC Swap dapp (Next.js UI)",
            CoreServiceId::Cardano => "Cardano chain access",
            CoreServiceId::Postgres => "PostgreSQL (Gateway app db)",
            CoreServiceId::Yaci => "Yaci Store",
            CoreServiceId::Kupo => "Kupo (Chain Indexer)",
            CoreServiceId::Ogmios => "Ogmios (JSON/RPC)",
            CoreServiceId::Mithril => "Mithril (Aggregator + Signers)",
            CoreServiceId::Hermes => "Hermes Relayer Daemon",
        }
    }

    fn check_type(self) -> CoreHealthCheckType {
        match self {
            CoreServiceId::Gateway => CoreHealthCheckType::Gateway,
            CoreServiceId::Dapp => CoreHealthCheckType::Dapp,
            CoreServiceId::Cardano => CoreHealthCheckType::CardanoNode,
            CoreServiceId::Postgres => CoreHealthCheckType::Postgres,
            CoreServiceId::Yaci => CoreHealthCheckType::Yaci,
            CoreServiceId::Kupo => CoreHealthCheckType::Kupo,
            CoreServiceId::Ogmios => CoreHealthCheckType::Ogmios,
            CoreServiceId::Mithril => CoreHealthCheckType::Mithril,
            CoreServiceId::Hermes => CoreHealthCheckType::HermesDaemon,
        }
    }
}

#[derive(clap::ValueEnum, Copy, Clone, Debug, Eq, PartialEq)]
pub(crate) enum OptionalChainId {
    Osmosis,
    Cheqd,
    Injective,
}

#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub(crate) enum HealthTarget {
    Core(CoreServiceId),
}

const CORE_SERVICE_IDS: [CoreServiceId; 9] = [
    CoreServiceId::Gateway,
    CoreServiceId::Dapp,
    CoreServiceId::Cardano,
    CoreServiceId::Postgres,
    CoreServiceId::Yaci,
    CoreServiceId::Kupo,
    CoreServiceId::Ogmios,
    CoreServiceId::Mithril,
    CoreServiceId::Hermes,
];

#[derive(Clone)]
struct HealthServiceStatus {
    name: String,
    label: String,
    healthy: bool,
    status: String,
}

struct HealthContext {
    mithril_dir: PathBuf,
    core_cardano_network: config::CoreCardanoNetwork,
    preprod_mithril_endpoint: String,
    gateway_env_path: PathBuf,
}

fn build_health_context(project_root_path: &Path) -> HealthContext {
    let preprod_profile = config::cardano_network_profile(config::CoreCardanoNetwork::Preprod);
    HealthContext {
        mithril_dir: project_root_path.join("chains/mithrils"),
        core_cardano_network: config::active_core_cardano_network(project_root_path),
        preprod_mithril_endpoint: preprod_profile.mithril_aggregator_url,
        gateway_env_path: project_root_path.join("cardano/gateway/.env"),
    }
}

fn external_gateway_env_value(context: &HealthContext, key: &str) -> Option<String> {
    crate::setup::read_gateway_env_value(context.gateway_env_path.as_path(), key)
        .ok()
        .flatten()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn check_external_host_port(host: &str, port: &str, label: &str) -> (bool, String) {
    let reachable = port
        .parse::<u16>()
        .ok()
        .is_some_and(|parsed_port| SystemChecks::tcp_port_open(host, parsed_port));
    if reachable {
        (
            true,
            format!("External {} reachable at {}:{}", label, host, port),
        )
    } else {
        (
            false,
            format!("External {} not reachable at {}:{}", label, host, port),
        )
    }
}

fn check_external_url_port(url: &str, label: &str) -> (bool, String) {
    let Ok(parsed) = reqwest::Url::parse(url) else {
        return (false, format!("External {} URL is invalid: {}", label, url));
    };
    let Some(host) = parsed.host_str() else {
        return (
            false,
            format!("External {} URL is missing a host: {}", label, url),
        );
    };
    let port = parsed.port_or_known_default().unwrap_or(80).to_string();
    check_external_host_port(host, port.as_str(), label)
}

fn run_core_health_check(
    check_type: CoreHealthCheckType,
    context: &HealthContext,
) -> (bool, String) {
    if context.core_cardano_network == config::CoreCardanoNetwork::Preprod {
        return match check_type {
            CoreHealthCheckType::Gateway => check_gateway_service_readiness(),
            CoreHealthCheckType::Dapp => check_dapp_service_readiness(),
            CoreHealthCheckType::CardanoNode => check_container_only("cardano-node"),
            CoreHealthCheckType::Postgres => check_postgres_service(),
            CoreHealthCheckType::Yaci => check_container_with_optional_port(
                "yaci-store-1",
                8081,
                "Running on port 8081",
                "Container running",
            ),
            CoreHealthCheckType::Kupo => {
                match preprod_uses_local_kupo_runtime(context.gateway_env_path.as_path()) {
                    Ok(true) => check_container_with_optional_port(
                        "cardano-kupo",
                        1442,
                        "Running on port 1442",
                        "Container running",
                    ),
                    Ok(false) => {
                        external_gateway_env_value(context, "GATEWAY_RUNTIME_KUPO_ENDPOINT")
                            .or_else(|| external_gateway_env_value(context, "KUPO_ENDPOINT"))
                            .map(|url| check_external_url_port(url.as_str(), "Kupo"))
                            .unwrap_or_else(|| {
                                (
                                    false,
                                    "Missing Kupo runtime endpoint in cardano/gateway/.env"
                                        .to_string(),
                                )
                            })
                    }
                    Err(error) => (false, error.to_string()),
                }
            }
            CoreHealthCheckType::Ogmios => external_gateway_env_value(context, "OGMIOS_ENDPOINT")
                .map(|url| check_external_url_port(url.as_str(), "Ogmios"))
                .unwrap_or_else(|| {
                    (
                        false,
                        "Missing OGMIOS_ENDPOINT in cardano/gateway/.env".to_string(),
                    )
                }),
            CoreHealthCheckType::Mithril => check_mithril_service(
                context.mithril_dir.as_path(),
                context.core_cardano_network,
                context.preprod_mithril_endpoint.as_str(),
            ),
            CoreHealthCheckType::HermesDaemon => check_hermes_daemon_service(),
        };
    }

    match check_type {
        CoreHealthCheckType::Gateway => check_gateway_service_readiness(),
        CoreHealthCheckType::Dapp => check_dapp_service_readiness(),
        CoreHealthCheckType::CardanoNode => check_container_only("cardano-node"),
        CoreHealthCheckType::Postgres => check_postgres_service(),
        CoreHealthCheckType::Yaci => check_container_with_optional_port(
            "yaci-store-1",
            8081,
            "Running on port 8081",
            "Container running",
        ),
        CoreHealthCheckType::Kupo => check_container_with_optional_port(
            "cardano-kupo",
            1442,
            "Running on port 1442",
            "Container running",
        ),
        CoreHealthCheckType::Ogmios => check_container_with_optional_port(
            "ogmios",
            1337,
            "Running on port 1337",
            "Container running",
        ),
        CoreHealthCheckType::Mithril => check_mithril_service(
            context.mithril_dir.as_path(),
            context.core_cardano_network,
            context.preprod_mithril_endpoint.as_str(),
        ),
        CoreHealthCheckType::HermesDaemon => check_hermes_daemon_service(),
    }
}

fn collect_health_statuses(
    project_root_path: &Path,
    context: &HealthContext,
) -> Vec<HealthServiceStatus> {
    let mut statuses = CORE_SERVICE_IDS
        .iter()
        .map(|service| {
            let (healthy, status) = run_core_health_check(service.check_type(), context);
            HealthServiceStatus {
                name: service.name().to_string(),
                label: service.label().to_string(),
                healthy,
                status,
            }
        })
        .collect::<Vec<_>>();

    statuses.extend(collect_optional_chain_health_statuses(project_root_path));
    statuses
}

fn collect_optional_chain_health_statuses(project_root_path: &Path) -> Vec<HealthServiceStatus> {
    let mut optional_statuses = Vec::new();

    for adapter in chains::registered_chain_adapters() {
        let flags = chains::ChainFlags::new();
        let default_network = adapter.default_network();
        let mut network_results: Vec<(String, Result<Vec<HealthServiceStatus>, String>)> =
            Vec::new();

        for network in adapter
            .supported_networks()
            .iter()
            .map(|network| network.name)
        {
            let result = adapter
                .health(project_root_path, network, &flags)
                .map(|statuses| {
                    statuses
                        .into_iter()
                        .map(|status| HealthServiceStatus {
                            name: status.id.to_string(),
                            label: format!("{} (network: {})", status.label, network),
                            healthy: status.healthy,
                            status: status.status,
                        })
                        .collect::<Vec<_>>()
                });
            network_results.push((network.to_string(), result));
        }

        // Prefer default-network health when it is healthy.
        let default_healthy = network_results.iter().find_map(|(network, result)| {
            if network == default_network {
                result
                    .as_ref()
                    .ok()
                    .filter(|statuses| statuses.iter().any(|status| status.healthy))
                    .cloned()
            } else {
                None
            }
        });

        // If the default network is down, surface any healthy non-default network
        // (for example Injective testnet while Injective local is not running).
        let non_default_healthy = network_results.iter().find_map(|(network, result)| {
            if network != default_network {
                result
                    .as_ref()
                    .ok()
                    .filter(|statuses| statuses.iter().any(|status| status.healthy))
                    .cloned()
            } else {
                None
            }
        });

        // If nothing is healthy, prefer a non-default network status before falling back
        // to default. This avoids misleading "local node down" reports when users are
        // operating testnet/mainnet profiles.
        let non_default_any = network_results.iter().find_map(|(network, result)| {
            if network != default_network {
                result.as_ref().ok().cloned()
            } else {
                None
            }
        });

        // If still nothing else is available, keep default-network behavior.
        let default_any = network_results.iter().find_map(|(network, result)| {
            if network == default_network {
                result.as_ref().ok().cloned()
            } else {
                None
            }
        });

        let fallback_any = network_results
            .iter()
            .find_map(|(_, result)| result.as_ref().ok().cloned());

        if let Some(statuses) = default_healthy
            .or(non_default_healthy)
            .or(non_default_any)
            .or(default_any)
            .or(fallback_any)
        {
            optional_statuses.extend(statuses);
            continue;
        }

        let error_message = network_results
            .iter()
            .find_map(|(network, result)| {
                if network == default_network {
                    result.as_ref().err().cloned()
                } else {
                    None
                }
            })
            .or_else(|| {
                network_results
                    .iter()
                    .find_map(|(_, result)| result.as_ref().err().cloned())
            })
            .unwrap_or_else(|| "unknown optional chain health error".to_string());

        optional_statuses.push(HealthServiceStatus {
            name: adapter.id().to_string(),
            label: format!("{} (optional chain)", adapter.display_name()),
            healthy: false,
            status: format!("Failed to run adapter health check: {}", error_message),
        });
    }

    optional_statuses
}

fn available_health_service_names(project_root_path: &Path, context: &HealthContext) -> String {
    collect_health_statuses(project_root_path, context)
        .into_iter()
        .map(|service| service.name)
        .collect::<Vec<_>>()
        .join(", ")
}

pub(crate) fn check_core_service_health(
    project_root_path: &Path,
    service: CoreServiceId,
) -> (bool, String) {
    let context = build_health_context(project_root_path);
    run_core_health_check(service.check_type(), &context)
}

pub(crate) fn check_health_target(
    project_root_path: &Path,
    target: HealthTarget,
) -> Result<(bool, String), String> {
    match target {
        HealthTarget::Core(service) => Ok(check_core_service_health(project_root_path, service)),
    }
}

/// Comprehensive health check for all bridge services
pub fn comprehensive_health_check(
    project_root_path: &Path,
    service_filter: Option<&str>,
) -> Result<String, Box<dyn std::error::Error>> {
    let context = build_health_context(project_root_path);
    let mut services = collect_health_statuses(project_root_path, &context);

    if let Some(filter) = service_filter {
        services.retain(|service| service.name == filter);
        if services.is_empty() {
            return Err(format!(
                "Unknown service: {}. Supported services: {}",
                filter,
                available_health_service_names(project_root_path, &context)
            )
            .into());
        }
    }

    let mut result = String::new();
    result.push_str("\nBridge Health Check\n");
    result.push_str("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n");

    let services_checked = services.len();
    let mut services_healthy = 0;

    for service in services {
        if service.healthy {
            services_healthy += 1;
        }

        let status_symbol = if service.healthy { "[OK]" } else { "[FAIL]" };
        result.push_str(&format!("{} {}\n", status_symbol, service.label));
        result.push_str(&format!("    {}\n\n", service.status));
    }

    result.push_str("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

    if services_healthy == services_checked {
        result.push_str(&format!(
            "All {} service(s) are healthy\n",
            services_checked
        ));
    } else {
        result.push_str(&format!(
            "WARNING: {}/{} service(s) healthy, {} need attention\n",
            services_healthy,
            services_checked,
            services_checked - services_healthy
        ));
    }

    Ok(result)
}

fn docker_running_container_name(name_filter: &str) -> Option<String> {
    let filter = format!("name={name_filter}");
    let output = DockerCli::new(Path::new("."))
        .raw_output(
            [
                "ps",
                "--filter",
                filter.as_str(),
                "--filter",
                "status=running",
                "--format",
                "{{.Names}}",
            ]
            .as_slice(),
        )
        .ok()?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    stdout
        .lines()
        .find(|line| !line.trim().is_empty())
        .map(|line| line.trim().to_string())
}

fn is_port_accessible(port: u16) -> bool {
    SystemChecks::tcp_port_open("localhost", port)
}

fn endpoint_responds(url: &str) -> bool {
    HttpHealthClient::new(Duration::from_secs(5), Duration::from_secs(8))
        .ok()
        .map(|client| client.responds_ok(url))
        .unwrap_or(false)
}

fn summarize_gateway_readiness_body(body: &str) -> String {
    if let Ok(parsed) = serde_json::from_str::<Value>(body) {
        if let Some(message) = parsed
            .pointer("/history/message")
            .and_then(|value| value.as_str())
        {
            return summarize_text(message);
        }

        if let Some(detail) = parsed.get("detail").and_then(|value| value.as_str()) {
            if let Ok(parsed_detail) = serde_json::from_str::<Value>(detail) {
                if let Some(error) = parsed_detail.get("error").and_then(|value| value.as_str()) {
                    return summarize_text(error);
                }
            }
            return summarize_text(detail);
        }
    }

    summarize_text(body)
}

fn summarize_text(body: &str) -> String {
    let condensed = body.split_whitespace().collect::<Vec<_>>().join(" ");
    if condensed.is_empty() {
        return "<empty response>".to_string();
    }

    const MAX_LEN: usize = 240;
    if condensed.len() <= MAX_LEN {
        condensed
    } else {
        format!("{}...", &condensed[..MAX_LEN])
    }
}

fn check_gateway_http_readiness_once() -> (bool, String) {
    let output = Command::new("curl")
        .args([
            "-sS",
            "--noproxy",
            "*",
            "--connect-timeout",
            "5",
            "--max-time",
            "30",
            "-w",
            "\n%{http_code}",
            "http://127.0.0.1:8000/health/ready",
        ])
        .output();

    let output = match output {
        Ok(output) => output,
        Err(error) => {
            return (
                false,
                format!("Gateway proof readiness endpoint unreachable: {}", error),
            );
        }
    };

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut lines = stdout.lines().collect::<Vec<_>>();
    let status_code = lines.pop().unwrap_or("000").trim();
    let body = lines.join("\n");
    let summary = summarize_gateway_readiness_body(body.as_str());

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return (
            false,
            format!(
                "Gateway proof readiness endpoint unreachable: {}",
                summarize_gateway_readiness_body(stderr.as_ref())
            ),
        );
    }

    match status_code.parse::<u16>() {
        Ok(code) if (200..300).contains(&code) => (
            true,
            format!("Gateway proof readiness endpoint passed: {}", summary),
        ),
        Ok(code) => (
            false,
            format!(
                "Gateway proof readiness endpoint returned {}: {}",
                code, summary
            ),
        ),
        Err(_) => (
            false,
            format!(
                "Gateway proof readiness endpoint returned invalid HTTP status '{}': {}",
                status_code, summary
            ),
        ),
    }
}

fn check_gateway_http_readiness() -> (bool, String) {
    let mut last_status = "Gateway proof readiness endpoint did not complete".to_string();

    for attempt in 0..GATEWAY_HTTP_READINESS_ATTEMPTS {
        let (ready, status) = check_gateway_http_readiness_once();
        if ready {
            return (true, status);
        }

        last_status = status;
        if attempt + 1 < GATEWAY_HTTP_READINESS_ATTEMPTS {
            thread::sleep(Duration::from_millis(
                GATEWAY_HTTP_READINESS_RETRY_INTERVAL_MILLIS,
            ));
        }
    }

    (false, last_status)
}

fn check_gateway_service_readiness() -> (bool, String) {
    if docker_running_container_name("gateway-app").is_none() {
        return (false, "Container not running".to_string());
    }

    if !is_port_accessible(5001) {
        return (
            false,
            "Container running but gRPC port 5001 not ready".to_string(),
        );
    }

    let (ready, readiness_status) = check_gateway_http_readiness();
    if ready {
        (
            true,
            format!(
                "Container running, gRPC port 5001 accessible, {}",
                readiness_status
            ),
        )
    } else {
        (false, readiness_status)
    }
}

fn check_dapp_service_readiness() -> (bool, String) {
    if docker_running_container_name(IBC_SWAP_DAPP_SERVICE).is_none() {
        return (false, "Container not running".to_string());
    }

    let port = match ibc_swap_host_port() {
        Ok(port) => port,
        Err(error) => return (false, error),
    };

    if !is_port_accessible(port) {
        return (
            false,
            format!("Container running but port {} not ready", port),
        );
    }

    let url = format!("http://127.0.0.1:{port}");
    if endpoint_responds(url.as_str()) {
        (
            true,
            format!("Next.js UI reachable at {}", ibc_swap_dapp_url()),
        )
    } else {
        (
            false,
            format!(
                "Port {} is accessible but {} did not return a successful HTTP response",
                port, url
            ),
        )
    }
}

fn check_container_only(name_filter: &str) -> (bool, String) {
    if docker_running_container_name(name_filter).is_some() {
        (true, "Container running".to_string())
    } else {
        (false, "Container not running".to_string())
    }
}

fn check_container_with_optional_port(
    name_filter: &str,
    port: u16,
    ready_message: &str,
    not_ready_message: &str,
) -> (bool, String) {
    if docker_running_container_name(name_filter).is_none() {
        return (false, "Container not running".to_string());
    }

    if is_port_accessible(port) {
        (true, ready_message.to_string())
    } else {
        (true, not_ready_message.to_string())
    }
}

fn check_postgres_service() -> (bool, String) {
    let Some(container_name) = docker_running_container_name("cardano-postgres") else {
        return (false, "Container not running".to_string());
    };

    let ready = DockerCli::new(Path::new("."))
        .raw_output(
            [
                "exec",
                container_name.as_str(),
                "pg_isready",
                "-U",
                "postgres",
            ]
            .as_slice(),
        )
        .ok()
        .is_some_and(|output| output.status.success());

    if ready {
        (
            true,
            "Gateway app database accepting connections on port 6432".to_string(),
        )
    } else {
        (true, "Container running".to_string())
    }
}

fn check_mithril_service(
    mithril_dir: &Path,
    core_cardano_network: config::CoreCardanoNetwork,
    preprod_mithril_endpoint: &str,
) -> (bool, String) {
    if !core_cardano_network.uses_local_mithril() {
        let artifact_url = format!("{}/artifact/snapshots", preprod_mithril_endpoint);
        let healthy = endpoint_responds(artifact_url.as_str());
        return if healthy {
            (
                true,
                format!(
                    "Public Mithril release-preprod reachable at {}",
                    preprod_mithril_endpoint
                ),
            )
        } else {
            (
                false,
                format!(
                    "Failed to query public Mithril release-preprod at {}",
                    preprod_mithril_endpoint
                ),
            )
        };
    }

    let mithril_compose = mithril_dir.join("scripts/docker-compose.yaml");
    if !mithril_compose.exists() {
        return (
            false,
            "Not configured (missing chains/mithrils/scripts/docker-compose.yaml)".to_string(),
        );
    }

    let aggregator_running = docker_running_container_name("mithril-aggregator").is_some();
    let signer_1_running = docker_running_container_name("mithril-signer-1").is_some();
    let signer_2_running = docker_running_container_name("mithril-signer-2").is_some();
    let aggregator_port_accessible = is_port_accessible(8080);

    let aggregator_status = if aggregator_running {
        if aggregator_port_accessible {
            "running (port 8080 accessible)"
        } else {
            "running (port 8080 not ready yet)"
        }
    } else {
        "not running"
    };
    let signer_1_status = if signer_1_running {
        "running"
    } else {
        "not running"
    };
    let signer_2_status = if signer_2_running {
        "running"
    } else {
        "not running"
    };

    let is_healthy = aggregator_running && signer_1_running && signer_2_running;
    (
        is_healthy,
        format!(
            "Aggregator: {}; Signer 1: {}; Signer 2: {}",
            aggregator_status, signer_1_status, signer_2_status
        ),
    )
}

fn check_hermes_daemon_service() -> (bool, String) {
    let expected_binary =
        Path::new(config::get_config().project_root.as_str()).join("relayer/target/release/hermes");
    let expected_binary_str = expected_binary.to_str();

    if let Some(pid) = read_hermes_pid_file() {
        if is_process_alive(pid) && is_expected_hermes_daemon_pid(pid, expected_binary_str) {
            let home = home_dir().unwrap_or_default();
            let log_file = home.join(".hermes/hermes.log");

            if log_file.exists() {
                return (true, format!("Daemon running (pid={})", pid));
            }

            return (true, format!("Process running (pid={})", pid));
        }

        remove_hermes_pid_file();
        return (false, format!("Daemon pid file was stale (pid={})", pid));
    }

    let daemon_running = find_running_hermes_daemon(expected_binary_str);
    if daemon_running {
        return (true, "Process running without managed pid file".to_string());
    }

    (false, "Daemon not running".to_string())
}

fn find_running_hermes_daemon(expected_binary_path: Option<&str>) -> bool {
    match SystemChecks::find_processes_by_command() {
        Ok(output) => output
            .lines()
            .filter_map(parse_pid_and_command)
            .any(|(_, command)| is_hermes_daemon_command(command.as_str(), expected_binary_path)),
        Err(_) => false,
    }
}

fn parse_pid_and_command(line: &str) -> Option<(u32, String)> {
    let trimmed = line.trim_start();
    if trimmed.is_empty() {
        return None;
    }

    let mut parts = trimmed.splitn(2, char::is_whitespace);
    let pid_str = parts.next()?;
    let command = parts.next().unwrap_or("").trim_start().to_string();
    let pid = pid_str.parse::<u32>().ok()?;

    Some((pid, command))
}
