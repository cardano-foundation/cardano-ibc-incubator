use std::env;
use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::process::Command;

use async_trait::async_trait;
use console::style;
use dirs::home_dir;
use fs_extra::{copy_items, file::copy};
use indicatif::{ProgressBar, ProgressStyle};
use serde_json::Value;

use crate::chains::{
    check_port_health, check_rpc_health, parse_bool_flag, ChainAdapter, ChainFlagSpec, ChainFlags,
    ChainHealthStatus, ChainNetwork, ChainStartRequest,
};
use crate::config;
use crate::constants::ENTRYPOINT_CHAIN_ID;
use crate::logger::{self, log, log_or_show_progress, verbose, warn};
use crate::setup::download_repository;
use crate::utils::{
    execute_script, execute_script_interactive, extract_tendermint_client_id,
    extract_tendermint_connection_id, wait_for_health_check,
};

pub struct OsmosisChainAdapter;

pub static OSMOSIS_CHAIN_ADAPTER: OsmosisChainAdapter = OsmosisChainAdapter;

const OSMOSIS_TESTNET_STATUS_URL: &str = "https://rpc-test.osmosis.zone/status";
const OSMOSIS_SOURCE_ZIP_URL: &str =
    "https://github.com/osmosis-labs/osmosis/archive/refs/tags/v30.0.1.zip";

const OSMOSIS_NETWORKS: [ChainNetwork; 2] = [
    ChainNetwork {
        name: "local",
        description: "Local Docker-based appchain and Redis sidecar",
        managed_by_caribic: true,
    },
    ChainNetwork {
        name: "testnet",
        description: "Public Osmosis testnet endpoint",
        managed_by_caribic: false,
    },
];

const OSMOSIS_LOCAL_FLAGS: [ChainFlagSpec; 1] = [ChainFlagSpec {
    name: "stateful",
    description: "Keep local Osmosis state instead of resetting it",
    required: false,
}];

const OSMOSIS_TESTNET_FLAGS: [ChainFlagSpec; 1] = [ChainFlagSpec {
    name: "rpc-url",
    description: "Osmosis testnet RPC status endpoint URL",
    required: false,
}];

#[async_trait]
impl ChainAdapter for OsmosisChainAdapter {
    fn id(&self) -> &'static str {
        "osmosis"
    }

    fn display_name(&self) -> &'static str {
        "Osmosis"
    }

    fn default_network(&self) -> &'static str {
        "local"
    }

    fn supported_networks(&self) -> &'static [ChainNetwork] {
        &OSMOSIS_NETWORKS
    }

    fn supported_flags(&self, network: &str) -> &'static [ChainFlagSpec] {
        match network {
            "local" => &OSMOSIS_LOCAL_FLAGS,
            "testnet" => &OSMOSIS_TESTNET_FLAGS,
            _ => &[],
        }
    }

    async fn start(
        &self,
        project_root_path: &Path,
        request: &ChainStartRequest<'_>,
    ) -> Result<(), String> {
        self.validate_flags(request.network, request.flags)?;

        match request.network {
            "local" => {
                let stateful = parse_bool_flag(request.flags, "stateful", false)?;
                if stateful {
                    warn(
                        "Local Osmosis 'stateful=true' was requested, but this mode is not wired yet. Proceeding with clean local setup.",
                    );
                }

                let osmosis_dir = workspace_dir(project_root_path);
                prepare_local(osmosis_dir.as_path())
                    .await
                    .map_err(|error| format!("Failed to prepare Osmosis appchain: {}", error))?;
                start_local(osmosis_dir.as_path())
                    .await
                    .map_err(|error| format!("Failed to start Osmosis appchain: {}", error))?;
                Ok(())
            }
            "testnet" => {
                let rpc_url = request
                    .flags
                    .get("rpc-url")
                    .cloned()
                    .unwrap_or_else(|| OSMOSIS_TESTNET_STATUS_URL.to_string());
                let status = check_rpc_health(
                    rpc_url.as_str(),
                    443,
                    "Osmosis testnet RPC endpoint (external)",
                );
                if !status.healthy {
                    return Err(format!(
                        "Osmosis testnet endpoint is unreachable: {}",
                        status.status
                    ));
                }
                Ok(())
            }
            _ => Err(format!(
                "Unsupported network '{}' for chain '{}'",
                request.network,
                self.id()
            )),
        }
    }

    fn stop(
        &self,
        project_root_path: &Path,
        network: &str,
        flags: &ChainFlags,
    ) -> Result<(), String> {
        self.validate_flags(network, flags)?;

        match network {
            "local" => {
                let osmosis_dir = workspace_dir(project_root_path);
                stop_local(osmosis_dir.as_path());
                Ok(())
            }
            "testnet" => Ok(()),
            _ => Err(format!(
                "Unsupported network '{}' for chain '{}'",
                network,
                self.id()
            )),
        }
    }

    fn health(
        &self,
        _project_root_path: &Path,
        network: &str,
        flags: &ChainFlags,
    ) -> Result<Vec<ChainHealthStatus>, String> {
        self.validate_flags(network, flags)?;

        match network {
            "local" => {
                let osmosis_status_url = config::get_config().health.osmosis_status_url;
                Ok(vec![
                    check_rpc_health(osmosis_status_url.as_str(), 26658, "Osmosis appchain (RPC)"),
                    check_port_health(6379, "Osmosis Redis sidecar"),
                ])
            }
            "testnet" => {
                let rpc_url = flags
                    .get("rpc-url")
                    .cloned()
                    .unwrap_or_else(|| OSMOSIS_TESTNET_STATUS_URL.to_string());
                Ok(vec![check_rpc_health(
                    rpc_url.as_str(),
                    443,
                    "Osmosis testnet RPC endpoint (external)",
                )])
            }
            _ => Err(format!(
                "Unsupported network '{}' for chain '{}'",
                network,
                self.id()
            )),
        }
    }
}

/// Returns the local workspace directory used by Osmosis scripts and docker compose.
pub fn workspace_dir(project_root: &Path) -> PathBuf {
    project_root
        .join("chains")
        .join("osmosis")
        .join("osmosis")
        .to_path_buf()
}

/// Stops local Osmosis containers if they exist.
pub fn stop_local(osmosis_path: &Path) {
    let _ = execute_script(osmosis_path, "make", Vec::from(["localnet-stop"]), None);
}

/// Configures Hermes keys, clients, connection, and channel for Entrypoint↔Osmosis.
pub fn configure_hermes_for_demo(osmosis_dir: &Path) -> Result<(), Box<dyn std::error::Error>> {
    let optional_progress_bar = match logger::get_verbosity() {
        logger::Verbosity::Verbose => None,
        _ => Some(ProgressBar::new_spinner()),
    };

    if let Some(progress_bar) = &optional_progress_bar {
        progress_bar.set_style(ProgressStyle::with_template("{prefix:.bold} {wide_msg}").unwrap());
        progress_bar.set_prefix(
            "Configuring Hermes for Cardano↔Entrypoint and Entrypoint↔Osmosis channels ..."
                .to_owned(),
        );
    } else {
        log("Configuring Hermes for Cardano↔Entrypoint and Entrypoint↔Osmosis channels ...");
    }

    log_or_show_progress(
        &format!(
            "{} Prepare hermes configuration files and keys",
            style("Step 1/4").bold().dim()
        ),
        &optional_progress_bar,
    );

    let script_dir = osmosis_dir.join("scripts");
    ensure_chain_in_hermes_config(
        script_dir.as_path(),
        "localosmosis",
        "Local Osmosis chain used by token-swap demo",
    )?;
    let hermes_binary = resolve_local_hermes_binary(osmosis_dir)?;
    let hermes_binary_str = hermes_binary.to_str().ok_or_else(|| {
        format!(
            "Hermes binary path is not valid UTF-8: {}",
            hermes_binary.display()
        )
    })?;
    verbose(&format!(
        "Using Hermes binary at {}",
        hermes_binary.display()
    ));

    execute_script(
        script_dir.as_path(),
        hermes_binary_str,
        Vec::from([
            "keys",
            "add",
            "--overwrite",
            "--chain",
            ENTRYPOINT_CHAIN_ID,
            "--mnemonic-file",
            osmosis_dir.join("scripts/hermes/cosmos").to_str().unwrap(),
        ]),
        None,
    )?;

    execute_script(
        script_dir.as_path(),
        hermes_binary_str,
        Vec::from([
            "keys",
            "add",
            "--overwrite",
            "--chain",
            "localosmosis",
            "--mnemonic-file",
            osmosis_dir.join("scripts/hermes/osmosis").to_str().unwrap(),
        ]),
        None,
    )?;

    log_or_show_progress(
        &format!(
            "{} Setup clients on both chains",
            style("Step 2/4").bold().dim()
        ),
        &optional_progress_bar,
    );

    let mut local_osmosis_client_id = None;
    for _ in 0..10 {
        let hermes_create_client_output = Command::new(&hermes_binary)
            .current_dir(&script_dir)
            .args(&[
                "create",
                "client",
                "--host-chain",
                "localosmosis",
                "--reference-chain",
                ENTRYPOINT_CHAIN_ID,
            ])
            .output()
            .expect("Failed to create osmosis client");

        verbose(&format!(
            "status: {}, stdout: {}, stderr: {}",
            hermes_create_client_output.status,
            String::from_utf8_lossy(&hermes_create_client_output.stdout),
            String::from_utf8_lossy(&hermes_create_client_output.stderr)
        ));

        local_osmosis_client_id = extract_tendermint_client_id(hermes_create_client_output);

        if local_osmosis_client_id.is_none() {
            verbose("Failed to create client. Retrying in 5 seconds...");
            std::thread::sleep(std::time::Duration::from_secs(5));
        } else {
            break;
        }
    }

    if let Some(local_osmosis_client_id) = local_osmosis_client_id {
        verbose(&format!(
            "localosmosis_client_id: {}",
            local_osmosis_client_id
        ));

        let create_entrypoint_chain_client_output = Command::new(&hermes_binary)
            .current_dir(&script_dir)
            .args(&[
                "create",
                "client",
                "--host-chain",
                ENTRYPOINT_CHAIN_ID,
                "--reference-chain",
                "localosmosis",
                "--trusting-period",
                "86000s",
            ])
            .output()
            .expect("Failed to query clients");

        let entrypoint_chain_client_id =
            extract_tendermint_client_id(create_entrypoint_chain_client_output);

        if let Some(entrypoint_chain_client_id) = entrypoint_chain_client_id {
            verbose(&format!(
                "entrypoint_chain_client_id: {}",
                entrypoint_chain_client_id
            ));

            log_or_show_progress(
                &format!(
                    "{} Create a connection between both clients",
                    style("Step 3/4").bold().dim()
                ),
                &optional_progress_bar,
            );
            let create_connection_output = Command::new(&hermes_binary)
                .current_dir(&script_dir)
                .args(&[
                    "create",
                    "connection",
                    "--a-chain",
                    ENTRYPOINT_CHAIN_ID,
                    "--a-client",
                    entrypoint_chain_client_id.as_str(),
                    "--b-client",
                    &local_osmosis_client_id,
                ])
                .output()
                .expect("Failed to create connection");

            verbose(&format!(
                "status: {}, stdout: {}, stderr: {}",
                &create_connection_output.status,
                String::from_utf8_lossy(&create_connection_output.stdout),
                String::from_utf8_lossy(&create_connection_output.stderr)
            ));

            let connection_id = extract_tendermint_connection_id(create_connection_output);

            if let Some(connection_id) = connection_id {
                verbose(&format!("connection_id: {}", connection_id));

                log_or_show_progress(
                    &format!("{} Create a channel", style("Step 4/4").bold().dim()),
                    &optional_progress_bar,
                );
                let create_channel_output = Command::new(&hermes_binary)
                    .current_dir(&script_dir)
                    .args(&[
                        "create",
                        "channel",
                        "--a-chain",
                        ENTRYPOINT_CHAIN_ID,
                        "--a-connection",
                        &connection_id,
                        "--a-port",
                        "transfer",
                        "--b-port",
                        "transfer",
                    ])
                    .output()
                    .expect("Failed to query channels");

                if create_channel_output.status.success() {
                    verbose(&format!(
                        "{}",
                        String::from_utf8_lossy(&create_channel_output.stdout)
                    ));
                } else {
                    return Err("Failed to get channel_id".into());
                }
            } else {
                return Err("Failed to get connection_id".into());
            }
        } else {
            return Err("Failed to get entrypoint chain client_id".into());
        }
    } else {
        return Err("Failed to get localosmosis client_id".into());
    }

    if let Some(progress_bar) = &optional_progress_bar {
        progress_bar.finish_and_clear();
    }

    Ok(())
}

async fn prepare_local(osmosis_dir: &Path) -> Result<(), Box<dyn std::error::Error>> {
    ensure_osmosisd_available(osmosis_dir).await?;
    copy_local_config_files(osmosis_dir)?;
    verbose("PASS: Osmosis configuration files copied successfully");
    init_local_network(osmosis_dir)?;
    Ok(())
}

async fn start_local(osmosis_dir: &Path) -> Result<(), Box<dyn std::error::Error>> {
    let optional_progress_bar = match logger::get_verbosity() {
        logger::Verbosity::Verbose => None,
        _ => Some(ProgressBar::new_spinner()),
    };

    if let Some(progress_bar) = &optional_progress_bar {
        progress_bar.set_style(ProgressStyle::with_template("{prefix:.bold} {wide_msg}").unwrap());
        progress_bar.set_prefix("Starting Osmosis appchain ...".to_owned());
    } else {
        log("Starting Osmosis appchain ...");
    }

    let status = execute_script(
        osmosis_dir,
        "docker",
        Vec::from([
            "compose",
            "-f",
            "tests/localosmosis/docker-compose.yml",
            "up",
            "-d",
        ]),
        Some(Vec::from([(
            "OSMOSISD_CONTAINER_NAME",
            "localosmosis-osmosisd-1",
        )])),
    );

    if status.is_ok() {
        log_or_show_progress(
            "Waiting for the Osmosis appchain to become healthy ...",
            &optional_progress_bar,
        );

        let osmosis_status_url = config::get_config().health.osmosis_status_url;
        let is_healthy = wait_for_health_check(
            osmosis_status_url.as_str(),
            30,
            3000,
            Some(|response_body: &String| {
                let json: Value = serde_json::from_str(&response_body).unwrap_or_default();

                if let Some(height) = json["result"]["sync_info"]["latest_block_height"]
                    .as_str()
                    .and_then(|h| h.parse::<u64>().ok())
                {
                    verbose(&format!("Current block height: {}", height));
                    return height > 0;
                }

                verbose(&format!(
                    "Failed to get the current block height from the response {}",
                    response_body,
                ));

                false
            }),
        )
        .await;

        if let Some(progress_bar) = &optional_progress_bar {
            progress_bar.finish_and_clear();
        }
        if is_healthy.is_ok() {
            Ok(())
        } else {
            Err(format!("Run into timeout while checking {}", osmosis_status_url).into())
        }
    } else {
        if let Some(progress_bar) = &optional_progress_bar {
            progress_bar.finish_and_clear();
        }

        Err(status.unwrap_err().into())
    }
}

async fn ensure_osmosisd_available(osmosis_dir: &Path) -> Result<(), Box<dyn std::error::Error>> {
    if osmosis_dir.exists() {
        verbose("Osmosis directory already exists");
    } else {
        download_osmosis_source(osmosis_dir).await?;
    }

    let mut binary = locate_osmosisd_binary();
    if binary.is_none() {
        log("ERROR: osmosisd is not installed or not available in the PATH.");

        let should_continue = prompt_and_install_osmosisd(osmosis_dir).await?;
        if !should_continue {
            return Err("osmosisd is required for local Osmosis startup".into());
        }

        binary = locate_osmosisd_binary();
    }

    let (osmosisd_binary, path_visible) =
        binary.ok_or("osmosisd is still not available after install step")?;

    match Command::new(&osmosisd_binary).arg("version").output() {
        Ok(output) if output.status.success() => {
            let stdout_version = String::from_utf8_lossy(&output.stdout);
            let stderr_version = String::from_utf8_lossy(&output.stderr);
            let version_line = stdout_version
                .lines()
                .next()
                .or_else(|| stderr_version.lines().next())
                .unwrap_or("version unavailable");

            verbose(&format!(
                "PASS: osmosisd {} ({})",
                version_line,
                osmosisd_binary.display()
            ));

            if !path_visible {
                warn(&format!(
                    "osmosisd is installed at {} but not visible in PATH. Add '$HOME/go/bin' to PATH for direct shell usage.",
                    osmosisd_binary.display()
                ));
            }
        }
        Ok(output) => {
            return Err(format!(
                "osmosisd exists at {} but 'osmosisd version' failed (exit code {})",
                osmosisd_binary.display(),
                output.status.code().unwrap_or(-1)
            )
            .into());
        }
        Err(error) => {
            return Err(format!(
                "Failed to run osmosisd at {}: {}",
                osmosisd_binary.display(),
                error
            )
            .into());
        }
    }

    Ok(())
}

async fn download_osmosis_source(osmosis_path: &Path) -> Result<(), Box<dyn std::error::Error>> {
    download_repository(OSMOSIS_SOURCE_ZIP_URL, osmosis_path, "osmosis").await
}

async fn prompt_and_install_osmosisd(
    osmosis_path: &Path,
) -> Result<bool, Box<dyn std::error::Error>> {
    let question = "Do you want to install osmosisd? (yes/no): ";
    print!("{}", question);
    io::stdout().flush()?;

    let mut input = String::new();
    io::stdin().read_line(&mut input)?;
    let input = input.trim().to_lowercase();

    if input == "yes" || input == "y" {
        println!("{} Installing osmosisd...", style("Step 1/1").bold().dim());

        let output = Command::new("make")
            .current_dir(osmosis_path)
            .arg("install")
            .output()
            .map_err(|error| format!("Failed to run make install for osmosisd: {}", error))?;

        if !output.status.success() {
            return Err(format!(
                "Failed to install osmosisd:\n{}",
                String::from_utf8_lossy(&output.stderr)
            )
            .into());
        }

        println!("PASS: osmosisd installed successfully");
        Ok(true)
    } else {
        Ok(false)
    }
}

fn locate_osmosisd_binary() -> Option<(PathBuf, bool)> {
    if let Some(path_var) = env::var_os("PATH") {
        for directory in env::split_paths(&path_var) {
            let candidate = directory.join("osmosisd");
            if candidate.is_file() {
                return Some((candidate, true));
            }
        }
    }

    home_dir().and_then(|home| {
        let candidate = home.join("go/bin/osmosisd");
        if candidate.is_file() {
            Some((candidate, false))
        } else {
            None
        }
    })
}

fn resolve_local_hermes_binary(osmosis_dir: &Path) -> Result<PathBuf, Box<dyn std::error::Error>> {
    let mut current = Some(osmosis_dir);
    while let Some(directory) = current {
        let candidate = directory.join("relayer/target/release/hermes");
        if candidate.is_file() {
            return Ok(candidate);
        }
        current = directory.parent();
    }

    Err("Hermes binary not found at relayer/target/release/hermes. Run 'caribic start relayer' first so the demo uses the local Cardano-enabled Hermes binary.".into())
}

fn ensure_chain_in_hermes_config(
    script_dir: &Path,
    chain_id: &str,
    inserted_block_comment: &str,
) -> Result<(), Box<dyn std::error::Error>> {
    let home_path = home_dir().ok_or("Could not determine home directory")?;
    let hermes_dir = home_path.join(".hermes");
    if !hermes_dir.exists() {
        fs::create_dir_all(&hermes_dir)?;
    }

    let destination_config_path = hermes_dir.join("config.toml");
    if !destination_config_path.exists() {
        return Err(format!(
            "Hermes config not found at {}. Run relayer setup first.",
            destination_config_path.display()
        )
        .into());
    }

    let mut destination_config = fs::read_to_string(&destination_config_path).map_err(|e| {
        format!(
            "Failed to read Hermes config at {}: {}",
            destination_config_path.display(),
            e
        )
    })?;

    let source_config_path = {
        let canonical_source = script_dir.join("../../configuration/hermes/config.toml");
        if canonical_source.exists() {
            canonical_source
        } else {
            script_dir.join("hermes/config.toml")
        }
    };
    let source_config = fs::read_to_string(&source_config_path).map_err(|e| {
        format!(
            "Failed to read Osmosis Hermes config at {}: {}",
            source_config_path.display(),
            e
        )
    })?;

    let chain_block = extract_chain_block(&source_config, chain_id).ok_or_else(|| {
        format!(
            "Failed to find chain '{}' block in {}",
            chain_id,
            source_config_path.display()
        )
    })?;

    if let Some(existing_block) = extract_chain_block(&destination_config, chain_id) {
        if existing_block.trim() == chain_block.trim() {
            return Ok(());
        }

        destination_config = replace_chain_block(&destination_config, chain_id, &chain_block)
            .ok_or_else(|| {
                format!(
                    "Failed to update chain '{}' block in {}",
                    chain_id,
                    destination_config_path.display()
                )
            })?;

        fs::write(&destination_config_path, destination_config).map_err(|e| {
            format!(
                "Failed to update Hermes config at {}: {}",
                destination_config_path.display(),
                e
            )
        })?;

        verbose(&format!(
            "Updated '{}' chain block in Hermes config at {}",
            chain_id,
            destination_config_path.display(),
        ));

        return Ok(());
    }

    if !destination_config.ends_with('\n') {
        destination_config.push('\n');
    }
    destination_config.push('\n');
    destination_config.push_str("# ");
    destination_config.push_str(inserted_block_comment);
    destination_config.push('\n');
    destination_config.push_str(&chain_block);
    destination_config.push('\n');

    fs::write(&destination_config_path, destination_config).map_err(|e| {
        format!(
            "Failed to update Hermes config at {}: {}",
            destination_config_path.display(),
            e
        )
    })?;

    verbose(&format!(
        "Added '{}' chain to Hermes config at {}",
        chain_id,
        destination_config_path.display(),
    ));

    Ok(())
}

fn replace_chain_block(
    config: &str,
    target_chain_id: &str,
    replacement_block: &str,
) -> Option<String> {
    let lines: Vec<&str> = config.lines().collect();
    let (block_start, block_end) = find_chain_block_bounds(&lines, target_chain_id)?;

    let mut updated_lines: Vec<&str> = Vec::with_capacity(
        lines.len() - (block_end - block_start) + replacement_block.lines().count(),
    );
    updated_lines.extend_from_slice(&lines[..block_start]);
    updated_lines.extend(replacement_block.lines());
    updated_lines.extend_from_slice(&lines[block_end..]);

    let mut updated = updated_lines.join("\n");
    if !updated.ends_with('\n') {
        updated.push('\n');
    }

    Some(updated)
}

fn find_chain_block_bounds(lines: &[&str], target_chain_id: &str) -> Option<(usize, usize)> {
    let target_id_single_quote = format!("id = '{}'", target_chain_id);
    let target_id_double_quote = format!("id = \"{}\"", target_chain_id);
    let mut index = 0;

    while index < lines.len() {
        if lines[index].trim() != "[[chains]]" {
            index += 1;
            continue;
        }

        let block_start = index;
        let mut block_end = index + 1;
        while block_end < lines.len() && lines[block_end].trim() != "[[chains]]" {
            block_end += 1;
        }

        let block_lines = &lines[block_start..block_end];
        if block_lines.iter().any(|line| {
            let line = line.trim();
            line == target_id_single_quote || line == target_id_double_quote
        }) {
            return Some((block_start, block_end));
        }

        index = block_end;
    }

    None
}

fn extract_chain_block(config: &str, target_chain_id: &str) -> Option<String> {
    let lines: Vec<&str> = config.lines().collect();
    let (block_start, block_end) = find_chain_block_bounds(&lines, target_chain_id)?;
    Some(lines[block_start..block_end].join("\n"))
}

fn init_local_network(osmosis_dir: &Path) -> Result<(), Box<dyn std::error::Error>> {
    if !logger::is_quite() {
        log("Initialize local Osmosis network ...");
    }

    execute_script_interactive(osmosis_dir, "make", Vec::from(["localnet-init"]))?;
    Ok(())
}

fn copy_local_config_files(osmosis_dir: &Path) -> Result<(), fs_extra::error::Error> {
    verbose(&format!(
        "Copying cosmwasm files from {} to {}",
        osmosis_dir.join("../configuration/cosmwasm/wasm").display(),
        osmosis_dir.join("cosmwasm").display()
    ));
    copy_items(
        &vec![osmosis_dir.join("../configuration/cosmwasm/wasm")],
        osmosis_dir.join("cosmwasm"),
        &fs_extra::dir::CopyOptions::new().overwrite(true),
    )?;

    verbose(&format!(
        "Copying hermes files from {} to {}",
        osmosis_dir.join("../configuration/hermes").display(),
        osmosis_dir.join("scripts").display()
    ));
    copy_items(
        &vec![osmosis_dir.join("../configuration/hermes")],
        osmosis_dir.join("scripts"),
        &fs_extra::dir::CopyOptions::new().overwrite(true),
    )?;

    let options = fs_extra::file::CopyOptions::new().overwrite(true);

    verbose(&format!(
        "Copying setup_crosschain_swaps.sh from {} to {}",
        osmosis_dir
            .join("../scripts/setup_crosschain_swaps.sh")
            .display(),
        osmosis_dir
            .join("scripts/setup_crosschain_swaps.sh")
            .display()
    ));
    copy(
        osmosis_dir.join("../scripts/setup_crosschain_swaps.sh"),
        osmosis_dir.join("scripts/setup_crosschain_swaps.sh"),
        &options,
    )?;

    verbose(&format!(
        "Copying localnet.mk from {} to {}",
        osmosis_dir.join("../scripts/localnet.mk").display(),
        osmosis_dir.join("scripts/makefiles/localnet.mk").display()
    ));
    copy(
        osmosis_dir.join("../scripts/localnet.mk"),
        osmosis_dir.join("scripts/makefiles/localnet.mk"),
        &options,
    )?;

    verbose(&format!(
        "Copying setup_osmosis_local.sh from {} to {}",
        osmosis_dir
            .join("../scripts/setup_osmosis_local.sh")
            .display(),
        osmosis_dir
            .join("tests/localosmosis/scripts/setup.sh")
            .display()
    ));
    copy(
        osmosis_dir.join("../scripts/setup_osmosis_local.sh"),
        osmosis_dir.join("tests/localosmosis/scripts/setup.sh"),
        &options,
    )?;

    verbose(&format!(
        "Copying docker-compose.yml from {} to {}",
        osmosis_dir
            .join("../configuration/docker-compose.yml")
            .display(),
        osmosis_dir
            .join("tests/localosmosis/docker-compose.yml")
            .display()
    ));
    copy(
        osmosis_dir.join("../configuration/docker-compose.yml"),
        osmosis_dir.join("tests/localosmosis/docker-compose.yml"),
        &options,
    )?;

    verbose(&format!(
        "Copying Dockerfile from {} to {}",
        osmosis_dir.join("../configuration/Dockerfile").display(),
        osmosis_dir.join("Dockerfile").display()
    ));
    copy(
        osmosis_dir.join("../configuration/Dockerfile"),
        osmosis_dir.join("Dockerfile"),
        &options,
    )?;

    Ok(())
}
