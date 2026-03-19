use crate::config;
use crate::logger::{log, log_or_show_progress, verbose, warn};
use crate::utils::{
    change_dir_permissions_read_only, delete_file, download_file, replace_text_in_file, unzip_file,
    IndicatorMessage,
};
use chrono::{SecondsFormat, Utc};
use console::style;
use fs_extra::{copy_items, file::copy};
use indicatif::ProgressBar;
use serde_json::Value;
use std::process::Output;
use std::thread;
use std::time::Duration;
use std::{fs, path::Path, process::Command};

pub async fn download_repository(
    url: &str,
    path: &Path,
    name: &str,
) -> Result<(), Box<dyn std::error::Error>> {
    let base_path = path.parent();

    if (base_path.is_none() || !base_path.unwrap().exists()) && base_path.is_some() {
        fs::create_dir_all(base_path.unwrap()).map_err(|error| {
            format!(
                "Failed to create directory for {} source code: {}",
                name,
                error.to_string()
            )
        })?;
    }

    if let Some(base_path) = base_path {
        let zip_path = base_path.join(format!("{}.zip", name)).to_owned();

        download_file(
            url,
            zip_path.as_path(),
            Some(IndicatorMessage {
                message: format!("Downloading {} source code", name),
                step: "Step 1/2".to_string(),
                emoji: "".to_string(),
            }),
        )
        .await
        .map_err(|error| {
            format!(
                "Failed to download {} source code: {}",
                name,
                error.to_string()
            )
        })?;

        log(&format!(
            "{} Extracting {} source code...",
            style("Step 2/2").bold().dim(),
            name
        ));

        unzip_file(zip_path.as_path(), path).map_err(|error| {
            format!(
                "Failed to unzip {} source code: {}",
                name,
                error.to_string()
            )
        })?;

        delete_file(zip_path.as_path())
            .map_err(|error| format!("Failed to cleanup {}.zip: {}", name, error.to_string()))?;

        Ok(())
    } else {
        Err(format!("Failed to locate parent dir of {}", path.display()).into())
    }
}

pub async fn download_mithril(mithril_path: &Path) -> Result<(), Box<dyn std::error::Error>> {
    let url = "https://github.com/input-output-hk/mithril/archive/refs/tags/2437.1.zip";
    download_repository(url, mithril_path, "mithril").await
}

pub fn copy_cardano_env_file(cardano_dir: &Path) -> Result<(), Box<dyn std::error::Error>> {
    let source = cardano_dir.join(".env.example");
    let destination = cardano_dir.join(".env");

    Command::new("cp")
        .arg(source)
        .arg(destination)
        .status()
        .map_err(|error| {
            format!(
                "Failed to copy template Cardano .env file: {}",
                error.to_string()
            )
        })?;
    Ok(())
}

pub fn configure_local_cardano_devnet(
    cardano_dir: &Path,
) -> Result<(), Box<dyn std::error::Error>> {
    let cardano_config_dir = cardano_dir.join("config");
    let service_folders = vec![
        "devnet",
        "kupo-db",
        "db-sync-data",
        "db-sync-configuration",
        "db-sync-log-dir",
        "postgres",
        "yaci/genesis",
        "yaci/data",
        "yaci/logs",
        "yaci-postgres",
        "baseinfo",
    ];

    for service_folder in &service_folders {
        let serivce_folder_path = cardano_dir.join(service_folder);
        if serivce_folder_path.exists() && serivce_folder_path.is_dir() {
            fs::remove_dir_all(&serivce_folder_path).map_err(|error| {
                format!(
                    "Failed to remove existing devnet directory: {}",
                    error.to_string()
                )
            })?;
        }
    }

    // Recreate the deleted folders as empty directories
    for service_folder in &service_folders {
        let serivce_folder_path = cardano_dir.join(service_folder);
        fs::create_dir_all(&serivce_folder_path).map_err(|error| {
            format!(
                "Failed to create service folder {}: {}",
                service_folder,
                error.to_string()
            )
        })?;
    }

    let devnet_dir = cardano_dir.join("devnet");

    let cardano_config_files = vec![
        //cardano_config_dir.join("protocol-parameters.json"),
        cardano_config_dir.join("credentials"),
    ];

    let copy_dir_options = fs_extra::dir::CopyOptions::new().overwrite(true);
    copy_items(
        &vec![cardano_config_dir.join("devnet")],
        &cardano_dir,
        &copy_dir_options,
    )
    .map_err(|error| {
        format!(
            "Failed to copy Cardano configuration files: {}",
            error.to_string()
        )
    })?;

    for source in cardano_config_files {
        verbose(&format!(
            "Try to copy Cardano configuration file(s) {} to {}",
            source.display(),
            cardano_dir.display()
        ));

        if source.is_dir() {
            copy_items(&vec![source], &devnet_dir, &copy_dir_options).map_err(|error| {
                format!(
                    "Failed to copy Cardano configuration files: {}",
                    error.to_string()
                )
            })?;
        } else {
            let options = fs_extra::file::CopyOptions::new().overwrite(true);
            let destination = devnet_dir.join(source.file_name().unwrap());
            copy(source, destination, &options).map_err(|error| {
                format!(
                    "Failed to copy Cardano configuration file: {}",
                    error.to_string()
                )
            })?;
        }
    }

    let genesis_byron_path = devnet_dir.join("genesis-byron.json");
    let genesis_shelley_path = devnet_dir.join("genesis-shelley.json");

    let start_time = Utc::now();

    replace_text_in_file(
        &genesis_byron_path,
        r#""startTime": \d*"#,
        &format!(r#""startTime": {}"#, start_time.timestamp()),
    )?;

    replace_text_in_file(
        &genesis_shelley_path,
        r#""systemStart": ".*""#,
        &format!(
            r#""systemStart": "{}""#,
            start_time.to_rfc3339_opts(SecondsFormat::Secs, true)
        ),
    )?;

    let yaci_genesis_dir = cardano_dir.join("yaci").join("genesis");
    fs::create_dir_all(&yaci_genesis_dir).map_err(|error| {
        format!(
            "Failed to create Yaci genesis directory: {}",
            error.to_string()
        )
    })?;

    for genesis_file in [
        "genesis-byron.json",
        "genesis-shelley.json",
        "genesis-alonzo.json",
        "genesis-conway.json",
    ] {
        let source = devnet_dir.join(genesis_file);
        let destination = yaci_genesis_dir.join(genesis_file);
        let options = fs_extra::file::CopyOptions::new().overwrite(true);
        copy(&source, &destination, &options).map_err(|error| {
            format!(
                "Failed to copy {} into Yaci genesis directory: {}",
                genesis_file,
                error.to_string()
            )
        })?;
    }

    // Yaci Store 2.0.0 crashes on the seeded local devnet Shelley genesis when staking pools and
    // stake mappings are present. For local development we only need the genesis timing/network
    // parameters, so keep a Yaci-specific copy with an empty staking section.
    let mut yaci_shelley_genesis: Value = serde_json::from_str(
        &fs::read_to_string(yaci_genesis_dir.join("genesis-shelley.json")).map_err(|error| {
            format!(
                "Failed to read Yaci Shelley genesis file: {}",
                error.to_string()
            )
        })?,
    )
    .map_err(|error| format!("Failed to parse Yaci Shelley genesis file: {}", error))?;

    if let Some(staking) = yaci_shelley_genesis
        .get_mut("staking")
        .and_then(|value| value.as_object_mut())
    {
        staking.insert("pools".to_string(), Value::Object(serde_json::Map::new()));
        staking.insert("stake".to_string(), Value::Object(serde_json::Map::new()));
    }

    fs::write(
        yaci_genesis_dir.join("genesis-shelley.json"),
        serde_json::to_string_pretty(&yaci_shelley_genesis).map_err(|error| {
            format!(
                "Failed to serialize Yaci Shelley genesis file: {}",
                error.to_string()
            )
        })?,
    )
    .map_err(|error| {
        format!(
            "Failed to write Yaci Shelley genesis file: {}",
            error.to_string()
        )
    })?;

    change_dir_permissions_read_only(&devnet_dir, &vec!["cardano-node-db.json"]).map_err(|error| {
        format!(
            "Failed to apply read-only permissions to Cardano configuration files. This will cause issues with the Cardano node: {}",
            error.to_string()
        )
    })?;

    let ipc_dir = devnet_dir.join("ipc");
    std::fs::create_dir_all(ipc_dir).map_err(|errpr| {
        format!(
            "Failed to create devnet/ipc directory: {}",
            errpr.to_string()
        )
    })?;

    Ok(())
}

pub fn seed_cardano_devnet(cardano_dir: &Path, optional_progress_bar: &Option<ProgressBar>) {
    log_or_show_progress("Seeding Cardano Devnet", &optional_progress_bar);
    let bootstrap_addresses = config::get_config().cardano.bootstrap_addresses;

    for bootstrap_address in bootstrap_addresses {
        log_or_show_progress(
            &format!(
                "Sending {} ADA to {}",
                style(bootstrap_address.amount).bold().dim(),
                style(&bootstrap_address.address).bold().dim()
            ),
            &optional_progress_bar,
        );
        let cardano_cli_args = vec!["compose", "exec", "cardano-node", "cardano-cli"];
        let build_address_args = vec![
            "address",
            "build",
            "--payment-verification-key-file",
            "/devnet/credentials/faucet.vk",
            "--testnet-magic",
            "42",
        ];
        let address = Command::new("docker")
            .current_dir(cardano_dir)
            .args(&cardano_cli_args)
            .args(build_address_args)
            .output()
            .expect("Failed to build address")
            .stdout;

        let faucet_address = String::from_utf8(address).expect("Failed to get faucet address");
        let faucet_txin_args = vec![
            "query",
            "utxo",
            "--address",
            &faucet_address,
            "--output-json",
            "--testnet-magic",
            "42",
        ];

        let mut faucet_txin_output: Option<Output> = None;
        for i in 1..5 {
            faucet_txin_output = Some(
                Command::new("docker")
                    .current_dir(cardano_dir)
                    .args(&cardano_cli_args)
                    .args(&faucet_txin_args)
                    .output()
                    .expect("Failed to get faucet txin"),
            );

            if faucet_txin_output.as_ref().unwrap().status.success() {
                break;
            } else {
                if i < 5 {
                    verbose(
                        "The cardano-node isn't ready yet. Retrying to get faucet txin in 5 sec...",
                    );
                    thread::sleep(Duration::from_secs(5));
                }
                faucet_txin_output = None;
            }
        }

        match faucet_txin_output {
            Some(output) => {
                if output.status.success() {
                    let output_str = String::from_utf8_lossy(&output.stdout);
                    let parsed_json: Value =
                        serde_json::from_str(&output_str).expect("Failed to parse JSON");
                    let faucet_txin = parsed_json
                        .as_object()
                        .and_then(|obj| obj.keys().next())
                        .expect("Failed to extract key");

                    let wallet_address = &bootstrap_address.address;
                    let tx_out = &format!("{}+{}", wallet_address, bootstrap_address.amount);
                    let draft_tx_file = &format!("/devnet/seed-{}.draft", wallet_address.as_str());
                    let signed_tx_file =
                        &format!("/devnet/seed-{}.signed", wallet_address.as_str());

                    let build_tx_args = vec![
                        "conway",
                        "transaction",
                        "build",
                        "--change-address",
                        &faucet_address,
                        "--tx-in",
                        &faucet_txin,
                        "--tx-out",
                        tx_out,
                        "--out-file",
                        draft_tx_file,
                        "--testnet-magic",
                        "42",
                    ];

                    let _ = Command::new("docker")
                        .current_dir(cardano_dir)
                        .args(&cardano_cli_args)
                        .args(build_tx_args)
                        .output()
                        .expect("Failed to build transaction");

                    let sign_tx_args = vec![
                        "conway",
                        "transaction",
                        "sign",
                        "--tx-body-file",
                        draft_tx_file,
                        "--signing-key-file",
                        "/devnet/credentials/faucet.sk",
                        "--out-file",
                        signed_tx_file,
                        "--testnet-magic",
                        "42",
                    ];

                    let _ = Command::new("docker")
                        .current_dir(cardano_dir)
                        .args(&cardano_cli_args)
                        .args(sign_tx_args)
                        .output()
                        .expect("Failed to sign transaction");

                    let tx_id = Command::new("docker")
                        .current_dir(cardano_dir)
                        .args(&cardano_cli_args)
                        .args(&["conway", "transaction", "txid", "--tx-file", signed_tx_file])
                        .output()
                        .expect("Failed to get txid")
                        .stdout;

                    let raw_tx_id = String::from_utf8(tx_id).expect("Failed to get txid");
                    let tx_id: String = raw_tx_id.chars().filter(|c| !c.is_whitespace()).collect();

                    let tx_in = &format!("{}#0", tx_id);
                    let submit_tx_args = vec![
                        "conway",
                        "transaction",
                        "submit",
                        "--tx-file",
                        signed_tx_file,
                        "--testnet-magic",
                        "42",
                    ];
                    let _ = Command::new("docker")
                        .current_dir(cardano_dir)
                        .args(&cardano_cli_args)
                        .args(submit_tx_args)
                        .output()
                        .expect("Failed to submit transaction");

                    let query_utxo_args = vec![
                        "query",
                        "utxo",
                        "--tx-in",
                        tx_in,
                        "--output-json",
                        "--testnet-magic",
                        "42",
                    ];
                    log_or_show_progress(
                        &format!(
                            "Waiting for transaction {} to settle",
                            style(tx_in).bold().dim()
                        ),
                        &optional_progress_bar,
                    );

                    let mut is_not_on_chain = true;
                    while is_not_on_chain {
                        let utxo_output = Command::new("docker")
                            .current_dir(cardano_dir)
                            .args(&cardano_cli_args)
                            .args(&query_utxo_args)
                            .output()
                            .expect("Failed to query utxo");

                        if utxo_output.status.success() {
                            let utxo_str =
                                String::from_utf8(utxo_output.stdout).expect("Failed to get utxo");
                            let parsed_utxo: Value =
                                serde_json::from_str(&utxo_str).expect("Failed to parse utxo");
                            verbose(&format!(
                                "Successfully see transaction on-chain:\n{}",
                                utxo_str
                            ));

                            if parsed_utxo.get(tx_in).is_some_and(|value| value != "null") {
                                is_not_on_chain = false;
                            } else {
                                verbose("... still waiting for confirmation ...");
                                thread::sleep(Duration::from_secs(5));
                            }
                        } else {
                            verbose("... still waiting for confirmation ...");
                            thread::sleep(Duration::from_secs(5));
                        }
                    }
                }
            }
            None => {
                warn("It seems the cardano-node has an issue. Please check the logs in your docker container logs if there is any issue.");
                return;
            }
        }
    }
}

fn get_genesis_hash(era: String, script_dir: &Path) -> Result<String, Box<dyn std::error::Error>> {
    let cli_args;
    let genesis_file = format!("/devnet/genesis-{}.json", era);
    if era == "byron" {
        cli_args = vec![
            "byron",
            "genesis",
            "print-genesis-hash",
            "--genesis-json",
            genesis_file.as_str(),
        ];
    } else {
        cli_args = vec![
            "conway",
            "genesis",
            "hash",
            "--genesis",
            genesis_file.as_str(),
        ];
    }

    let genesis_hash = Command::new("docker")
        .current_dir(script_dir)
        .args(&["compose", "exec", "cardano-node", "cardano-cli"])
        .args(cli_args)
        .output()
        .map_err(|error| format!("Failed to get genesis hash: {}", error.to_string()))?
        .stdout;

    let hash = String::from_utf8(genesis_hash)
        .map_err(|error| format!("Failed to get {} genesis hash: {}", &era, error.to_string()))?;
    Ok(hash)
}

pub fn prepare_history_backend_and_gateway(
    cardano_dir: &Path,
    clean: bool,
) -> Result<(), Box<dyn std::error::Error>> {
    let devnet_dir = cardano_dir.join("devnet");
    let cardano_node_db = devnet_dir.join("cardano-node-db.json");

    let byron_genesis_hash = get_genesis_hash("byron".to_string(), &devnet_dir)?;
    let shelley_genesis_hash = get_genesis_hash("shelley".to_string(), &devnet_dir)?;
    let alonzo_genesis_hash = get_genesis_hash("alonzo".to_string(), &devnet_dir)?;
    let conway_genesis_hash = get_genesis_hash("conway".to_string(), &devnet_dir)?;

    replace_text_in_file(
        &cardano_node_db,
        r#"xByronGenesisHash"#,
        &byron_genesis_hash.trim(),
    )?;

    replace_text_in_file(
        &cardano_node_db,
        r#"xShelleyGenesisHash"#,
        &shelley_genesis_hash.trim(),
    )?;

    replace_text_in_file(
        &cardano_node_db,
        r#"xAlonzoGenesisHash"#,
        &alonzo_genesis_hash.trim(),
    )?;

    replace_text_in_file(
        &cardano_node_db,
        r#"xConwayGenesisHash"#,
        &conway_genesis_hash.trim(),
    )?;

    let epoch_nonce = Command::new("docker")
        .current_dir(cardano_dir)
        .args(&["compose", "exec", "cardano-node", "cardano-cli"])
        .args(&["query", "protocol-state", "--testnet-magic", "42"])
        .output()
        .map_err(|error| format!("Failed to get epoch nonce: {}", error.to_string()))?
        .stdout;

    let epoch_nonce = String::from_utf8(epoch_nonce)
        .map_err(|error| format!("Failed to get epoch nonce: {}", error.to_string()))?;
    let epoch_nonce: Value = serde_json::from_str(&epoch_nonce)
        .map_err(|error| format!("Failed to parse epoch nonce: {}", error.to_string()))?;
    let epoch_nonce = epoch_nonce["epochNonce"]
        .as_str()
        .ok_or("Failed to extract epoch nonce")?;

    let pool_params = Command::new("docker")
        .current_dir(cardano_dir)
        .args(&["compose", "exec", "cardano-node", "cardano-cli"])
        .args(&["query", "ledger-state", "--testnet-magic", "42"])
        .output()
        .map_err(|error| format!("Failed to get pool params: {}", error.to_string()))?
        .stdout;

    let pool_params = String::from_utf8(pool_params)
        .map_err(|error| format!("Failed to get pool params: {}", error.to_string()))?;

    let pool_params: Value = serde_json::from_str(&pool_params)
        .map_err(|error| format!("Failed to parse pool params: {}", error.to_string()))?;
    let pool_params = pool_params["stateBefore"]["esSnapshots"]["pstakeMark"]["poolParams"]
        .as_object()
        .ok_or("Failed to extract pool params")?;

    let base_info_dir = cardano_dir.join("baseinfo");
    fs::create_dir_all(&base_info_dir)
        .map_err(|error| format!("Failed to create baseinfo directory: {}", error.to_string()))?;

    let pool_params_str = serde_json::to_string(pool_params)
        .map_err(|error| format!("Failed to serialize poolParams: {}", error.to_string()))?;

    let info = format!(
        "{{\"Epoch0Nonce\": \"{}\", \"poolParams\": {}}}",
        epoch_nonce.trim(),
        pool_params_str.trim()
    );
    fs::write(base_info_dir.join("info.json"), info)
        .map_err(|error| format!("Failed to write info.json file: {}", error.to_string()))?;

    let cardano_source_dir = cardano_dir.join("../../cardano");
    let gateway_dir = cardano_source_dir.join("gateway");
    let gateway_env = gateway_dir.join(".env");

    if clean || !gateway_env.exists() {
        let options = fs_extra::file::CopyOptions::new().overwrite(true);
        copy(gateway_dir.join(".env.example"), &gateway_env, &options)?;
    }

    // Keep gateway networking aligned with docker-compose service DNS instead of host loopback.
    let gateway_network_defaults = [
        ("HISTORY_DB_HOST", "yaci-store-postgres"),
        ("HISTORY_DB_PORT", "5432"),
        ("HISTORY_DB_NAME", "yaci_store"),
        ("HISTORY_DB_USERNAME", "yaci"),
        ("HISTORY_DB_PASSWORD", "dbpass"),
        ("GATEWAY_DB_HOST", "postgres"),
        ("GATEWAY_DB_PORT", "5432"),
        ("KUPO_ENDPOINT", "http://kupo:1442"),
        ("OGMIOS_ENDPOINT", "http://cardano-node-ogmios:1337"),
        ("CARDANO_CHAIN_HOST", "cardano-node"),
        ("CARDANO_CHAIN_PORT", "3001"),
        (
            "MITHRIL_ENDPOINT",
            "http://mithril-aggregator:8080/aggregator",
        ),
    ];
    for (key, value) in gateway_network_defaults {
        replace_text_in_file(
            &gateway_env,
            format!(r#"{}=.*"#, key).as_str(),
            format!("{}={}", key, value).as_str(),
        )?;
    }

    replace_text_in_file(
        &gateway_env,
        r#"CARDANO_EPOCH_NONCE_GENESIS=.*"#,
        &format!("CARDANO_EPOCH_NONCE_GENESIS=\"{}\"", epoch_nonce.trim()),
    )?;

    // The Gateway builds unsigned transactions using Lucid. Even though Hermes performs signing,
    // the Gateway still needs a wallet context to select UTxOs for fees and change.
    //
    // For local devnet testing, we use the same signing key that funds the devnet address
    // (`chains/cardano/config/credentials/me.sk`).
    //
    // Note: this writes into `cardano/gateway/.env` which is intentionally not tracked by git.
    let deployer_sk_path = cardano_dir.join("config/credentials/me.sk");
    if deployer_sk_path.exists() {
        let deployer_sk = fs::read_to_string(&deployer_sk_path).map_err(|error| {
            format!(
                "Failed to read deployer signing key at {}: {}",
                deployer_sk_path.display(),
                error
            )
        })?;
        let deployer_sk = deployer_sk.trim();
        if !deployer_sk.is_empty() {
            replace_text_in_file(
                &gateway_env,
                r#"DEPLOYER_SK=.*"#,
                &format!("DEPLOYER_SK={}", deployer_sk),
            )?;
        }
    }

    let wait_for_postgres = |service_name: &str,
                             username: &str,
                             label: &str|
     -> Result<(), Box<dyn std::error::Error>> {
        let mut ready = false;
        for attempt in 1..=30 {
            let health_check = Command::new("docker")
                .current_dir(cardano_dir)
                .args(&[
                    "compose",
                    "exec",
                    "-T",
                    service_name,
                    "pg_isready",
                    "-U",
                    username,
                ])
                .output();

            if health_check.is_ok() && health_check.unwrap().status.success() {
                ready = true;
                break;
            }

            if attempt < 30 {
                verbose(&format!(
                    "Waiting for {label} to be ready (attempt {}/30)...",
                    attempt
                ));
                thread::sleep(Duration::from_secs(2));
            }
        }

        if ready {
            Ok(())
        } else {
            Err(format!("{label} failed to become ready after 60 seconds").into())
        }
    };

    wait_for_postgres("postgres", "postgres", "gateway postgres")?;
    if crate::config::get_config().cardano.services.history_backend_enabled() {
        wait_for_postgres("yaci-store-postgres", "yaci", "Yaci history postgres")?;
    }

    let ensure_database_exists = |service_name: &str,
                                  database_user: &str,
                                  admin_database: &str,
                                  database_name: &str,
                                  label: &str|
     -> Result<(), Box<dyn std::error::Error>> {
            let db_check = Command::new("docker")
                .current_dir(cardano_dir)
                .args(&[
                    "compose",
                    "exec",
                    "-T",
                    service_name,
                    "psql",
                    "-U",
                    database_user,
                    "-d",
                    admin_database,
                    "-tc",
                    &format!(
                        "SELECT 1 FROM pg_database WHERE datname = '{}'",
                        database_name
                    ),
                ])
                .output();

            let db_exists = db_check
                .ok()
                .and_then(|output| String::from_utf8(output.stdout).ok())
                .map(|result| result.trim().contains("1"))
                .unwrap_or(false);

            if db_exists {
                verbose(&format!("{label} database already exists"));
                return Ok(());
            }

            log(&format!("Creating {database_name} database..."));
            let create_result = Command::new("docker")
                .current_dir(cardano_dir)
                .args(&[
                    "compose",
                    "exec",
                    "-T",
                    service_name,
                    "psql",
                    "-U",
                    database_user,
                    "-d",
                    admin_database,
                    "-c",
                    &format!("CREATE DATABASE {}", database_name),
                ])
                .output()
                .map_err(|error| {
                    format!(
                        "Failed to create {} database: {}",
                        database_name,
                        error.to_string()
                    )
                })?;

            if !create_result.status.success() {
                let error_msg = String::from_utf8_lossy(&create_result.stderr);
                return Err(
                    format!("Failed to create {} database: {}", database_name, error_msg).into(),
                );
            }

            log(&format!("{label} database created successfully"));
            Ok(())
        };

    ensure_database_exists("postgres", "postgres", "postgres", "gateway_app", "Gateway application")?;
    if crate::config::get_config().cardano.services.history_backend_enabled() {
        ensure_database_exists(
            "yaci-store-postgres",
            "yaci",
            "postgres",
            "yaci_store",
            "Yaci history backend",
        )?;
    }

    Ok(())
}
