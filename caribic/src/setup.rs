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
use std::io::{self, Write};
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

pub async fn download_osmosis(osmosis_path: &Path) -> Result<(), Box<dyn std::error::Error>> {
    let url = "https://github.com/osmosis-labs/osmosis/archive/refs/tags/v30.0.1.zip";
    download_repository(url, osmosis_path, "osmosis").await
}

pub async fn install_osmosisd(osmosis_path: &Path) {
    let question = "Do you want to install osmosisd? (yes/no): ";

    print!("{}", question);
    io::stdout().flush().unwrap();

    let mut input = String::new();
    io::stdin()
        .read_line(&mut input)
        .expect("Failed to read input");

    let input = input.trim().to_lowercase();

    if input == "yes" || input == "y" {
        println!(
            "{} Installing osmosisd...",
            style("Step 1/1").bold().dim()
        );

        Command::new("make")
            .current_dir(osmosis_path)
            .arg("install")
            .output()
            .expect("Failed to install osmosisd");

        println!("PASS: osmosisd installed successfully");
    }
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

pub fn prepare_db_sync_and_gateway(
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

    replace_text_in_file(
        &gateway_env,
        r#"CARDANO_EPOCH_NONCE_GENESIS=.*"#,
        &format!("CARDANO_EPOCH_NONCE_GENESIS=\"{}\"", epoch_nonce.trim()),
    )?;

    // Populate DEPLOYER_SK with the key from me.sk (used by Gateway to build transactions)
    let deployer_sk_path = cardano_dir.join("config/credentials/me.sk");
    if deployer_sk_path.exists() {
        let deployer_sk = fs::read_to_string(&deployer_sk_path)
            .map_err(|e| format!("Failed to read me.sk: {}", e))?;
        replace_text_in_file(
            &gateway_env,
            r#"DEPLOYER_SK=.*"#,
            &format!("DEPLOYER_SK={}", deployer_sk.trim()),
        )?;
        verbose(&format!("Set DEPLOYER_SK from {}", deployer_sk_path.display()));
    }

    // Wait for postgres to be ready before creating gateway database
    let mut postgres_ready = false;
    for attempt in 1..=30 {
        let health_check = Command::new("docker")
            .current_dir(cardano_dir)
            .args(&["compose", "exec", "-T", "postgres", "pg_isready", "-U", "postgres"])
            .output();

        if health_check.is_ok() && health_check.unwrap().status.success() {
            postgres_ready = true;
            break;
        }

        if attempt < 30 {
            verbose(&format!(
                "Waiting for postgres to be ready (attempt {}/30)...",
                attempt
            ));
            thread::sleep(Duration::from_secs(2));
        }
    }

    if !postgres_ready {
        return Err("Postgres failed to become ready after 60 seconds".into());
    }

    // Create the gateway application database if it doesn't exist
    let db_check = Command::new("docker")
        .current_dir(cardano_dir)
        .args(&[
            "compose",
            "exec",
            "-T",
            "postgres",
            "psql",
            "-U",
            "postgres",
            "-tc",
            "SELECT 1 FROM pg_database WHERE datname = 'gateway_app'",
        ])
        .output();

    let db_exists = db_check
        .ok()
        .and_then(|output| String::from_utf8(output.stdout).ok())
        .map(|result| result.trim().contains("1"))
        .unwrap_or(false);

    if !db_exists {
        log("Creating gateway_app database...");
        let create_result = Command::new("docker")
            .current_dir(cardano_dir)
            .args(&[
                "compose",
                "exec",
                "-T",
                "postgres",
                "psql",
                "-U",
                "postgres",
                "-c",
                "CREATE DATABASE gateway_app",
            ])
            .output()
            .map_err(|error| {
                format!("Failed to create gateway_app database: {}", error.to_string())
            })?;

        if !create_result.status.success() {
            let error_msg = String::from_utf8_lossy(&create_result.stderr);
            return Err(format!("Failed to create gateway_app database: {}", error_msg).into());
        }
        log("Gateway application database created successfully");
    } else {
        verbose("Gateway application database already exists");
    }

    Ok(())
}
