use std::path::Path;
use std::process::{Command, Output};
use std::thread;
use std::time::Duration;

use console::style;
use indicatif::{ProgressBar, ProgressStyle};
use serde_json::Value;

use crate::chains::hermes_support;
use crate::chains::hermes_support::{
    HermesAddressType, HermesCosmosChainProfile, HermesGasPrice, HermesTrustThreshold,
};
use crate::chains::osmosis::config as osmosis_config;
use crate::config;
use crate::logger::{self, log, log_or_show_progress, verbose};
use crate::utils::{
    execute_script, extract_tendermint_client_id, extract_tendermint_connection_id,
    parse_tendermint_client_id,
};

fn entrypoint_chain_id() -> String {
    config::get_config().chains.entrypoint.chain_id
}

/// Configures Hermes keys, clients, connection, and channel for Entrypoint↔Osmosis.
pub(super) fn configure_hermes_for_demo(
    osmosis_dir: &Path,
    network: &str,
) -> Result<(), Box<dyn std::error::Error>> {
    match network {
        "local" => configure_local_hermes_for_demo(osmosis_dir),
        "testnet" => configure_testnet_hermes_for_demo(osmosis_dir),
        other => Err(format!(
            "Unsupported Osmosis network '{}' for Hermes demo configuration",
            other
        )
        .into()),
    }
}

fn configure_local_hermes_for_demo(
    osmosis_dir: &Path,
) -> Result<(), Box<dyn std::error::Error>> {
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
    hermes_support::ensure_cosmos_chain_in_hermes_config(
        &local_chain_profile(),
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
            entrypoint_chain_id().as_str(),
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
            osmosis_config::LOCAL_CHAIN_ID,
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
                osmosis_config::LOCAL_CHAIN_ID,
                "--reference-chain",
                entrypoint_chain_id().as_str(),
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
                entrypoint_chain_id().as_str(),
                "--reference-chain",
                osmosis_config::LOCAL_CHAIN_ID,
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
                    entrypoint_chain_id().as_str(),
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
                        entrypoint_chain_id().as_str(),
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

fn configure_testnet_hermes_for_demo(
    osmosis_dir: &Path,
) -> Result<(), Box<dyn std::error::Error>> {
    let optional_progress_bar = match logger::get_verbosity() {
        logger::Verbosity::Verbose => None,
        _ => Some(ProgressBar::new_spinner()),
    };

    if let Some(progress_bar) = &optional_progress_bar {
        progress_bar.set_style(ProgressStyle::with_template("{prefix:.bold} {wide_msg}").unwrap());
        progress_bar.set_prefix(
            "Configuring Hermes for Entrypoint↔Osmosis testnet channel ...".to_owned(),
        );
    } else {
        log("Configuring Hermes for Entrypoint↔Osmosis testnet channel ...");
    }

    log_or_show_progress(
        &format!(
            "{} Prepare Hermes configuration and keys",
            style("Step 1/4").bold().dim()
        ),
        &optional_progress_bar,
    );

    ensure_testnet_chain_in_hermes_config(osmosis_dir)?;

    let hermes_binary = resolve_local_hermes_binary(osmosis_dir)?;
    if has_open_transfer_channel(
        hermes_binary.as_path(),
        osmosis_dir,
        entrypoint_chain_id().as_str(),
        osmosis_config::TESTNET_CHAIN_ID,
    )? {
        if let Some(progress_bar) = &optional_progress_bar {
            progress_bar.finish_and_clear();
        }
        log("PASS: Hermes transfer channel already open for Entrypoint↔Osmosis");
        return Ok(());
    }

    ensure_entrypoint_demo_key(osmosis_dir, hermes_binary.as_path())?;
    let testnet_profile = testnet_chain_profile();
    if !chain_has_key_named(
        hermes_binary.as_path(),
        osmosis_dir,
        osmosis_config::TESTNET_CHAIN_ID,
        testnet_profile.key_name.as_str(),
    )? {
        return Err(format!(
            "No Hermes key named '{}' configured for chain '{}'. Add one first with:\n  caribic keys add --chain {} --mnemonic-file <path> --key-name {}",
            testnet_profile.key_name,
            osmosis_config::TESTNET_CHAIN_ID,
            osmosis_config::TESTNET_CHAIN_ID,
            testnet_profile.key_name,
        )
        .into());
    }

    log_or_show_progress(
        &format!(
            "{} Setup clients on both chains",
            style("Step 2/4").bold().dim()
        ),
        &optional_progress_bar,
    );

    let osmosis_client_id = create_client_with_retry(
        hermes_binary.as_path(),
        osmosis_dir,
        osmosis_config::TESTNET_CHAIN_ID,
        entrypoint_chain_id().as_str(),
        None,
    )?;
    let entrypoint_client_id = create_client_with_retry(
        hermes_binary.as_path(),
        osmosis_dir,
        entrypoint_chain_id().as_str(),
        osmosis_config::TESTNET_CHAIN_ID,
        Some("86000s"),
    )?;

    log_or_show_progress(
        &format!(
            "{} Create a connection between both clients",
            style("Step 3/4").bold().dim()
        ),
        &optional_progress_bar,
    );

    let create_connection_output = Command::new(&hermes_binary)
        .current_dir(osmosis_dir)
        .args([
            "create",
            "connection",
            "--a-chain",
            entrypoint_chain_id().as_str(),
            "--a-client",
            entrypoint_client_id.as_str(),
            "--b-client",
            osmosis_client_id.as_str(),
        ])
        .output()?;
    if !create_connection_output.status.success() {
        return Err(format!(
            "Failed to create Entrypoint↔Osmosis connection for chain {}:\n{}",
            osmosis_config::TESTNET_CHAIN_ID,
            String::from_utf8_lossy(&create_connection_output.stderr)
        )
        .into());
    }
    let connection_id = extract_tendermint_connection_id(create_connection_output)
        .ok_or("Failed to parse connection id from Hermes output")?;

    log_or_show_progress(
        &format!("{} Create a channel", style("Step 4/4").bold().dim()),
        &optional_progress_bar,
    );

    let create_channel_output = Command::new(&hermes_binary)
        .current_dir(osmosis_dir)
        .args([
            "create",
            "channel",
            "--a-chain",
            entrypoint_chain_id().as_str(),
            "--a-connection",
            connection_id.as_str(),
            "--a-port",
            "transfer",
            "--b-port",
            "transfer",
        ])
        .output()?;
    if !create_channel_output.status.success() {
        return Err(format!(
            "Failed to create Entrypoint↔Osmosis transfer channel for chain {}:\n{}",
            osmosis_config::TESTNET_CHAIN_ID,
            String::from_utf8_lossy(&create_channel_output.stderr)
        )
        .into());
    }

    if let Some(progress_bar) = &optional_progress_bar {
        progress_bar.finish_and_clear();
    }

    Ok(())
}

/// Ensures Hermes config contains an Osmosis testnet chain block (`osmo-test-5`).
pub(super) fn ensure_testnet_chain_in_hermes_config(
    osmosis_dir: &Path,
) -> Result<(), Box<dyn std::error::Error>> {
    let _ = osmosis_dir;
    hermes_support::ensure_cosmos_chain_in_hermes_config(
        &testnet_chain_profile(),
        "Osmosis testnet chain using external public endpoints",
    )
}

fn local_chain_profile() -> HermesCosmosChainProfile {
    HermesCosmosChainProfile {
        id: osmosis_config::LOCAL_CHAIN_ID.to_string(),
        rpc_addr: osmosis_config::LOCAL_RPC_URL.to_string(),
        grpc_addr: "http://127.0.0.1:9094".to_string(),
        event_source_url: "ws://127.0.0.1:26658/websocket".to_string(),
        rpc_timeout: "10s",
        trusted_node: None,
        account_prefix: "osmo",
        key_name: osmosis_config::LOCAL_CHAIN_ID.to_string(),
        address_type: Some(HermesAddressType::Cosmos),
        store_prefix: "ibc",
        default_gas: 5_000_000,
        max_gas: 15_000_000,
        gas_price: HermesGasPrice {
            price: "0.1",
            denom: "uosmo",
        },
        gas_multiplier: "2.0",
        max_msg_num: 20,
        max_tx_size: 209_715,
        clock_drift: "20s",
        max_block_time: "10s",
        trusting_period: "10days",
        memo_prefix: Some("Osmosis Docs Rocks"),
        trust_threshold: HermesTrustThreshold {
            numerator: "1",
            denominator: "3",
        },
        compat_mode: None,
    }
}

fn testnet_chain_profile() -> HermesCosmosChainProfile {
    HermesCosmosChainProfile {
        id: osmosis_config::TESTNET_CHAIN_ID.to_string(),
        rpc_addr: osmosis_config::TESTNET_RPC_URL.to_string(),
        grpc_addr: osmosis_config::TESTNET_GRPC_URL.to_string(),
        event_source_url: osmosis_config::TESTNET_EVENT_SOURCE_URL.to_string(),
        rpc_timeout: "10s",
        trusted_node: None,
        account_prefix: "osmo",
        key_name: format!("{}-relayer", osmosis_config::TESTNET_CHAIN_ID),
        address_type: Some(HermesAddressType::Cosmos),
        store_prefix: "ibc",
        default_gas: 5_000_000,
        max_gas: 15_000_000,
        gas_price: HermesGasPrice {
            price: "0.1",
            denom: "uosmo",
        },
        gas_multiplier: "2.0",
        max_msg_num: 20,
        max_tx_size: 209_715,
        clock_drift: "20s",
        max_block_time: "10s",
        trusting_period: "10days",
        memo_prefix: Some("Osmosis Docs Rocks"),
        trust_threshold: HermesTrustThreshold {
            numerator: "1",
            denominator: "3",
        },
        compat_mode: None,
    }
}

fn chain_has_any_keys(
    hermes_binary: &Path,
    working_dir: &Path,
    chain_id: &str,
) -> Result<bool, Box<dyn std::error::Error>> {
    let output = Command::new(hermes_binary)
        .current_dir(working_dir)
        .args(["keys", "list", "--chain", chain_id])
        .output()?;
    if !output.status.success() {
        return Ok(false);
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    let combined = format!("{}\n{}", stdout, stderr);
    let lower = combined.to_ascii_lowercase();
    if lower.contains("no keys found") {
        return Ok(false);
    }

    Ok(combined.contains("osmo1")
        || combined.contains("cosmos1")
        || combined.contains("inj1")
        || !combined.trim().is_empty())
}

fn chain_has_key_named(
    hermes_binary: &Path,
    working_dir: &Path,
    chain_id: &str,
    key_name: &str,
) -> Result<bool, Box<dyn std::error::Error>> {
    let output = Command::new(hermes_binary)
        .current_dir(working_dir)
        .args(["keys", "list", "--chain", chain_id])
        .output()?;
    if !output.status.success() {
        return Ok(false);
    }

    for line in String::from_utf8_lossy(&output.stdout).lines() {
        let trimmed = line.trim();
        if !trimmed.starts_with("- ") {
            continue;
        }

        let candidate = trimmed
            .trim_start_matches('-')
            .trim()
            .split('(')
            .next()
            .unwrap_or("")
            .trim();
        if candidate == key_name {
            return Ok(true);
        }
    }

    Ok(false)
}

fn ensure_entrypoint_demo_key(
    osmosis_dir: &Path,
    hermes_binary: &Path,
) -> Result<(), Box<dyn std::error::Error>> {
    if chain_has_any_keys(hermes_binary, osmosis_dir, entrypoint_chain_id().as_str())? {
        return Ok(());
    }

    let hermes_binary_str = hermes_binary.to_str().ok_or_else(|| {
        format!(
            "Hermes binary path is not valid UTF-8: {}",
            hermes_binary.display()
        )
    })?;

    execute_script(
        osmosis_dir,
        hermes_binary_str,
        Vec::from([
            "keys",
            "add",
            "--overwrite",
            "--chain",
            entrypoint_chain_id().as_str(),
            "--mnemonic-file",
            osmosis_dir.join("scripts/hermes/cosmos").to_str().unwrap(),
        ]),
        None,
    )?;

    Ok(())
}

fn create_client_with_retry(
    hermes_binary: &Path,
    working_dir: &Path,
    host_chain: &str,
    reference_chain: &str,
    trusting_period: Option<&str>,
) -> Result<String, Box<dyn std::error::Error>> {
    let mut last_error = String::new();

    for attempt in 1..=10 {
        let mut args = vec![
            "create",
            "client",
            "--host-chain",
            host_chain,
            "--reference-chain",
            reference_chain,
        ];
        if let Some(trusting_period) = trusting_period {
            args.push("--trusting-period");
            args.push(trusting_period);
        }

        let output: Output = Command::new(hermes_binary)
            .current_dir(working_dir)
            .args(args.as_slice())
            .output()?;

        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
        if output.status.success() {
            if let Some(client_id) = parse_tendermint_client_id(stdout.as_str()) {
                return Ok(client_id);
            }
        }

        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        last_error = format!(
            "attempt {attempt}/10 failed (status={}):\nstdout:\n{}\nstderr:\n{}",
            output.status,
            if stdout.trim().is_empty() {
                "<empty>"
            } else {
                stdout.trim()
            },
            if stderr.trim().is_empty() {
                "<empty>"
            } else {
                stderr.trim()
            }
        );

        if output.status.success() {
            verbose(&format!(
                "Hermes create client succeeded without a parseable client id on {host_chain} -> {reference_chain}; retrying..."
            ));
        }

        thread::sleep(Duration::from_secs(5));
    }

    Err(format!(
        "Failed to create Hermes client for host={} reference={}: {}",
        host_chain, reference_chain, last_error
    )
    .into())
}

fn has_open_transfer_channel(
    hermes_binary: &Path,
    working_dir: &Path,
    chain_id: &str,
    counterparty_chain_id: &str,
) -> Result<bool, Box<dyn std::error::Error>> {
    let output = Command::new(hermes_binary)
        .current_dir(working_dir)
        .args([
            "--json",
            "query",
            "channels",
            "--chain",
            chain_id,
            "--counterparty-chain",
            counterparty_chain_id,
        ])
        .output()?;

    if !output.status.success() {
        verbose(&format!(
            "Hermes channel query failed for {}↔{}: {}",
            chain_id,
            counterparty_chain_id,
            String::from_utf8_lossy(&output.stderr)
        ));
        return Ok(false);
    }

    for line in String::from_utf8_lossy(&output.stdout).lines() {
        let Ok(entry) = serde_json::from_str::<Value>(line) else {
            continue;
        };

        let Some(result) = entry.get("result") else {
            continue;
        };

        if result
            .as_array()
            .is_some_and(|array| array.iter().any(is_open_transfer_channel_entry))
        {
            return Ok(true);
        }

        if is_open_transfer_channel_entry(result) {
            return Ok(true);
        }
    }

    Ok(false)
}

fn is_open_transfer_channel_entry(value: &Value) -> bool {
    let state = value
        .get("state")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_ascii_lowercase();
    if state != "open" {
        return false;
    }

    let channel_id = value
        .get("channel_id")
        .and_then(Value::as_str)
        .or_else(|| value.get("channel_a").and_then(Value::as_str))
        .unwrap_or_default();
    if !channel_id.starts_with("channel-") {
        return false;
    }

    let local_port_id = value
        .get("port_id")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let remote_port_id = value
        .get("counterparty")
        .and_then(|counterparty| counterparty.get("port_id"))
        .and_then(Value::as_str)
        .unwrap_or_default();

    local_port_id == "transfer" || remote_port_id == "transfer"
}

fn resolve_local_hermes_binary(osmosis_dir: &Path) -> Result<std::path::PathBuf, Box<dyn std::error::Error>> {
    let configured_project_root = std::path::PathBuf::from(config::get_config().project_root);
    hermes_support::resolve_local_hermes_binary(configured_project_root.as_path(), osmosis_dir)
        .ok_or_else(|| {
            format!(
                "Hermes binary not found at {}. Run 'caribic start relayer' first so the demo uses the local Cardano-enabled Hermes binary.",
                configured_project_root.join("relayer/target/release/hermes").display()
            )
            .into()
        })
}
