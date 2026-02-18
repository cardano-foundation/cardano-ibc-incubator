use crate::constants::ENTRYPOINT_CHAIN_ID;
use crate::logger::{log_or_print_progress, log_or_show_progress, verbose};
use crate::setup::{
    configure_local_cardano_devnet, copy_cardano_env_file, download_mithril,
    prepare_db_sync_and_gateway, seed_cardano_devnet,
};
use crate::utils::{
    diagnose_container_failure, download_file, execute_script, execute_script_with_progress,
    get_cardano_state, get_user_ids, unzip_file, wait_for_health_check, wait_until_file_exists,
    CardanoQuery, IndicatorMessage,
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
use std::fs::{self};
use std::path::{Path, PathBuf};
use std::process::{Command, Output};
use std::thread;
use std::time::{Duration, Instant};
use std::u64;

const ENTRYPOINT_CONTAINER_NAME: &str = "entrypoint-node-prod";
const ENTRYPOINT_HOME_DIR: &str = "/root/.entrypoint";

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
        "Setting up Hermes keys for cardano-devnet and Cosmos Entrypoint chain",
        &optional_progress_bar,
    );

    // Cosmos Entrypoint chain: Use the pre-funded "relayer" account from the chain config.
    let entrypoint_mnemonic = "engage vote never tired enter brain chat loan coil venture soldier shine awkward keen delay link mass print venue federal ankle valid upgrade balance";
    let entrypoint_mnemonic_file = std::env::temp_dir().join("entrypoint-mnemonic.txt");
    fs::write(&entrypoint_mnemonic_file, entrypoint_mnemonic)
        .map_err(|e| format!("Failed to write entrypoint chain mnemonic: {}", e))?;

    let entrypoint_key_output = Command::new(&hermes_binary)
        .args(&[
            "keys",
            "add",
            "--chain",
            ENTRYPOINT_CHAIN_ID,
            "--mnemonic-file",
            entrypoint_mnemonic_file.to_str().unwrap(),
            "--overwrite",
        ])
        .output();

    let _ = fs::remove_file(&entrypoint_mnemonic_file);

    match entrypoint_key_output {
        Ok(output) if output.status.success() => {
            log_or_show_progress(
                "Added key for Cosmos Entrypoint chain",
                &optional_progress_bar,
            );
        }
        Ok(output) => {
            verbose(&format!(
                "Warning: Failed to add entrypoint chain key: {}",
                String::from_utf8_lossy(&output.stderr)
            ));
        }
        Err(e) => {
            verbose(&format!(
                "Warning: Failed to add entrypoint chain key: {}",
                e
            ));
        }
    }

    // Cardano: Prefer DEPLOYER_SK if explicitly provided, otherwise fall back to the
    // devnet-funded deployer key (`chains/cardano/config/credentials/me.sk`).
    //
    // This keeps Hermes (sender/signer identity) aligned with the Gateway's Lucid wallet
    // context and the seeded devnet funds. If we fall back to a random default key, the
    // test suite will see an unfunded sender and transfers will fail or behave unexpectedly.
    let project_root = relayer_path
        .parent()
        .ok_or("Failed to resolve project root from relayer path")?;
    let cardano_key = std::env::var("DEPLOYER_SK")
        .ok()
        .map(|k| k.trim().to_string())
        .filter(|k| !k.is_empty())
        .or_else(|| {
            let deployer_sk_path = project_root.join("chains/cardano/config/credentials/me.sk");
            fs::read_to_string(&deployer_sk_path)
                .ok()
                .map(|k| k.trim().to_string())
                .filter(|k| !k.is_empty())
        })
        .unwrap_or_else(|| {
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

pub fn build_aiken_validators_if_needed(
    project_root_path: &Path,
    clean: bool,
) -> Result<(), Box<dyn std::error::Error>> {
    let is_verbose = logger::get_verbosity() == logger::Verbosity::Verbose;
    let plutus_json_path = project_root_path.join("cardano").join("plutus.json");

    // When not running with `--clean`, avoid rebuilding validators if we already have a compiled
    // `plutus.json`. This is the common path during iterative development, and it lets us overlap
    // startup with other work without doing redundant compilation.
    //
    // In verbose mode we intentionally rebuild so Aiken trace flags are applied.
    if plutus_json_path.exists() && !clean && !is_verbose {
        return Ok(());
    }

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
) -> Result<Option<tokio::task::JoinHandle<Result<(), String>>>, Box<dyn std::error::Error>> {
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
                log_or_show_progress("Waiting for node to start up ...", &optional_progress_bar);
                std::thread::sleep(Duration::from_secs(5))
            }
        }
    }

    // Start Mithril as early as possible (after the Cardano node is reachable, but before we wait
    // for the Conway era to seed the devnet).
    //
    // The slow part of local Mithril boot is not the `docker compose up` itself, it is the epoch-
    // based waiting for Cardano immutable files + genesis certificate bootstrap. Starting Mithril
    // here reduces wall-clock time because those waits can overlap with:
    // - the remaining "wait for Conway" period,
    // - the devnet seeding transactions,
    // - Cosmos chain startup, Hermes build, contract deployment, etc.
    let mut mithril_genesis_handle = None;
    if with_mithril {
        let cardano_epoch_on_mithril_start =
            start_mithril_with_progress(project_root_path, &optional_progress_bar)
                .await
                .map_err(|e| format!("Failed to start Mithril services for local devnet: {}", e))?;

        log_or_print_progress(
            "PASS: Mithril services started (1 aggregator, 2 signers)",
            &optional_progress_bar,
        );
        log_or_print_progress(
            "Mithril genesis bootstrap started in background (waiting for immutable files and initial certificate chain)",
            &optional_progress_bar,
        );

        let project_root_path = project_root_path.to_path_buf();
        mithril_genesis_handle = Some(tokio::task::spawn_blocking(move || {
            wait_and_start_mithril_genesis(
                project_root_path.as_path(),
                cardano_epoch_on_mithril_start,
            )
            .map_err(|e| e.to_string())
        }));
    } else {
        log_or_print_progress(
            "Skipping Mithril services (use --with-mithril to enable light client testing)",
            &optional_progress_bar,
        );
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

    if let Some(progress_bar) = &optional_progress_bar {
        progress_bar.finish_and_clear();
    }

    Ok(mithril_genesis_handle)
}

pub async fn deploy_contracts(
    project_root_path: &Path,
    clean: bool,
    validators_already_built: bool,
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

    if validators_already_built {
        log_or_show_progress(
            &format!(
                "{} Aiken validators already built",
                style("Step 1/2").bold().dim()
            ),
            &optional_progress_bar,
        );
    } else {
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

pub async fn start_cosmos_entrypoint_chain_from_repository(
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
    normalize_downloaded_demo_chain_assets(chain_root_path)?;

    // This repository helper is also used by the message-exchange demo chain,
    // whose docker-compose service names differ from the built-in entrypoint chain.
    // Use compose-level cleanup here to avoid service-name assumptions.
    execute_script(
        chain_root_path,
        "docker",
        vec!["compose", "down", "-v", "--remove-orphans"],
        None,
    )?;
    execute_script(
        chain_root_path,
        "docker",
        vec!["compose", "up", "-d", "--build"],
        None,
    )?;
    wait_for_cosmos_entrypoint_chain_ready().await
}

fn normalize_downloaded_demo_chain_assets(
    chain_root_path: &Path,
) -> Result<(), Box<dyn std::error::Error>> {
    let dockerfile_path = chain_root_path.join("Dockerfile");
    if !dockerfile_path.exists() {
        return Ok(());
    }

    let dockerfile_content = fs::read_to_string(&dockerfile_path)?;
    if !dockerfile_content.contains("get.ignite.com/cli@v28.5.1!") {
        // Keep processing because we also normalize the Mithril codec below.
    } else {
        let normalized_content = dockerfile_content.replace(
            "get.ignite.com/cli@v28.5.1!",
            "get.ignite.com/cli@v28.11.2!",
        );
        fs::write(&dockerfile_path, normalized_content)?;
        verbose("Normalized downloaded demo Dockerfile to a valid Ignite CLI tag (v28.11.2)");
    }

    normalize_downloaded_demo_mithril_proto(chain_root_path)?;
    normalize_downloaded_demo_mithril_codec(chain_root_path)?;
    normalize_downloaded_demo_mithril_update_logic(chain_root_path)?;

    Ok(())
}

fn normalize_downloaded_demo_mithril_proto(
    chain_root_path: &Path,
) -> Result<(), Box<dyn std::error::Error>> {
    let proto_path =
        chain_root_path.join("vesseloracle/proto/ibc/clients/mithril/v1/mithril.proto");
    if !proto_path.exists() {
        return Ok(());
    }

    let mut proto_content = fs::read_to_string(&proto_path)?;
    let mut changed = false;

    if !proto_content.contains("bytes host_state_nft_policy_id = 8;") {
        proto_content = proto_content.replace(
            "  // Path at which next upgraded client will be committed.\n  repeated string upgrade_path = 7;\n}",
            "  // Path at which next upgraded client will be committed.\n  repeated string upgrade_path = 7;\n\n  bytes host_state_nft_policy_id = 8;\n\n  bytes host_state_nft_token_name = 9;\n}",
        );
        changed = true;
    }

    if !proto_content.contains("bytes ibc_state_root = 4;") {
        proto_content = proto_content.replace(
            "  string latest_cert_hash_tx_snapshot = 3;\n}",
            "  string latest_cert_hash_tx_snapshot = 3;\n\n  bytes ibc_state_root = 4;\n}",
        );
        changed = true;
    }

    if !proto_content.contains("string host_state_tx_hash = 5;") {
        proto_content = proto_content.replace(
            "  MithrilCertificate transaction_snapshot_certificate = 4;\n}",
            "  MithrilCertificate transaction_snapshot_certificate = 4;\n\n  string host_state_tx_hash = 5;\n\n  bytes host_state_tx_body_cbor = 6;\n\n  uint32 host_state_tx_output_index = 7;\n\n  bytes host_state_tx_proof = 8;\n\n  repeated MithrilCertificate previous_mithril_stake_distribution_certificates = 9;\n}",
        );
        changed = true;
    }

    if changed {
        fs::write(&proto_path, proto_content)?;
        verbose("Normalized downloaded demo Mithril proto to include Cardano relayer fields");
    }

    Ok(())
}

fn normalize_downloaded_demo_mithril_codec(
    chain_root_path: &Path,
) -> Result<(), Box<dyn std::error::Error>> {
    let codec_path = chain_root_path.join("vesseloracle/x/clients/mithril/codec.go");
    if !codec_path.exists() {
        return Ok(());
    }

    let codec_content = fs::read_to_string(&codec_path)?;
    if codec_content.contains("registerCustomTypeURLIfSupported") {
        return Ok(());
    }

    let normalized_codec = r#"package mithril

import (
	"reflect"

	codectypes "github.com/cosmos/cosmos-sdk/codec/types"

	"github.com/cosmos/ibc-go/v8/modules/core/exported"
)

// RegisterInterfaces register the ibc channel submodule interfaces to protobuf
// Any.
func RegisterInterfaces(registry codectypes.InterfaceRegistry) {
	registry.RegisterImplementations(
		(*exported.ClientState)(nil),
		&ClientState{},
	)
	registry.RegisterImplementations(
		(*exported.ConsensusState)(nil),
		&ConsensusState{},
	)
	registry.RegisterImplementations(
		(*exported.Height)(nil),
		&Height{},
	)
	registry.RegisterImplementations(
		(*exported.ClientMessage)(nil),
		&Misbehaviour{},
	)
	registry.RegisterImplementations(
		(*exported.ClientMessage)(nil),
		&MithrilHeader{},
	)

	// The demo chain still generates `ibc.clients.mithril.v1` protobuf names.
	// Hermes and the entrypoint chain use `ibc.lightclients.mithril.v1`.
	// Register both so tx decoding works during message-exchange setup.
	registerCustomTypeURLIfSupported(
		registry,
		(*exported.ClientState)(nil),
		"/ibc.lightclients.mithril.v1.ClientState",
		&ClientState{},
	)
	registerCustomTypeURLIfSupported(
		registry,
		(*exported.ConsensusState)(nil),
		"/ibc.lightclients.mithril.v1.ConsensusState",
		&ConsensusState{},
	)
	registerCustomTypeURLIfSupported(
		registry,
		(*exported.ClientMessage)(nil),
		"/ibc.lightclients.mithril.v1.Misbehaviour",
		&Misbehaviour{},
	)
	registerCustomTypeURLIfSupported(
		registry,
		(*exported.ClientMessage)(nil),
		"/ibc.lightclients.mithril.v1.MithrilHeader",
		&MithrilHeader{},
	)
}

func registerCustomTypeURLIfSupported(
	registry codectypes.InterfaceRegistry,
	iface interface{},
	typeURL string,
	impl interface{},
) {
	registerFn := reflect.ValueOf(registry).MethodByName("RegisterCustomTypeURL")
	if !registerFn.IsValid() {
		return
	}

	registerFn.Call([]reflect.Value{
		reflect.ValueOf(iface),
		reflect.ValueOf(typeURL),
		reflect.ValueOf(impl),
	})
}
"#;

    fs::write(&codec_path, normalized_codec)?;
    verbose("Normalized downloaded demo Mithril codec to accept ibc.lightclients type URLs");

    Ok(())
}

fn normalize_downloaded_demo_mithril_update_logic(
    chain_root_path: &Path,
) -> Result<(), Box<dyn std::error::Error>> {
    let update_path = chain_root_path.join("vesseloracle/x/clients/mithril/update.go");
    if !update_path.exists() {
        return Ok(());
    }

    let update_content = fs::read_to_string(&update_path)?;
    let from = r#"	} else {
		if firstCertInPrevEpoch == nilCertificate {
			return errorsmod.Wrapf(ErrInvalidCertificate, "prev epoch didn't store first mithril stake distribution certificate")
		}
		expectedPreviousCerForTs = *header.MithrilStakeDistributionCertificate
		if header.MithrilStakeDistributionCertificate.PreviousHash != firstCertInPrevEpoch.Hash {
			return errorsmod.Wrapf(ErrInvalidCertificate, "%s received: %v, expected: %v", "invalid first mithril state distribution certificate ", header.MithrilStakeDistributionCertificate.PreviousHash, firstCertInPrevEpoch.Hash)
		}
	}"#;
    let to = r#"	} else {
		expectedPreviousCerForTs = *header.MithrilStakeDistributionCertificate
		if firstCertInPrevEpoch != nilCertificate && header.MithrilStakeDistributionCertificate.PreviousHash != firstCertInPrevEpoch.Hash {
			return errorsmod.Wrapf(ErrInvalidCertificate, "%s received: %v, expected: %v", "invalid first mithril state distribution certificate ", header.MithrilStakeDistributionCertificate.PreviousHash, firstCertInPrevEpoch.Hash)
		}
	}"#;

    if update_content.contains(from) {
        fs::write(&update_path, update_content.replace(from, to))?;
        verbose("Normalized demo Mithril update logic to tolerate missing previous epoch cache");
    }

    Ok(())
}

pub fn start_cosmos_entrypoint_chain_services(
    cosmos_dir: &Path,
    clean: bool,
) -> Result<(), Box<dyn std::error::Error>> {
    if clean {
        execute_script(
            cosmos_dir,
            "docker",
            Vec::from(["compose", "down", "-v", "--remove-orphans"]),
            None,
        )?;
        execute_script(
            cosmos_dir,
            "docker",
            Vec::from([
                "compose",
                "run",
                "--rm",
                "--entrypoint",
                "bash",
                ENTRYPOINT_CONTAINER_NAME,
                "-lc",
                &format!("rm -rf {} /root/.ignite", ENTRYPOINT_HOME_DIR),
            ]),
            None,
        )?;
    } else {
        execute_script(cosmos_dir, "docker", Vec::from(["compose", "stop"]), None)?;
    }

    let mut args = vec!["compose", "up", "-d"];
    if clean {
        args.push("--build");
    }

    execute_script(cosmos_dir, "docker", args, None)?;
    Ok(())
}

pub async fn wait_for_cosmos_entrypoint_chain_ready() -> Result<(), Box<dyn std::error::Error>> {
    let optional_progress_bar = match logger::get_verbosity() {
        logger::Verbosity::Verbose => None,
        _ => Some(ProgressBar::new_spinner()),
    };

    if let Some(progress_bar) = &optional_progress_bar {
        progress_bar.enable_steady_tick(Duration::from_millis(100));
        progress_bar.set_style(
            ProgressStyle::with_template("{prefix:.bold} {spinner} {elapsed_precise}")
                .unwrap()
                .tick_chars("⠁⠂⠄⡀⢀⠠⠐⠈ "),
        );
        progress_bar.set_prefix("Waiting for Cosmos Entrypoint chain to start".to_owned());
    } else {
        log("Waiting for Cosmos Entrypoint chain to start ...");
    }

    // Wait for health check with fail-fast error detection
    // Check container health periodically (every 5 retries ~50 seconds) to detect unrecoverable errors early.
    // Similar to Cardano network startup, we should fail fast for issues that require developer intervention:
    // - Command not found errors (missing dependencies like 'ignite')
    // - Permission errors (requires fixing volume/socket permissions)
    // - Port conflicts (requires stopping conflicting services)
    // - Disk space errors (requires freeing up disk space)
    // Use the chain RPC to detect readiness instead of relying on the (optional) faucet endpoint.
    // This allows us to keep the faucet non-public while still having a stable readiness signal.
    let cosmos_status_url = config::get_config().health.cosmos_status_url;
    let max_retries = 60;
    let interval_ms = 10000; // 10 seconds
    let client = reqwest::Client::builder().no_proxy().build()?;

    for retry in 0..max_retries {
        let response = client.get(cosmos_status_url.as_str()).send().await;

        match response {
            Ok(resp) => {
                let status = resp.status();
                let body = resp.text().await.unwrap_or_default();

                if status.is_success() {
                    let latest_height = serde_json::from_str::<Value>(&body)
                        .ok()
                        .and_then(|json| {
                            json["result"]["sync_info"]["latest_block_height"]
                                .as_str()
                                .and_then(|s| s.parse::<u64>().ok())
                                .or_else(|| {
                                    json["result"]["sync_info"]["latest_block_height"].as_u64()
                                })
                        })
                        .unwrap_or(0);

                    if latest_height > 0 {
                        if let Some(progress_bar) = &optional_progress_bar {
                            progress_bar.finish_and_clear();
                        }
                        return Ok(());
                    }

                    verbose(&format!(
                        "Cosmos Entrypoint RPC is up but chain has not produced blocks yet (retry {})",
                        retry + 1
                    ));
                } else {
                    verbose(&format!(
                        "Health check {} failed with status: {} on retry {}",
                        cosmos_status_url,
                        status,
                        retry + 1
                    ));
                }
            }
            Err(e) => verbose(&format!(
                "Failed to send request to {} on retry {}: {}",
                cosmos_status_url,
                retry + 1,
                e
            )),
        }

        // Check container health every 5 retries (~50 seconds) to fail fast on unrecoverable errors
        if retry > 0 && retry % 5 == 0 {
            let container_names = [ENTRYPOINT_CONTAINER_NAME];
            let (diagnostics, should_fail_fast) = diagnose_container_failure(&container_names);
            if should_fail_fast {
                if let Some(progress_bar) = &optional_progress_bar {
                    progress_bar.finish_and_clear();
                }
                return Err(format!(
                    "Cosmos Entrypoint chain has unrecoverable errors that require developer intervention:{}",
                    diagnostics
                )
                .into());
            }
        }

        tokio::time::sleep(tokio::time::Duration::from_millis(interval_ms)).await;
    }

    // Final diagnostic check after timeout
    let container_names = [ENTRYPOINT_CONTAINER_NAME];
    let (diagnostics, _should_fail_fast) = diagnose_container_failure(&container_names);

    if let Some(progress_bar) = &optional_progress_bar {
        progress_bar.finish_and_clear();
    }

    Err(format!(
        "Health check on {} failed after {} attempts. The Cosmos Entrypoint chain may have crashed or is not responding.{}",
        cosmos_status_url,
        max_retries,
        diagnostics
    )
    .into())
}

pub async fn start_cosmos_entrypoint_chain(
    cosmos_dir: &Path,
    clean: bool,
) -> Result<(), Box<dyn std::error::Error>> {
    start_cosmos_entrypoint_chain_services(cosmos_dir, clean)?;
    wait_for_cosmos_entrypoint_chain_ready().await
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

    let mut current_slot = get_cardano_state(project_root_dir, CardanoQuery::Slot)?;

    let slots_per_epoch = get_cardano_state(project_root_dir, CardanoQuery::SlotsToEpochEnd)?
        + get_cardano_state(project_root_dir, CardanoQuery::SlotInEpoch)?;

    let target_epoch = cardano_epoch_on_mithril_start + 2;
    let target_slot = target_epoch * slots_per_epoch;
    let mut slots_left = target_slot.saturating_sub(current_slot);

    if slots_left > 0 {
        verbose(
            "Mithril needs to wait at least two epochs for the immutable files to be created ..",
        );
    }

    while slots_left > 0 {
        current_slot = get_cardano_state(project_root_dir, CardanoQuery::Slot)?;
        slots_left = target_slot.saturating_sub(current_slot);

        verbose(&format!(
            "Current slot: {}, Slots left: {}",
            current_slot, slots_left
        ));
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

    // Wait for the aggregator to observe and expose the next signers set.
    //
    // The genesis bootstrap command requires signers for the *next signer retrieval epoch*.
    // On fresh devnets this can lag behind the Cardano epoch progression, running bootstrap too
    // early results in "Missing signers for epoch X".
    let epoch_settings_url = "http://127.0.0.1:8080/aggregator/epoch-settings";
    let required_next_signers = 1;
    let signers_poll_interval = Duration::from_secs(5);
    let signers_poll_attempts = 240; // 20 minutes
    let http_client = reqwest::blocking::Client::builder()
        .no_proxy()
        .build()
        .map_err(|e| format!("Failed to build HTTP client for Mithril checks: {e}"))?;
    let mut last_epoch_settings_error: Option<String> = None;
    for attempt in 1..=signers_poll_attempts {
        match http_client.get(epoch_settings_url).send() {
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

    current_slot = get_cardano_state(project_root_dir, CardanoQuery::Slot)?;

    let target_epoch = cardano_epoch_on_mithril_start + 3;
    let target_slot = target_epoch * slots_per_epoch;
    slots_left = target_slot.saturating_sub(current_slot);

    if slots_left > 0 {
        verbose("Mithril now needs to wait at least one epoch for the the aggregator to start working and generating signatures for transaction sets ..");
    }

    while slots_left > 0 {
        current_slot = get_cardano_state(project_root_dir, CardanoQuery::Slot)?;
        slots_left = target_slot.saturating_sub(current_slot);

        verbose(&format!(
            "Current slot: {}, Slots left: {}",
            current_slot, slots_left
        ));
        std::thread::sleep(Duration::from_secs(10));
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

    let output = Command::new(&hermes_binary)
        .args(args)
        .output()
        .map_err(|error| {
            format!(
                "Failed to execute Hermes command '{} {}': {}",
                hermes_binary.display(),
                args.join(" "),
                error
            )
        })?;

    logger::verbose(&format!(
        "Hermes command completed in {:.2}s (success={})",
        started_at.elapsed().as_secs_f32(),
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
                .unwrap()
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

    // Validate config before starting
    log_or_show_progress("Validating Hermes configuration", &optional_progress_bar);
    let config_check = Command::new(&hermes_binary)
        .args(&[
            "--config",
            hermes_config.to_str().ok_or("Invalid Hermes config path")?,
            "config",
            "validate",
        ])
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
        .arg("--config")
        .arg(hermes_config.to_str().ok_or("Invalid Hermes config path")?)
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

/// Add a key to Hermes keyring via caribic
pub fn hermes_keys_add(
    chain: &str,
    mnemonic_file: &Path,
    key_name: Option<&str>,
    overwrite: bool,
) -> Result<String, Box<dyn std::error::Error>> {
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
        // List keys for all configured chains
        log("Listing keys for all chains...");

        let mut result = String::new();
        let mut found_any_keys = false;

        // List for cardano-devnet
        let cardano_output = run_hermes_command(&["keys", "list", "--chain", "cardano-devnet"])?;

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
        // List for Cosmos Entrypoint chain.
        let entrypoint_output =
            run_hermes_command(&["keys", "list", "--chain", ENTRYPOINT_CHAIN_ID])?;

        if entrypoint_output.status.success() {
            let output_str = String::from_utf8_lossy(&entrypoint_output.stdout);
            result.push_str(&format!(
                "entrypoint-chain (Hermes chain id: {}):\n",
                ENTRYPOINT_CHAIN_ID
            ));
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

#[derive(Copy, Clone)]
enum CoreHealthCheckType {
    Gateway,
    CardanoNode,
    Postgres,
    Kupo,
    Ogmios,
    Mithril,
    HermesDaemon,
    Cosmos,
}

#[derive(Copy, Clone)]
struct CoreHealthService {
    name: &'static str,
    label: &'static str,
    check_type: CoreHealthCheckType,
}

const CORE_HEALTH_SERVICES: [CoreHealthService; 8] = [
    CoreHealthService {
        name: "gateway",
        label: "Gateway (NestJS gRPC Server)",
        check_type: CoreHealthCheckType::Gateway,
    },
    CoreHealthService {
        name: "cardano",
        label: "Cardano Node",
        check_type: CoreHealthCheckType::CardanoNode,
    },
    CoreHealthService {
        name: "postgres",
        label: "PostgreSQL (db-sync)",
        check_type: CoreHealthCheckType::Postgres,
    },
    CoreHealthService {
        name: "kupo",
        label: "Kupo (Chain Indexer)",
        check_type: CoreHealthCheckType::Kupo,
    },
    CoreHealthService {
        name: "ogmios",
        label: "Ogmios (JSON/RPC)",
        check_type: CoreHealthCheckType::Ogmios,
    },
    CoreHealthService {
        name: "mithril",
        label: "Mithril (Aggregator + Signers)",
        check_type: CoreHealthCheckType::Mithril,
    },
    CoreHealthService {
        name: "hermes",
        label: "Hermes Relayer Daemon",
        check_type: CoreHealthCheckType::HermesDaemon,
    },
    CoreHealthService {
        name: "cosmos",
        label: "Cosmos Entrypoint chain",
        check_type: CoreHealthCheckType::Cosmos,
    },
];

struct HealthServiceStatus {
    name: String,
    label: String,
    healthy: bool,
    status: String,
}

struct HealthContext {
    mithril_dir: PathBuf,
}

fn build_health_context(project_root_path: &Path) -> HealthContext {
    HealthContext {
        mithril_dir: project_root_path.join("chains/mithrils"),
    }
}

fn find_core_health_service(service_name: &str) -> Option<CoreHealthService> {
    CORE_HEALTH_SERVICES
        .iter()
        .copied()
        .find(|service| service.name == service_name)
}

fn run_core_health_check(
    check_type: CoreHealthCheckType,
    context: &HealthContext,
) -> (bool, String) {
    match check_type {
        CoreHealthCheckType::Gateway => check_container_with_optional_port(
            "gateway-app",
            5001,
            "Container running, gRPC port 5001 accessible",
            "Container running (gRPC not ready yet)",
        ),
        CoreHealthCheckType::CardanoNode => check_container_only("cardano-node"),
        CoreHealthCheckType::Postgres => check_postgres_service(),
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
        CoreHealthCheckType::Mithril => check_mithril_service(context.mithril_dir.as_path()),
        CoreHealthCheckType::HermesDaemon => check_hermes_daemon_service(),
        CoreHealthCheckType::Cosmos => check_rpc_service(
            config::get_config().health.cosmos_status_url.as_str(),
            26657,
        ),
    }
}

fn collect_health_statuses(
    project_root_path: &Path,
    context: &HealthContext,
) -> Vec<HealthServiceStatus> {
    let mut statuses = CORE_HEALTH_SERVICES
        .iter()
        .map(|service| {
            let (healthy, status) = run_core_health_check(service.check_type, context);
            HealthServiceStatus {
                name: service.name.to_string(),
                label: service.label.to_string(),
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
        let network = adapter.default_network();
        let flags = chains::ChainFlags::new();
        match adapter.health(project_root_path, network, &flags) {
            Ok(statuses) => {
                for status in statuses {
                    optional_statuses.push(HealthServiceStatus {
                        name: status.id.to_string(),
                        label: status.label.to_string(),
                        healthy: status.healthy,
                        status: status.status,
                    });
                }
            }
            Err(error) => {
                optional_statuses.push(HealthServiceStatus {
                    name: adapter.id().to_string(),
                    label: format!("{} (optional chain)", adapter.display_name()),
                    healthy: false,
                    status: format!("Failed to run adapter health check: {}", error),
                });
            }
        }
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

pub fn check_service_health(
    project_root_path: &Path,
    service_name: &str,
) -> Result<(bool, String), Box<dyn std::error::Error>> {
    let context = build_health_context(project_root_path);
    if let Some(service) = find_core_health_service(service_name) {
        return Ok(run_core_health_check(service.check_type, &context));
    }

    if let Some(optional_status) = collect_optional_chain_health_statuses(project_root_path)
        .into_iter()
        .find(|status| status.name == service_name)
    {
        return Ok((optional_status.healthy, optional_status.status));
    }

    Err(format!(
        "Unknown service: {}. Supported services: {}",
        service_name,
        available_health_service_names(project_root_path, &context)
    )
    .into())
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
    let output = Command::new("docker")
        .args(&[
            "ps",
            "--filter",
            filter.as_str(),
            "--filter",
            "status=running",
            "--format",
            "{{.Names}}",
        ])
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    stdout
        .lines()
        .find(|line| !line.trim().is_empty())
        .map(|line| line.trim().to_string())
}

fn is_port_accessible(port: u16) -> bool {
    Command::new("nc")
        .args(&["-z", "localhost", &port.to_string()])
        .output()
        .ok()
        .is_some_and(|output| output.status.success())
}

fn endpoint_contains_result(url: &str) -> bool {
    Command::new("curl")
        .args(&["-s", "--connect-timeout", "3", url])
        .output()
        .ok()
        .filter(|output| output.status.success())
        .map(|output| String::from_utf8_lossy(&output.stdout).contains("result"))
        .unwrap_or(false)
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

    let ready = Command::new("docker")
        .args(&[
            "exec",
            container_name.as_str(),
            "pg_isready",
            "-U",
            "postgres",
        ])
        .output()
        .ok()
        .is_some_and(|output| output.status.success());

    if ready {
        (
            true,
            "Database accepting connections on port 6432".to_string(),
        )
    } else {
        (true, "Container running".to_string())
    }
}

fn check_mithril_service(mithril_dir: &Path) -> (bool, String) {
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

    let daemon_running = find_running_hermes_daemon(expected_binary.to_str());
    if daemon_running {
        let home = home_dir().unwrap_or_default();
        let log_file = home.join(".hermes/hermes.log");

        if log_file.exists() {
            return (true, "Daemon running".to_string());
        }

        return (true, "Process running".to_string());
    }

    (false, "Daemon not running".to_string())
}

fn find_running_hermes_daemon(expected_binary_path: Option<&str>) -> bool {
    let ps_output = Command::new("ps")
        .args(["-ax", "-o", "pid=,command="])
        .output();

    match ps_output {
        Ok(output) => String::from_utf8_lossy(&output.stdout)
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

fn is_hermes_daemon_command(command: &str, expected_binary_path: Option<&str>) -> bool {
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

fn check_rpc_service(url: &str, default_port: u16) -> (bool, String) {
    let port = reqwest::Url::parse(url)
        .ok()
        .and_then(|parsed_url| parsed_url.port_or_known_default())
        .unwrap_or(default_port);
    let port_label = port.to_string();

    if !is_port_accessible(port) {
        return (
            false,
            format!("Not running (port {} not accessible)", port_label),
        );
    }

    if endpoint_contains_result(url) {
        (true, format!("Running on port {}", port_label))
    } else {
        (true, format!("Port {} accessible", port_label))
    }
}
