use crate::check::check_osmosisd;
use crate::logger::{log_or_show_progress, verbose};
use crate::setup::{
    configure_local_cardano_devnet, copy_cardano_env_file, download_mithril,
    prepare_db_sync_and_gateway, seed_cardano_devnet,
};
use crate::utils::{
    copy_dir_all, diagnose_container_failure, download_file, execute_script,
    execute_script_with_progress, extract_tendermint_client_id, extract_tendermint_connection_id,
    get_cardano_state, get_user_ids, unzip_file, wait_for_health_check, wait_until_file_exists,
    CardanoQuery, IndicatorMessage,
};
use crate::{
    config,
    logger::{self, error, log},
};
use console::style;
use dirs::home_dir;
use fs_extra::copy_items;
use fs_extra::file::copy;
use indicatif::{ProgressBar, ProgressStyle};
use serde_json::Value;
use std::cmp::min;
use std::fs::{self};
use std::path::Path;
use std::process::Command;
use std::thread;
use std::time::Duration;
use std::u64;

/// Get environment variables for Docker Compose, including UID/GID
/// - macOS: Uses 0:0 (root) for compatibility
/// - Linux: Uses actual user UID/GID
fn get_docker_env_vars() -> Vec<(&'static str, String)> {
    let (uid, gid) = get_user_ids();
    vec![("UID", uid), ("GID", gid)]
}

pub fn start_relayer(
    relayer_path: &Path,
    _relayer_env_template_path: &Path,
    _relayer_config_source_path: &Path,
    _chain_handler_path: &Path,
) -> Result<(), Box<dyn std::error::Error>> {
    let optional_progress_bar = match logger::get_verbosity() {
        logger::Verbosity::Verbose => None,
        _ => Some(ProgressBar::new_spinner()),
    };

    if let Some(progress_bar) = &optional_progress_bar {
        progress_bar.enable_steady_tick(Duration::from_millis(100));
        progress_bar.set_style(
            ProgressStyle::with_template("{prefix:.bold} {spinner} [{elapsed_precise}] {wide_msg}")
                .unwrap()
                .tick_chars("⠁⠂⠄⡀⢀⠠⠐⠈ "),
        );
        progress_bar.set_prefix("Configuring Hermes relayer ...".to_owned());
    } else {
        log("Configuring Hermes relayer ...");
    }

    // Build Hermes with Cardano support if needed
    let hermes_binary = relayer_path.join("target/release/hermes");

    if !hermes_binary.exists() {
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
    let caribic_dir = relayer_path.parent().unwrap().join("caribic");
    copy(
        caribic_dir.join("config/hermes-config.example.toml"),
        hermes_dir.join("config.toml"),
        &options,
    )
    .map_err(|e| format!("Failed to copy Hermes config: {}", e))?;

    log_or_show_progress(
        &format!(
            "Configuration copied to {}",
            hermes_dir.join("config.toml").display()
        ),
        &optional_progress_bar,
    );

    // Auto-configure Hermes keys for both chains
    log_or_show_progress(
        "Setting up Hermes keys for cardano-devnet and sidechain",
        &optional_progress_bar,
    );

    // Sidechain: Use the pre-funded "relayer" account from cosmos/sidechain/config.yml
    let sidechain_mnemonic = "engage vote never tired enter brain chat loan coil venture soldier shine awkward keen delay link mass print venue federal ankle valid upgrade balance";
    let sidechain_mnemonic_file = std::env::temp_dir().join("sidechain-mnemonic.txt");
    fs::write(&sidechain_mnemonic_file, sidechain_mnemonic)
        .map_err(|e| format!("Failed to write sidechain mnemonic: {}", e))?;

    let sidechain_key_output = Command::new(&hermes_binary)
        .args(&[
            "keys",
            "add",
            "--chain",
            "sidechain",
            "--mnemonic-file",
            sidechain_mnemonic_file.to_str().unwrap(),
            "--overwrite",
        ])
        .output();

    let _ = fs::remove_file(&sidechain_mnemonic_file);

    match sidechain_key_output {
        Ok(output) if output.status.success() => {
            log_or_show_progress("Added key for sidechain", &optional_progress_bar);
        }
        Ok(output) => {
            verbose(&format!(
                "Warning: Failed to add sidechain key: {}",
                String::from_utf8_lossy(&output.stderr)
            ));
        }
        Err(e) => {
            verbose(&format!("Warning: Failed to add sidechain key: {}", e));
        }
    }

    // Cardano: Use DEPLOYER_SK from environment (or default test key)
    // Our modified Hermes CardanoKeyring accepts bech32 private keys (ed25519_sk...)
    let cardano_key = std::env::var("DEPLOYER_SK").unwrap_or_else(|_| {
        "ed25519_sk1wzj3500dft0g38h9ldqmkl9urn5erf2jy5rh5dfpxhxjyqsn0awsjalfmy".to_string()
    });
    let cardano_key_file = std::env::temp_dir().join("cardano-key.txt");
    fs::write(&cardano_key_file, &cardano_key)
        .map_err(|e| format!("Failed to write cardano key: {}", e))?;

    let cardano_key_output = Command::new(&hermes_binary)
        .args(&[
            "keys",
            "add",
            "--chain",
            "cardano-devnet",
            "--mnemonic-file",
            cardano_key_file.to_str().unwrap(),
            "--overwrite",
        ])
        .output();

    let _ = fs::remove_file(&cardano_key_file);

    match cardano_key_output {
        Ok(output) if output.status.success() => {
            log_or_show_progress("Added key for cardano-devnet", &optional_progress_bar);
        }
        Ok(output) => {
            verbose(&format!(
                "Warning: Failed to add cardano-devnet key: {}",
                String::from_utf8_lossy(&output.stderr)
            ));
        }
        Err(e) => {
            verbose(&format!("Warning: Failed to add cardano-devnet key: {}", e));
        }
    }

    // Hermes runs as a local process (see `start_hermes_daemon`), not as a docker-compose service.
    // Any previous docker-compose calls here were legacy and would fail in a clean setup.

    if let Some(progress_bar) = &optional_progress_bar {
        progress_bar.finish_and_clear();
    }

    Ok(())
}

pub fn build_hermes_if_needed(relayer_path: &Path) -> Result<(), Box<dyn std::error::Error>> {
    let hermes_binary = relayer_path.join("target/release/hermes");
    if hermes_binary.exists() {
        return Ok(());
    }

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

pub async fn start_local_cardano_network(
    project_root_path: &Path,
    clean: bool,
) -> Result<(), Box<dyn std::error::Error>> {
    let optional_progress_bar = match logger::get_verbosity() {
        logger::Verbosity::Verbose => None,
        _ => Some(ProgressBar::new_spinner()),
    };

    if let Some(progress_bar) = &optional_progress_bar {
        progress_bar.enable_steady_tick(Duration::from_millis(100));
        progress_bar.set_style(
            ProgressStyle::with_template("{prefix:.bold} {spinner} [{elapsed_precise}] {wide_msg}")
                .unwrap()
                .tick_chars("⠁⠂⠄⡀⢀⠠⠐⠈ "),
        );
        progress_bar.set_prefix("Creating local Cardano network ...".to_owned());
    } else {
        log("Creating local Cardano network ...");
    }

    let cardano_dir = project_root_path.join("chains/cardano");
    log_or_show_progress(
        &format!(
            "{} Configuring local Cardano devnet",
            style("Step 1/3").bold().dim(),
        ),
        &optional_progress_bar,
    );
    configure_local_cardano_devnet(cardano_dir.as_path())?;
    log_or_show_progress(
        &format!(
            "{} Starting Cardano services",
            style("Step 2/3").bold().dim(),
        ),
        &optional_progress_bar,
    );
    start_local_cardano_services(cardano_dir.as_path())?;

    log_or_show_progress(
        "Waiting for the Cardano services to start ...",
        &optional_progress_bar,
    );

    // TODO: make the url configurable
    let ogmios_url = "http://localhost:1337";
    let ogmios_connected =
        wait_for_health_check(ogmios_url, 20, 5000, None::<fn(&String) -> bool>).await;

    if ogmios_connected.is_ok() {
        verbose("Cardano services started successfully");
    } else {
        let container_names = [
            "cardano-node",
            "cardano-cardano-node-ogmios-1",
            "cardano-postgres-1",
        ];
        let (diagnostics, _should_fail_fast) = diagnose_container_failure(&container_names);
        return Err(format!(
            "Failed to start Cardano services - Ogmios health check failed after 100 seconds{}",
            diagnostics
        )
        .into());
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
                log("Waiting for node to start up ...");
                std::thread::sleep(Duration::from_secs(5))
            }
        }
    }

    // wait until network hard forked into Conway era after 1 epoch
    let mut current_epoch = get_cardano_state(project_root_path, CardanoQuery::Epoch)?;
    let target_epoch: u64 = 1;
    let target_slot: u64 =
        target_epoch * get_cardano_state(project_root_path, CardanoQuery::SlotInEpoch)?;

    if current_epoch < target_epoch {
        if let Some(progress_bar) = &optional_progress_bar {
            progress_bar.enable_steady_tick(Duration::from_millis(100));
            progress_bar.set_style(
            ProgressStyle::with_template("{prefix:.bold} {spinner} [{elapsed_precise}] [{bar:40.cyan/blue}] {pos}/{len} {wide_msg}")
                .unwrap()
                .tick_chars("⠁⠂⠄⡀⢀⠠⠐⠈ ")
                .progress_chars("#>-")
        );
            progress_bar.set_prefix(
            "Seeding the network needs to wait until network forked into Conway which it does with Epoch 1 .."
                .to_owned(),
        );
            progress_bar.set_length(target_slot);
            progress_bar.set_position(get_cardano_state(project_root_path, CardanoQuery::Slot)?);
        } else {
            log(
            "Seeding the network needs to wait until network forked into Conway which it does with Epoch 1 ..",
        );
        }
    }

    while current_epoch < target_epoch {
        current_epoch = get_cardano_state(project_root_path, CardanoQuery::Epoch)?;

        if let Some(progress_bar) = &optional_progress_bar {
            progress_bar.set_position(min(
                get_cardano_state(project_root_path, CardanoQuery::Slot)?,
                target_slot,
            ));
        } else {
            verbose(&format!(
                "Current slot: {}, Slots left: {}",
                get_cardano_state(project_root_path, CardanoQuery::Slot)?,
                get_cardano_state(project_root_path, CardanoQuery::SlotsToEpochEnd)?
            ));
        }
        std::thread::sleep(Duration::from_secs(10));
    }

    seed_cardano_devnet(cardano_dir.as_path(), &optional_progress_bar);
    log_or_show_progress(
        "Deploying the client, channel and connection contracts",
        &optional_progress_bar,
    );

    if config::get_config().cardano.services.db_sync {
        prepare_db_sync_and_gateway(cardano_dir.as_path(), clean)?;
        let docker_env = get_docker_env_vars();
        let docker_env_refs: Vec<(&str, &str)> =
            docker_env.iter().map(|(k, v)| (*k, v.as_str())).collect();
        execute_script(
            &cardano_dir,
            "docker",
            vec!["compose", "up", "-d", "cardano-db-sync"],
            Some(docker_env_refs),
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

    Ok(())
}

pub async fn deploy_contracts(
    project_root_path: &Path,
    clean: bool,
) -> Result<(), Box<dyn std::error::Error>> {
    let optional_progress_bar = match logger::get_verbosity() {
        logger::Verbosity::Verbose => None,
        _ => Some(ProgressBar::new_spinner()),
    };

    if let Some(progress_bar) = &optional_progress_bar {
        progress_bar.enable_steady_tick(Duration::from_millis(100));
        progress_bar.set_style(
            ProgressStyle::with_template("{prefix:.bold} {spinner} [{elapsed_precise}] {wide_msg}")
                .unwrap()
                .tick_chars("⠁⠂⠄⡀⢀⠠⠐⠈ "),
        );
        progress_bar.set_prefix("Deploying IBC contracts ...".to_owned());
    } else {
        log("Deploying IBC contracts ...");
    }

    let is_verbose = logger::get_verbosity() == logger::Verbosity::Verbose;
    let mut validators_rebuild = false;

    if !project_root_path
        .join("cardano")
        .join("plutus.json")
        .as_path()
        .exists()
        || clean
        || is_verbose
    {
        log_or_show_progress(
            &format!(
                "{} Building Aiken validators",
                style("Step 1/2").bold().dim()
            ),
            &optional_progress_bar,
        );

        let build_args = if is_verbose {
            vec!["build", "--trace-filter", "all", "--trace-level", "verbose"]
        } else {
            vec!["build"]
        };

        execute_script(
            project_root_path.join("cardano").join("onchain").as_path(),
            "aiken",
            build_args,
            None,
        )?;
        validators_rebuild = true;
    } else {
        log_or_show_progress(
            &format!(
                "{} Aiken validators already built",
                style("Step 1/2").bold().dim()
            ),
            &optional_progress_bar,
        );
    }

    if validators_rebuild {
        let _ = execute_script(
            project_root_path.join("cardano").join("offchain").as_path(),
            "deno",
            Vec::from(["task", "clean"]),
            None,
        );
    }

    // Remove the old handler file
    if !project_root_path
        .join("cardano/offchain/deployments/handler.json")
        .exists()
    {
        let handler_json_exists = wait_until_file_exists(
            project_root_path
                .join("cardano/offchain/deployments/handler.json")
                .as_path(),
            20,
            5000,
            || {
                let _ = execute_script(
                    project_root_path.join("cardano").join("offchain").as_path(),
                    "deno",
                    Vec::from(["task", "start"]),
                    None,
                );
            },
        );

        if let Some(progress_bar) = &optional_progress_bar {
            progress_bar.finish_and_clear();
        }

        if handler_json_exists.is_ok() {
            Ok(())
        } else {
            Err("ERROR: Failed to start Cardano services. The handler.json file should have been created, but it doesn't exist. Consider running the start command again using --verbose 5.".into())
        }
    } else {
        log_or_show_progress(
            "PASS: The handler.json file already exists. Skipping the deployment.",
            &optional_progress_bar,
        );
        if let Some(progress_bar) = &optional_progress_bar {
            progress_bar.finish_and_clear();
        }
        Ok(())
    }
}

pub async fn start_cosmos_sidechain_from_repository(
    download_url: &str,
    chain_root_path: &Path,
) -> Result<(), Box<dyn std::error::Error>> {
    if chain_root_path.exists() {
        log(&format!(
            "{} Demo chain already downloaded. Cleaning up to get the most recent version...",
            style("Step 0/2").bold().dim()
        ));
        fs::remove_dir_all(&chain_root_path).expect("Failed to cleanup demo chain folder.");
    }
    fs::create_dir_all(&chain_root_path).expect("Failed to create folder for demo chain.");
    download_file(
        download_url,
        &chain_root_path
            .join("cardano-ibc-summit-demo.zip")
            .as_path(),
        Some(IndicatorMessage {
            message: "Downloading cardano-ibc-summit-demo project".to_string(),
            step: "Step 1/2".to_string(),
            emoji: "".to_string(),
        }),
    )
    .await
    .expect("Failed to download cardano-ibc-summit-demo project");

    log(&format!(
        "{} Extracting cardano-ibc-summit-demo project...",
        style("Step 2/2").bold().dim()
    ));

    unzip_file(
        chain_root_path
            .join("cardano-ibc-summit-demo.zip")
            .as_path(),
        chain_root_path,
    )
    .expect("Failed to unzip cardano-ibc-summit-demo project");
    fs::remove_file(chain_root_path.join("cardano-ibc-summit-demo.zip"))
        .expect("Failed to cleanup cardano-ibc-summit-demo.zip");

    return start_cosmos_sidechain(chain_root_path, true).await;
}

pub fn start_cosmos_sidechain_services(
    cosmos_dir: &Path,
    clean: bool,
) -> Result<(), Box<dyn std::error::Error>> {
    execute_script(cosmos_dir, "docker", Vec::from(["compose", "stop"]), None)?;

    let mut args = vec!["compose", "up", "-d"];
    if clean {
        args.push("--build");
    }

    execute_script(cosmos_dir, "docker", args, None)?;
    Ok(())
}

pub async fn wait_for_cosmos_sidechain_ready() -> Result<(), Box<dyn std::error::Error>> {
    let optional_progress_bar = match logger::get_verbosity() {
        logger::Verbosity::Verbose => None,
        _ => Some(ProgressBar::new_spinner()),
    };

    if let Some(progress_bar) = &optional_progress_bar {
        progress_bar.enable_steady_tick(Duration::from_millis(100));
        progress_bar.set_style(
            ProgressStyle::with_template("{prefix:.bold} {spinner} {wide_msg}")
                .unwrap()
                .tick_chars("⠁⠂⠄⡀⢀⠠⠐⠈ "),
        );
        progress_bar.set_prefix(
            "Waiting for the Cosmos sidechain to start (this may take a while) ...".to_owned(),
        );
    } else {
        log("Waiting for the Cosmos sidechain to start ...");
    }

    // Wait for health check with fail-fast error detection
    // Check container health periodically (every 5 retries ~50 seconds) to detect unrecoverable errors early.
    // Similar to Cardano network startup, we should fail fast for issues that require developer intervention:
    // - Command not found errors (missing dependencies like 'ignite')
    // - Permission errors (requires fixing volume/socket permissions)
    // - Port conflicts (requires stopping conflicting services)
    // - Disk space errors (requires freeing up disk space)
    let url = "http://127.0.0.1:4500/";
    let max_retries = 60;
    let interval_ms = 10000; // 10 seconds
    let client = reqwest::Client::builder().no_proxy().build()?;

    for retry in 0..max_retries {
        let response = client.get(url).send().await;

        match response {
            Ok(resp) if resp.status().is_success() => {
                if let Some(progress_bar) = &optional_progress_bar {
                    progress_bar.finish_and_clear();
                }
                return Ok(());
            }
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

        // Check container health every 5 retries (~50 seconds) to fail fast on unrecoverable errors
        if retry > 0 && retry % 5 == 0 {
            let container_names = ["sidechain-node-prod"];
            let (diagnostics, should_fail_fast) = diagnose_container_failure(&container_names);
            if should_fail_fast {
                if let Some(progress_bar) = &optional_progress_bar {
                    progress_bar.finish_and_clear();
                }
                return Err(format!(
                    "Cosmos sidechain has unrecoverable errors that require developer intervention:{}",
                    diagnostics
                )
                .into());
            }
        }

        tokio::time::sleep(tokio::time::Duration::from_millis(interval_ms)).await;
    }

    // Final diagnostic check after timeout
    let container_names = ["sidechain-node-prod"];
    let (diagnostics, _should_fail_fast) = diagnose_container_failure(&container_names);

    if let Some(progress_bar) = &optional_progress_bar {
        progress_bar.finish_and_clear();
    }

    Err(format!(
        "Health check on {} failed after {} attempts. The Cosmos sidechain may have crashed or is not responding.{}",
        url,
        max_retries,
        diagnostics
    )
    .into())
}

pub async fn start_cosmos_sidechain(
    cosmos_dir: &Path,
    clean: bool,
) -> Result<(), Box<dyn std::error::Error>> {
    start_cosmos_sidechain_services(cosmos_dir, clean)?;
    wait_for_cosmos_sidechain_ready().await
}

pub fn start_local_cardano_services(cardano_dir: &Path) -> Result<(), Box<dyn std::error::Error>> {
    let configuration = config::get_config().cardano;

    let mut services = vec![];
    if configuration.services.cardano_node {
        services.push("cardano-node");
    }
    if configuration.services.postgres {
        services.push("postgres");
    }
    if configuration.services.kupo {
        services.push("kupo");
    }
    if configuration.services.ogmios {
        services.push("cardano-node-ogmios");
    }

    let mut script_stop_args = vec!["compose", "stop"];
    script_stop_args.append(&mut services.clone());
    execute_script(cardano_dir, "docker", script_stop_args, None)?;

    let docker_env = get_docker_env_vars();
    let docker_env_refs: Vec<(&str, &str)> =
        docker_env.iter().map(|(k, v)| (*k, v.as_str())).collect();

    let mut script_start_args = vec!["compose", "up", "-d"];
    script_start_args.append(&mut services);
    execute_script(
        cardano_dir,
        "docker",
        script_start_args,
        Some(docker_env_refs),
    )?;
    Ok(())
}

pub async fn start_osmosis(osmosis_dir: &Path) -> Result<(), Box<dyn std::error::Error>> {
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

        // TODD: make the url and port configurable
        let is_healthy = wait_for_health_check(
            "http://127.0.0.1:26658/status?",
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
            Err("Run into timeout while checking http://127.0.0.1:26658/status?".into())
        }
    } else {
        if let Some(progress_bar) = &optional_progress_bar {
            progress_bar.finish_and_clear();
        }

        Err(status.unwrap_err().into())
    }
}

pub async fn prepare_osmosis(osmosis_dir: &Path) -> Result<(), Box<dyn std::error::Error>> {
    check_osmosisd(osmosis_dir).await;

    match copy_osmosis_config_files(osmosis_dir) {
        Ok(_) => {
            verbose("PASS: Osmosis configuration files copied successfully");
            init_local_network(osmosis_dir)?;
            Ok(())
        }
        Err(e) => {
            error(&format!(
                "ERROR: Failed to copy Osmosis configuration files: {}",
                e
            ));
            Err(e.into())
        }
    }
}

pub fn configure_hermes(osmosis_dir: &Path) -> Result<(), Box<dyn std::error::Error>> {
    let optional_progress_bar = match logger::get_verbosity() {
        logger::Verbosity::Verbose => None,
        _ => Some(ProgressBar::new_spinner()),
    };

    if let Some(progress_bar) = &optional_progress_bar {
        progress_bar.set_style(ProgressStyle::with_template("{prefix:.bold} {wide_msg}").unwrap());
        progress_bar.set_prefix("Asking Hermes to connect Osmosis and Cosmos ...".to_owned());
    } else {
        log("Asking Hermes to connect Osmosis and Cosmos ...");
    }

    log_or_show_progress(
        &format!(
            "{} Prepare hermes configuration files and keys",
            style("Step 1/4").bold().dim()
        ),
        &optional_progress_bar,
    );

    let script_dir = osmosis_dir.join("scripts");
    if let Some(home_path) = home_dir() {
        let hermes_dir = home_path.join(".hermes");
        if !hermes_dir.exists() {
            fs::create_dir_all(&hermes_dir)?;
        }
        let options = fs_extra::file::CopyOptions::new().overwrite(true);
        verbose(&format!(
            "Copying Hermes configuration files from {} to {}",
            script_dir.join("hermes/config.toml").display(),
            hermes_dir.join("config.toml").display()
        ));
        copy(
            script_dir.join("hermes/config.toml"),
            hermes_dir.join("config.toml"),
            &options,
        )
        .expect("Failed to copy Hermes configuration file");
    }

    execute_script(
        script_dir.as_path(),
        "hermes",
        Vec::from([
            "keys",
            "add",
            "--overwrite",
            "--chain",
            "sidechain",
            "--mnemonic-file",
            osmosis_dir.join("scripts/hermes/cosmos").to_str().unwrap(),
        ]),
        None,
    )?;

    execute_script(
        script_dir.as_path(),
        "hermes",
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
        // Try to create osmosis client
        let hermes_create_client_output = Command::new("hermes")
            .current_dir(&script_dir)
            .args(&[
                "create",
                "client",
                "--host-chain",
                "localosmosis",
                "--reference-chain",
                "sidechain",
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

        // Create sidechain client
        let create_sidechain_client_output = Command::new("hermes")
            .current_dir(&script_dir)
            .args(&[
                "create",
                "client",
                "--host-chain",
                "sidechain",
                "--reference-chain",
                "localosmosis",
                "--trusting-period",
                "86000s",
            ])
            .output()
            .expect("Failed to query clients");

        let sidechain_client_id = extract_tendermint_client_id(create_sidechain_client_output);

        if let Some(sidechain_client_id) = sidechain_client_id {
            verbose(&format!("sidechain_client_id: {}", sidechain_client_id));

            log_or_show_progress(
                &format!(
                    "{} Create a connection between both clients",
                    style("Step 3/4").bold().dim()
                ),
                &optional_progress_bar,
            );
            // Create connection
            let create_connection_output = Command::new("hermes")
                .current_dir(&script_dir)
                .args(&[
                    "create",
                    "connection",
                    "--a-chain",
                    "sidechain",
                    "--a-client",
                    sidechain_client_id.as_str(),
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

                // Create channel
                log_or_show_progress(
                    &format!("{} Create a channel", style("Step 4/4").bold().dim()),
                    &optional_progress_bar,
                );
                let create_channel_output = Command::new("hermes")
                    .current_dir(&script_dir)
                    .args(&[
                        "create",
                        "channel",
                        "--a-chain",
                        "sidechain",
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
            return Err("Failed to get sidechain client_id".into());
        }
    } else {
        return Err("Failed to get localosmosis client_id".into());
    }

    if let Some(progress_bar) = &optional_progress_bar {
        progress_bar.finish_and_clear();
    }

    Ok(())
}

fn init_local_network(osmosis_dir: &Path) -> Result<(), Box<dyn std::error::Error>> {
    if logger::is_quite() {
        execute_script(osmosis_dir, "make", Vec::from(["localnet-init"]), None)?;
        Ok(())
    } else {
        execute_script_with_progress(
            osmosis_dir,
            "make",
            Vec::from(["localnet-init"]),
            "Initialize local Osmosis network",
        )?;
        Ok(())
    }
}

fn copy_osmosis_config_files(osmosis_dir: &Path) -> Result<(), fs_extra::error::Error> {
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

pub async fn start_mithril(project_root_dir: &Path) -> Result<u64, Box<dyn std::error::Error>> {
    let mithril_dir = project_root_dir.join("chains/mithrils");
    let mithril_data_dir = mithril_dir.join("data");
    let mithril_script_dir = mithril_dir.join("scripts");
    let mithril_project_dir = mithril_dir.join("mithril");

    if mithril_data_dir.exists() && mithril_data_dir.is_dir() {
        fs::remove_dir_all(&mithril_data_dir).map_err(|error| {
            format!(
                "Failed to remove existing mithril data directory: {}",
                error.to_string()
            )
        })?;
    }
    fs::create_dir_all(&mithril_data_dir).map_err(|error| {
        format!(
            "Failed to create mithril data directory: {}",
            error.to_string()
        )
    })?;

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

    let optional_progress_bar = match logger::get_verbosity() {
        logger::Verbosity::Verbose => None,
        _ => Some(ProgressBar::new_spinner()),
    };

    if let Some(progress_bar) = &optional_progress_bar {
        progress_bar.enable_steady_tick(Duration::from_millis(100));
        progress_bar.set_style(
            ProgressStyle::with_template("{prefix:.bold} {spinner} {wide_msg}")
                .unwrap()
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
        &optional_progress_bar,
    );
    let docker_env = get_docker_env_vars();
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
        ("MITHRIL_DATA_DIR", mithril_data_dir.to_str().unwrap()),
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
        &optional_progress_bar,
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

    if let Some(progress_bar) = &optional_progress_bar {
        progress_bar.finish_and_clear();
    }

    let current_cardano_epoch = get_cardano_state(project_root_dir, CardanoQuery::Epoch)?;

    Ok(current_cardano_epoch)
}

pub fn wait_and_start_mithril_genesis(
    project_root_dir: &Path,
    cardano_epoch_on_mithril_start: u64,
) -> Result<(), Box<dyn std::error::Error>> {
    // Mithril has two practical prerequisites on a fresh local Cardano devnet:
    //
    // 1) Cardano immutable files must exist.
    //    The aggregator/signer timepoint logic reads immutable files; if started too early it can
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

    let mut current_slot = get_cardano_state(project_root_dir, CardanoQuery::Slot)?;

    let slots_per_epoch = get_cardano_state(project_root_dir, CardanoQuery::SlotsToEpochEnd)?
        + get_cardano_state(project_root_dir, CardanoQuery::SlotInEpoch)?;

    let target_epoch = cardano_epoch_on_mithril_start + 2;
    let target_slot = target_epoch * slots_per_epoch;
    let mut slots_left = target_slot.saturating_sub(current_slot);

    let optional_progress_bar = match logger::get_verbosity() {
        logger::Verbosity::Verbose => None,
        _ => Some(ProgressBar::new_spinner()),
    };

    if slots_left > 0 {
        if let Some(progress_bar) = &optional_progress_bar {
            progress_bar.enable_steady_tick(Duration::from_millis(100));
            progress_bar.set_style(
            ProgressStyle::with_template("{prefix:.bold} {spinner} [{elapsed_precise}] [{bar:40.cyan/blue}] {pos}/{len} {wide_msg}")
                .unwrap()
                .tick_chars("⠁⠂⠄⡀⢀⠠⠐⠈ ")
                .progress_chars("#>-")
        );
            progress_bar.set_prefix(
            "Mithril needs to wait at least two epochs for the immutable files to be created .."
                .to_owned(),
        );
            progress_bar.set_length(target_slot);
            progress_bar.set_position(current_slot);
        } else {
            log(
            "Mithril needs to wait at least two epochs for the immutable files to be created ..",
        );
        }
    }

    while slots_left > 0 {
        current_slot = get_cardano_state(project_root_dir, CardanoQuery::Slot)?;
        slots_left = target_slot.saturating_sub(current_slot);

        if let Some(progress_bar) = &optional_progress_bar {
            progress_bar.set_position(min(current_slot, target_slot));
        } else {
            verbose(&format!(
                "Current slot: {}, Slots left: {}",
                current_slot, slots_left
            ));
        }
        std::thread::sleep(Duration::from_secs(10));
    }

    let mithril_config = config::get_config().mithril;

    // Reuse the same environment variables with UID/GID
    let docker_env = get_docker_env_vars();
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
        ("MITHRIL_DATA_DIR", mithril_data_dir.to_str().unwrap()),
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

        match result {
            Ok(_) => break,
            Err(err) => {
                let err_str = err.to_string();
                let retryable = err_str.contains("Missing signers for epoch")
                    || err_str.contains("The list of signers must not be empty");

                if retryable && attempts < 10 {
                    log(&format!(
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

    current_slot = get_cardano_state(project_root_dir, CardanoQuery::Slot)?;

    let target_epoch = cardano_epoch_on_mithril_start + 3;
    let target_slot = target_epoch * slots_per_epoch;
    slots_left = target_slot.saturating_sub(current_slot);

    if slots_left > 0 {
        if let Some(progress_bar) = &optional_progress_bar {
            progress_bar.enable_steady_tick(Duration::from_millis(100));
            progress_bar.set_style(
            ProgressStyle::with_template("{prefix:.bold} {spinner} [{elapsed_precise}] [{bar:40.cyan/blue}] {pos}/{len} {wide_msg}")
                .unwrap()
                .tick_chars("⠁⠂⠄⡀⢀⠠⠐⠈ ")
                .progress_chars("#>-")
        );
            progress_bar.set_prefix(
            "Mithril now needs to wait at least one epoch for the the aggregator to start working and generating signatures for transaction sets .."
                .to_owned(),
        );
            progress_bar.set_length(target_slot);
            progress_bar.set_position(current_slot);
        } else {
            log(
            "Mithril now needs to wait at least one epoch for the the aggregator to start working and generating signatures for transaction sets ..",
        );
        }
    }

    while slots_left > 0 {
        current_slot = get_cardano_state(project_root_dir, CardanoQuery::Slot)?;
        slots_left = target_slot.saturating_sub(current_slot);

        if let Some(progress_bar) = &optional_progress_bar {
            progress_bar.set_position(min(current_slot, target_slot));
        } else {
            verbose(&format!(
                "Current slot: {}, Slots left: {}",
                current_slot, slots_left
            ));
        }
        std::thread::sleep(Duration::from_secs(10));
    }

    if let Some(progress_bar) = &optional_progress_bar {
        progress_bar.finish_and_clear();
    }

    Ok(())
}

pub fn start_gateway(gateway_dir: &Path, clean: bool) -> Result<(), Box<dyn std::error::Error>> {
    let optional_progress_bar = match logger::get_verbosity() {
        logger::Verbosity::Verbose => None,
        _ => Some(ProgressBar::new_spinner()),
    };

    if let Some(progress_bar) = &optional_progress_bar {
        progress_bar.enable_steady_tick(Duration::from_millis(100));
        progress_bar.set_style(
            ProgressStyle::with_template("{prefix:.bold} {spinner} [{elapsed_precise}] {wide_msg}")
                .unwrap()
                .tick_chars("⠁⠂⠄⡀⢀⠠⠐⠈ "),
        );
        progress_bar.set_prefix("Starting Gateway ...".to_owned());
    } else {
        log("Starting Gateway ...");
    }

    log_or_show_progress(
        "Stopping existing Gateway containers",
        &optional_progress_bar,
    );
    execute_script(&gateway_dir, "docker", Vec::from(["compose", "stop"]), None)?;

    let mut script_args = vec!["compose", "up", "-d"];
    if clean {
        script_args.push("--build");
        log_or_show_progress(
            "Building and starting Gateway containers",
            &optional_progress_bar,
        );
    } else {
        log_or_show_progress("Starting Gateway containers", &optional_progress_bar);
    }

    execute_script(&gateway_dir, "docker", script_args, None)?;

    // Wait for Gateway gRPC port to be accessible
    log_or_show_progress(
        "Waiting for Gateway gRPC server to be ready",
        &optional_progress_bar,
    );
    let max_retries = 30; // 30 seconds max
    let mut gateway_ready = false;

    for i in 0..max_retries {
        // Check if gRPC port 5001 is accessible
        let port_check = Command::new("nc")
            .args(&["-z", "localhost", "5001"])
            .output();

        if let Ok(output) = port_check {
            if output.status.success() {
                gateway_ready = true;
                break;
            }
        }

        if i < max_retries - 1 {
            thread::sleep(Duration::from_secs(1));
            log_or_show_progress(
                &format!("Waiting for Gateway gRPC... ({}/{})", i + 1, max_retries),
                &optional_progress_bar,
            );
        }
    }

    if !gateway_ready {
        if let Some(progress_bar) = &optional_progress_bar {
            progress_bar.finish_and_clear();
        }
        return Err("Gateway gRPC server (port 5001) did not become ready in time".into());
    }

    log_or_show_progress("Gateway gRPC server is ready", &optional_progress_bar);

    if let Some(progress_bar) = &optional_progress_bar {
        progress_bar.finish_and_clear();
    }

    Ok(())
}

/// Start Hermes daemon in the background
pub fn start_hermes_daemon(relayer_path: &Path) -> Result<(), Box<dyn std::error::Error>> {
    let optional_progress_bar = match logger::get_verbosity() {
        logger::Verbosity::Verbose => None,
        _ => Some(ProgressBar::new_spinner()),
    };

    if let Some(progress_bar) = &optional_progress_bar {
        progress_bar.enable_steady_tick(Duration::from_millis(100));
        progress_bar.set_style(
            ProgressStyle::with_template("{prefix:.bold} {spinner} [{elapsed_precise}] {wide_msg}")
                .unwrap()
                .tick_chars("⠁⠂⠄⡀⢀⠠⠐⠈ "),
        );
        progress_bar.set_prefix("Starting Hermes daemon ...".to_owned());
    } else {
        log("Starting Hermes daemon ...");
    }

    let hermes_binary = relayer_path.join("target/release/hermes");

    if !hermes_binary.exists() {
        return Err(
            "Hermes binary not found. Run 'caribic start bridge' first to build it.".into(),
        );
    }

    let home_path = home_dir().ok_or("Could not determine home directory")?;
    let hermes_log = home_path.join(".hermes/hermes.log");

    // Validate config before starting
    log_or_show_progress("Validating Hermes configuration", &optional_progress_bar);
    let config_check = Command::new(&hermes_binary)
        .args(&["config", "validate"])
        .output();

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

    // Start Hermes in background
    let mut child = Command::new(&hermes_binary)
        .arg("start")
        .stdout(std::fs::File::create(&hermes_log)?)
        .stderr(std::fs::File::create(hermes_log.with_extension("err"))?)
        .spawn()
        .map_err(|e| format!("Failed to start Hermes: {}", e))?;

    log(&format!("Hermes started (PID: {})", child.id()));
    log(&format!("   Logs: {}", hermes_log.display()));
    log("   Monitor: tail -f ~/.hermes/hermes.log");

    // Wait briefly to ensure process doesn't immediately crash
    log_or_show_progress("Verifying daemon startup", &optional_progress_bar);
    thread::sleep(Duration::from_millis(1000));

    // Check if process is still running
    match child.try_wait() {
        Ok(Some(status)) => {
            // Process exited immediately - read error log
            let error_log = hermes_log.with_extension("err");
            let error_content = std::fs::read_to_string(&error_log)
                .unwrap_or_else(|_| "Could not read error log".to_string());
            return Err(format!(
                "Hermes daemon exited immediately with status {}:\n{}",
                status,
                error_content
                    .lines()
                    .take(10)
                    .collect::<Vec<_>>()
                    .join("\n")
            )
            .into());
        }
        Ok(None) => {
            // Process is still running - success
            log_or_show_progress("Hermes daemon is running", &optional_progress_bar);
        }
        Err(e) => {
            return Err(format!("Failed to check Hermes status: {}", e).into());
        }
    }

    if let Some(progress_bar) = &optional_progress_bar {
        progress_bar.finish_and_clear();
    }

    Ok(())
}

/// Configure Hermes for Cardano <> Cheqd bridge
pub fn configure_hermes_cardano_cheqd(
    relayer_path: &Path,
    cardano_mnemonic: Option<&str>,
    cheqd_mnemonic: Option<&str>,
) -> Result<(), Box<dyn std::error::Error>> {
    let hermes_binary = relayer_path.join("target/release/hermes");

    log("Configuring Hermes keys...");

    // Add Cardano key
    if let Some(mnemonic) = cardano_mnemonic {
        let mnemonic_file = std::env::temp_dir().join("cardano-mnemonic.txt");
        fs::write(&mnemonic_file, mnemonic)?;

        let output = Command::new(&hermes_binary)
            .args(&[
                "keys",
                "add",
                "--chain",
                "cardano-devnet",
                "--mnemonic-file",
                mnemonic_file.to_str().unwrap(),
            ])
            .output()?;

        fs::remove_file(&mnemonic_file)?;

        if !output.status.success() {
            return Err(format!(
                "Failed to add Cardano key: {}",
                String::from_utf8_lossy(&output.stderr)
            )
            .into());
        }

        log("Cardano key added");
    }

    // Add Cheqd key
    if let Some(mnemonic) = cheqd_mnemonic {
        let mnemonic_file = std::env::temp_dir().join("cheqd-mnemonic.txt");
        fs::write(&mnemonic_file, mnemonic)?;

        let output = Command::new(&hermes_binary)
            .args(&[
                "keys",
                "add",
                "--chain",
                "cheqd-testnet-6",
                "--mnemonic-file",
                mnemonic_file.to_str().unwrap(),
            ])
            .output()?;

        fs::remove_file(&mnemonic_file)?;

        if !output.status.success() {
            return Err(format!(
                "Failed to add Cheqd key: {}",
                String::from_utf8_lossy(&output.stderr)
            )
            .into());
        }

        log("Cheqd key added");
    }

    // Create clients on both chains
    log("Creating IBC clients...");

    let create_cardano_client = Command::new(&hermes_binary)
        .args(&[
            "create",
            "client",
            "--host-chain",
            "cardano-testnet",
            "--reference-chain",
            "cheqd-testnet-6",
        ])
        .output()?;

    if !create_cardano_client.status.success() {
        return Err(format!(
            "Failed to create Cardano client: {}",
            String::from_utf8_lossy(&create_cardano_client.stderr)
        )
        .into());
    }

    let create_cheqd_client = Command::new(&hermes_binary)
        .args(&[
            "create",
            "client",
            "--host-chain",
            "cheqd-testnet-6",
            "--reference-chain",
            "cardano-testnet",
        ])
        .output()?;

    if !create_cheqd_client.status.success() {
        return Err(format!(
            "Failed to create Cheqd client: {}",
            String::from_utf8_lossy(&create_cheqd_client.stderr)
        )
        .into());
    }

    log("IBC clients created on both chains");

    // Create connection
    log("Creating IBC connection...");

    let create_connection = Command::new(&hermes_binary)
        .args(&[
            "create",
            "connection",
            "--a-chain",
            "cardano-testnet",
            "--b-chain",
            "cheqd-testnet-6",
        ])
        .output()?;

    if !create_connection.status.success() {
        return Err(format!(
            "Failed to create connection: {}",
            String::from_utf8_lossy(&create_connection.stderr)
        )
        .into());
    }

    log("IBC connection established");

    // Create channel
    log("Creating IBC channel...");

    let create_channel = Command::new(&hermes_binary)
        .args(&[
            "create",
            "channel",
            "--a-chain",
            "cardano-testnet",
            "--a-connection",
            "connection-0",
            "--a-port",
            "transfer",
            "--b-port",
            "transfer",
        ])
        .output()?;

    if !create_channel.status.success() {
        return Err(format!(
            "Failed to create channel: {}",
            String::from_utf8_lossy(&create_channel.stderr)
        )
        .into());
    }

    log("IBC channel created");
    log("Hermes configured successfully!");

    Ok(())
}

/// Add a key to Hermes keyring via caribic
pub fn hermes_keys_add(
    relayer_path: &Path,
    chain: &str,
    mnemonic_file: &Path,
    key_name: Option<&str>,
    overwrite: bool,
) -> Result<String, Box<dyn std::error::Error>> {
    let hermes_binary = relayer_path.join("target/release/hermes");

    if !hermes_binary.exists() {
        return Err(
            "Hermes binary not found. Run 'caribic start bridge' first to build it.".into(),
        );
    }

    if !mnemonic_file.exists() {
        return Err(format!("Mnemonic file not found: {}", mnemonic_file.display()).into());
    }

    log(&format!("Adding key for chain '{}'...", chain));

    let mut args = vec!["keys", "add", "--chain", chain, "--mnemonic-file"];
    args.push(mnemonic_file.to_str().unwrap());

    if let Some(name) = key_name {
        args.push("--key-name");
        args.push(name);
    }

    if overwrite {
        args.push("--overwrite");
    }

    let output = Command::new(&hermes_binary).args(&args).output()?;

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

/// List keys in Hermes keyring via caribic
pub fn hermes_keys_list(
    relayer_path: &Path,
    chain: Option<&str>,
) -> Result<String, Box<dyn std::error::Error>> {
    let hermes_binary = relayer_path.join("target/release/hermes");

    if !hermes_binary.exists() {
        return Err(
            "Hermes binary not found. Run 'caribic start bridge' first to build it.".into(),
        );
    }

    if let Some(chain_id) = chain {
        log(&format!("Listing keys for chain '{}'...", chain_id));

        let output = Command::new(&hermes_binary)
            .args(&["keys", "list", "--chain", chain_id])
            .output()?;

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
        // List keys for all configured chains
        log("Listing keys for all chains...");

        let mut result = String::new();
        let mut found_any_keys = false;

        // List for cardano-devnet
        let cardano_output = Command::new(&hermes_binary)
            .args(&["keys", "list", "--chain", "cardano-devnet"])
            .output()?;

        if cardano_output.status.success() {
            let output_str = String::from_utf8_lossy(&cardano_output.stdout);
            result.push_str("cardano-devnet:\n");
            if output_str.trim().is_empty() {
                result.push_str("  No keys found\n");
            } else {
                // Parse and reformat the output for clarity
                for line in output_str.lines() {
                    if let Some(key_info) = parse_hermes_key_line(line) {
                        result.push_str(&format!("  key_name: {}\n", key_info.0));
                        result.push_str(&format!("  address:  {}\n", key_info.1));
                    }
                }
                found_any_keys = true;
            }
            result.push('\n');
        }

        // List for sidechain (local Cosmos chain)
        let sidechain_output = Command::new(&hermes_binary)
            .args(&["keys", "list", "--chain", "sidechain"])
            .output()?;

        if sidechain_output.status.success() {
            let output_str = String::from_utf8_lossy(&sidechain_output.stdout);
            result.push_str("sidechain:\n");
            if output_str.trim().is_empty() {
                result.push_str("  No keys found\n");
            } else {
                // Parse and reformat the output for clarity
                for line in output_str.lines() {
                    if let Some(key_info) = parse_hermes_key_line(line) {
                        result.push_str(&format!("  key_name: {}\n", key_info.0));
                        result.push_str(&format!("  address:  {}\n", key_info.1));
                    }
                }
                found_any_keys = true;
            }
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
    relayer_path: &Path,
    chain: &str,
    key_name: Option<&str>,
) -> Result<String, Box<dyn std::error::Error>> {
    let hermes_binary = relayer_path.join("target/release/hermes");

    if !hermes_binary.exists() {
        return Err(
            "Hermes binary not found. Run 'caribic start bridge' first to build it.".into(),
        );
    }

    log(&format!("Deleting key for chain '{}'...", chain));

    let mut args = vec!["keys", "delete", "--chain", chain];

    if let Some(name) = key_name {
        args.push("--key-name");
        args.push(name);
    }

    args.push("--yes"); // Auto-confirm deletion

    let output = Command::new(&hermes_binary).args(&args).output()?;

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
    relayer_path: &Path,
    host_chain: &str,
    reference_chain: &str,
) -> Result<String, Box<dyn std::error::Error>> {
    let hermes_binary = relayer_path.join("target/release/hermes");

    if !hermes_binary.exists() {
        return Err(
            "Hermes binary not found. Run 'caribic start bridge' first to build it.".into(),
        );
    }

    log(&format!(
        "Creating IBC client for '{}' on '{}'...",
        reference_chain, host_chain
    ));

    let output = Command::new(&hermes_binary)
        .args(&[
            "create",
            "client",
            "--host-chain",
            host_chain,
            "--reference-chain",
            reference_chain,
        ])
        .output()?;

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
    relayer_path: &Path,
    a_chain: &str,
    b_chain: &str,
) -> Result<String, Box<dyn std::error::Error>> {
    let hermes_binary = relayer_path.join("target/release/hermes");

    if !hermes_binary.exists() {
        return Err(
            "Hermes binary not found. Run 'caribic start bridge' first to build it.".into(),
        );
    }

    log(&format!(
        "Creating IBC connection between '{}' and '{}'...",
        a_chain, b_chain
    ));

    let output = Command::new(&hermes_binary)
        .args(&[
            "create",
            "connection",
            "--a-chain",
            a_chain,
            "--b-chain",
            b_chain,
        ])
        .output()?;

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
    relayer_path: &Path,
    a_chain: &str,
    b_chain: &str,
    a_port: &str,
    b_port: &str,
) -> Result<String, Box<dyn std::error::Error>> {
    let hermes_binary = relayer_path.join("target/release/hermes");

    if !hermes_binary.exists() {
        return Err(
            "Hermes binary not found. Run 'caribic start bridge' first to build it.".into(),
        );
    }

    log(&format!(
        "Creating IBC channel between '{}:{}' and '{}:{}'...",
        a_chain, a_port, b_chain, b_port
    ));

    let output = Command::new(&hermes_binary)
        .args(&[
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
        ])
        .output()?;

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

/// Comprehensive health check for all bridge services
pub fn comprehensive_health_check(
    project_root_path: &Path,
    service_filter: Option<&str>,
) -> Result<String, Box<dyn std::error::Error>> {
    let cardano_dir = project_root_path.join("cardano");
    let gateway_dir = project_root_path.join("cardano/gateway");
    let relayer_path = project_root_path.join("relayer");
    let mithril_dir = project_root_path.join("chains/mithrils");

    let mut result = String::new();
    result.push_str("\nBridge Health Check\n");
    result.push_str("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n");

    let mut services_checked = 0;
    let mut services_healthy = 0;

    // Define services to check
    let services = vec![
        ("gateway", "Gateway (NestJS gRPC Server)"),
        ("cardano", "Cardano Node"),
        ("postgres", "PostgreSQL (db-sync)"),
        ("kupo", "Kupo (Chain Indexer)"),
        ("ogmios", "Ogmios (JSON/RPC)"),
        ("mithril", "Mithril (Aggregator + Signers)"),
        ("hermes", "Hermes Relayer Daemon"),
        ("cosmos", "Cosmos Sidechain (Packet-forwarding)"),
    ];

    for (service_name, service_label) in services {
        // Skip if filtering and not the requested service
        if let Some(filter) = service_filter {
            if filter != service_name {
                continue;
            }
        }

        services_checked += 1;

        let (is_healthy, status_msg) = match service_name {
            "gateway" => check_gateway_health(&gateway_dir),
            "cardano" => check_cardano_node_health(&cardano_dir),
            "postgres" => check_postgres_health(&cardano_dir),
            "kupo" => check_kupo_health(&cardano_dir),
            "ogmios" => check_ogmios_health(&cardano_dir),
            "mithril" => check_mithril_health(&mithril_dir),
            "hermes" => check_hermes_daemon_health(&relayer_path),
            "cosmos" => check_cosmos_health(),
            _ => (false, "Unknown service".to_string()),
        };

        if is_healthy {
            services_healthy += 1;
        }

        let status_symbol = if is_healthy { "[OK]" } else { "[FAIL]" };
        result.push_str(&format!("{} {}\n", status_symbol, service_label));
        result.push_str(&format!("    {}\n\n", status_msg));
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

/// Check Gateway health
fn check_gateway_health(_gateway_dir: &Path) -> (bool, String) {
    // Check if gateway container is running
    let ps_check = Command::new("docker")
        .args(&[
            "ps",
            "--filter",
            "name=gateway-app",
            "--format",
            "{{.Names}}",
        ])
        .output();

    if let Ok(output) = ps_check {
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if !stdout.is_empty() {
            // Try to connect to gRPC port 5001 (Hermes connects here)
            let port_check = Command::new("nc")
                .args(&["-z", "localhost", "5001"])
                .output();

            if let Ok(port_output) = port_check {
                if port_output.status.success() {
                    return (
                        true,
                        "Container running, gRPC port 5001 accessible".to_string(),
                    );
                }
            }

            return (true, "Container running (gRPC not ready yet)".to_string());
        }
    }

    (false, "Container not running".to_string())
}

/// Check Cardano node health
fn check_cardano_node_health(_cardano_dir: &Path) -> (bool, String) {
    // Check using docker ps directly with filter
    let check = Command::new("docker")
        .args(&[
            "ps",
            "--filter",
            "name=cardano-node",
            "--filter",
            "status=running",
            "--format",
            "{{.Names}}",
        ])
        .output();

    if let Ok(output) = check {
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if !stdout.is_empty() && stdout.contains("cardano-node") {
            return (true, "Container running".to_string());
        }
    }

    (false, "Container not running".to_string())
}

/// Check Postgres health
fn check_postgres_health(_cardano_dir: &Path) -> (bool, String) {
    // Check if postgres container is running
    let ps_check = Command::new("docker")
        .args(&[
            "ps",
            "--filter",
            "name=cardano-postgres",
            "--filter",
            "status=running",
            "--format",
            "{{.Names}}",
        ])
        .output();

    if let Ok(output) = ps_check {
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if !stdout.is_empty() {
            // Try pg_isready check
            let check = Command::new("docker")
                .args(&["exec", &stdout, "pg_isready", "-U", "postgres"])
                .output();

            if let Ok(ready_output) = check {
                if ready_output.status.success() {
                    return (
                        true,
                        "Database accepting connections on port 6432".to_string(),
                    );
                }
            }

            return (true, "Container running".to_string());
        }
    }

    (false, "Container not running".to_string())
}

/// Check Kupo health
fn check_kupo_health(_cardano_dir: &Path) -> (bool, String) {
    let check = Command::new("docker")
        .args(&[
            "ps",
            "--filter",
            "name=cardano-kupo",
            "--filter",
            "status=running",
            "--format",
            "{{.Names}}",
        ])
        .output();

    if let Ok(output) = check {
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if !stdout.is_empty() {
            // Try to check port 1442
            let port_check = Command::new("nc")
                .args(&["-z", "localhost", "1442"])
                .output();

            if let Ok(port_output) = port_check {
                if port_output.status.success() {
                    return (true, "Running on port 1442".to_string());
                }
            }

            return (true, "Container running".to_string());
        }
    }

    (false, "Container not running".to_string())
}

/// Check Ogmios health
fn check_ogmios_health(_cardano_dir: &Path) -> (bool, String) {
    let check = Command::new("docker")
        .args(&[
            "ps",
            "--filter",
            "name=ogmios",
            "--filter",
            "status=running",
            "--format",
            "{{.Names}}",
        ])
        .output();

    if let Ok(output) = check {
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if !stdout.is_empty() {
            // Try to check port 1337
            let port_check = Command::new("nc")
                .args(&["-z", "localhost", "1337"])
                .output();

            if let Ok(port_output) = port_check {
                if port_output.status.success() {
                    return (true, "Running on port 1337".to_string());
                }
            }

            return (true, "Container running".to_string());
        }
    }

    (false, "Container not running".to_string())
}

/// Check Mithril health (aggregator + signers)
fn check_mithril_health(mithril_dir: &Path) -> (bool, String) {
    let mithril_compose = mithril_dir.join("scripts/docker-compose.yaml");
    if !mithril_compose.exists() {
        return (
            false,
            "Not configured (missing chains/mithrils/scripts/docker-compose.yaml)".to_string(),
        );
    }

    let aggregator_running = Command::new("docker")
        .args(&[
            "ps",
            "--filter",
            "name=mithril-aggregator",
            "--filter",
            "status=running",
            "--format",
            "{{.Names}}",
        ])
        .output()
        .ok()
        .map(|output| !String::from_utf8_lossy(&output.stdout).trim().is_empty())
        .unwrap_or(false);

    let signer_1_running = Command::new("docker")
        .args(&[
            "ps",
            "--filter",
            "name=mithril-signer-1",
            "--filter",
            "status=running",
            "--format",
            "{{.Names}}",
        ])
        .output()
        .ok()
        .map(|output| !String::from_utf8_lossy(&output.stdout).trim().is_empty())
        .unwrap_or(false);

    let signer_2_running = Command::new("docker")
        .args(&[
            "ps",
            "--filter",
            "name=mithril-signer-2",
            "--filter",
            "status=running",
            "--format",
            "{{.Names}}",
        ])
        .output()
        .ok()
        .map(|output| !String::from_utf8_lossy(&output.stdout).trim().is_empty())
        .unwrap_or(false);

    let aggregator_port_accessible = Command::new("nc")
        .args(&["-z", "localhost", "8080"])
        .output()
        .ok()
        .map(|output| output.status.success())
        .unwrap_or(false);

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

/// Check Hermes daemon health
fn check_hermes_daemon_health(_relayer_path: &Path) -> (bool, String) {
    // Check if Hermes process is running
    let ps_check = Command::new("ps").args(&["aux"]).output();

    if let Ok(output) = ps_check {
        let stdout = String::from_utf8_lossy(&output.stdout);
        for line in stdout.lines() {
            if line.contains("hermes start") && !line.contains("grep") {
                // Found the process, check if log file exists and has recent activity
                let home = home_dir().unwrap_or_default();
                let log_file = home.join(".hermes/hermes.log");

                if log_file.exists() {
                    return (true, "Daemon running".to_string());
                }

                return (true, "Process running".to_string());
            }
        }
    }

    (false, "Daemon not running".to_string())
}

/// Check Cosmos sidechain health (packet-forwarding chain on port 26657)
fn check_cosmos_health() -> (bool, String) {
    // Try to connect to the Cosmos RPC port
    let port_check = Command::new("nc")
        .args(&["-z", "localhost", "26657"])
        .output();

    if let Ok(output) = port_check {
        if output.status.success() {
            // Try to get status from the RPC endpoint
            let status_check = Command::new("curl")
                .args(&[
                    "-s",
                    "--connect-timeout",
                    "3",
                    "http://127.0.0.1:26657/status",
                ])
                .output();

            if let Ok(status_output) = status_check {
                if status_output.status.success() {
                    let stdout = String::from_utf8_lossy(&status_output.stdout);
                    if stdout.contains("result") {
                        return (true, "Running on port 26657".to_string());
                    }
                }
            }

            return (true, "Port 26657 accessible".to_string());
        }
    }

    (false, "Not running (port 26657 not accessible)".to_string())
}
