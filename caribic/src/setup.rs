use crate::logger::verbose;
use crate::utils::{delete_file, download_file, execute_script, unzip_file, IndicatorMessage};
use chrono::{SecondsFormat, Utc};
use console::style;
use fs_extra::{copy_items, file::copy};
use serde_json;
use std::fs::{self, create_dir, File};
use std::io::{self, Write};
use std::os::unix::fs::PermissionsExt;
use regex::Regex;
use std::{path::Path, process::Command};

pub async fn download_osmosis(osmosis_path: &Path) {
    let url = "https://github.com/osmosis-labs/osmosis/archive/refs/tags/v25.2.0.zip";

    let base_path = osmosis_path
        .parent()
        .expect("osmosis_path should have a parent directory");
    let zip_path = base_path.join("osmosis.zip").to_owned();

    download_file(
        url,
        zip_path.as_path(),
        Some(IndicatorMessage {
            message: "Downloading osmosis source code".to_string(),
            step: "Step 1/2".to_string(),
            emoji: "📥 ".to_string(),
        }),
    )
    .await
    .expect("Failed to download osmosis source code");

    println!(
        "{} 📦 Extracting osmosis source code...",
        style("Step 2/2").bold().dim()
    );

    unzip_file(zip_path.as_path(), osmosis_path).expect("Failed to unzip osmosis source code");
    delete_file(zip_path.as_path()).expect("Failed to cleanup osmosis.zip");
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
            "{} 🛠️ Installing osmosisd...",
            style("Step 1/1").bold().dim()
        );

        Command::new("make")
            .current_dir(osmosis_path)
            .arg("install")
            .output()
            .expect("Failed to install osmosisd");

        println!("✅ osmosisd installed successfully");
    }
}

pub fn copy_cardano_env_file(cardano_dir: &Path) {
    let source = cardano_dir.join(".env.example");
    let destination = cardano_dir.join(".env");

    Command::new("cp")
        .arg(source)
        .arg(destination)
        .status()
        .expect("Failed to copy Cardano environment file");
}

pub fn replace_hash_for_dbsync(cardano_dir: &Path, args: Vec<&str>, old_string: &str) {
    let hash = Command::new("docker")
        .current_dir(cardano_dir)
        .args(vec!["compose", "exec", "cardano-node", "cardano-cli"])
        .args(args)
        .output()
        .unwrap()
        .stdout;
    let mut hash_str = String::from_utf8(hash).unwrap();
    hash_str.pop();
    let _ = replace_in_file(
        &cardano_dir
            .join("devnet/cardano-node-db.json")
            .to_string_lossy(),
        old_string,
        &hash_str,
    );
}

pub fn prepare_db_sync(cardano_dir: &Path) {
    // ByronGenesisHash
    replace_hash_for_dbsync(
        cardano_dir,
        vec![
            "byron",
            "genesis",
            "print-genesis-hash",
            "--genesis-json",
            "/devnet/genesis-byron.json",
        ],
        "xByronGenesisHash",
    );
    // ShelleyGenesisHash
    replace_hash_for_dbsync(
        cardano_dir,
        vec![
            "genesis",
            "hash",
            "--genesis",
            "/devnet/genesis-shelley.json",
        ],
        "xShelleyGenesisHash",
    );
    // AlonzoGenesisHash
    replace_hash_for_dbsync(
        cardano_dir,
        vec![
            "genesis",
            "hash",
            "--genesis",
            "/devnet/genesis-alonzo.json",
        ],
        "xAlonzoGenesisHash",
    );
    // ConwayGenesisHash
    replace_hash_for_dbsync(
        cardano_dir,
        vec![
            "genesis",
            "hash",
            "--genesis",
            "/devnet/genesis-conway.json",
        ],
        "xConwayGenesisHash",
    );

    let network_magic = 42;
    let protocol_state = Command::new("docker")
        .current_dir(cardano_dir)
        .args(vec!["compose", "exec", "cardano-node", "cardano-cli"])
        .args(vec![
            "query",
            "protocol-state",
            "--testnet-magic",
            &network_magic.to_string(),
        ])
        // .args(vec![" | ", "jq", "'.epochNonce.contents? // .epochNonce'"])
        .output()
        .unwrap()
        .stdout;
    let protocol_state_str = String::from_utf8(protocol_state).unwrap();

    let protocol_state_json: serde_json::Value = serde_json::from_str(&protocol_state_str).unwrap();
    let epoch0_nonce_str = &protocol_state_json["epochNonce"];

    let ledger_state = Command::new("docker")
        .current_dir(cardano_dir)
        .args(vec!["compose", "exec", "cardano-node", "cardano-cli"])
        .args(vec![
            "query",
            "ledger-state",
            "--testnet-magic",
            &network_magic.to_string(),
        ])
        // .args(vec![
        //     " | jq '.stateBefore.esSnapshots.pstakeMark.poolParams'",
        // ])
        .output()
        .unwrap()
        .stdout;

    let ledger_state_str = String::from_utf8(ledger_state).unwrap();
    let pool_params_json: serde_json::Value = serde_json::from_str(&ledger_state_str).unwrap();

    let pool_params_str = &pool_params_json["stateBefore"]["esSnapshots"]["pstakeMark"]["poolParams"];


    let baseinfo_dir = cardano_dir.join("baseinfo");
    if !baseinfo_dir.exists() {
        create_dir(&baseinfo_dir).unwrap();
    }
    let baseinfo_content = &format!(
        r#"{{"Epoch0Nonce": {}, "poolParams": {}}}"#,
        epoch0_nonce_str, pool_params_str
    );
    let _ = fs_extra::file::write_all(baseinfo_dir.join("info.json"), baseinfo_content);
    update_gateway_epoch_nonce(cardano_dir, epoch0_nonce_str)
}

pub fn update_gateway_epoch_nonce(cardano_dir: &Path, epoch0_nonce_str: &serde_json::Value) {
    let env_path = cardano_dir.join("../../cardano/gateway/.env.example");
    let content = fs::read_to_string(&env_path).unwrap();

    let re = Regex::new(r"CARDANO_EPOCH_NONCE_GENESIS=.*").unwrap();
    let replace_str = format!(
        r#"CARDANO_EPOCH_NONCE_GENESIS={}"#,
        epoch0_nonce_str
    );
    let result = re.replace_all(&content, replace_str).into_owned();

    let _ = fs_extra::file::write_all(&env_path, &result);
}

pub fn configure_local_cardano_devnet(cardano_dir: &Path) {
    let cardano_config_dir = cardano_dir.join("config");
    let devnet_dir = cardano_dir.join("devnet");

    let cardano_config_files = vec![
        cardano_config_dir.join("protocol-parameters.json"),
        cardano_config_dir.join("credentials"),
    ];

    // try to remove old devnet folder
    if devnet_dir.exists() {
        match fs::remove_dir_all(&devnet_dir) {
            Ok(_) => {
                println!("✅ Clear old data successfully.");
                create_dir(&devnet_dir).unwrap();
            }
            Err(e) => eprintln!(
                "❌ Failed to remove folder: {}, folder: {} .Pls remove it manually",
                e,
                devnet_dir.to_string_lossy()
            ),
        }
    }

    let copy_dir_options = fs_extra::dir::CopyOptions::new()
        .overwrite(true)
        .copy_inside(true)
        .depth(0);

    // copy devnet folder
    copy_items(
        &vec![cardano_config_dir.join("devnet")],
        &cardano_dir,
        &copy_dir_options,
    )
    .expect("Failed to copy Cardano configuration files, devnet");

    for source in cardano_config_files {
        verbose(&format!(
            "Try to copy Cardano configuration file(s) {} to {}",
            source.display(),
            cardano_dir.display()
        ));

        if source.is_dir() {
            copy_items(&vec![source], &devnet_dir, &copy_dir_options)
                .expect("Failed to copy Cardano configuration files");
        } else {
            let options = fs_extra::file::CopyOptions::new().overwrite(true);
            let destination = devnet_dir.join(source.file_name().unwrap());
            copy(source, destination, &options).expect("Failed to copy Cardano configuration file");
        }
    }

    //  + create file /devnet/topology.json: {"Producers": []}
    let _ = fs_extra::file::write_all(devnet_dir.join("topology.json"), r#"{"Producers": []}"#);

    // Update start time
    let now = Utc::now();
    let timestamp = now.timestamp();
    let formatted_time = now.to_rfc3339_opts(SecondsFormat::Secs, true);

    let _ = replace_in_file(
        &devnet_dir.join("genesis-byron.json").to_string_lossy(),
        r#""startTime": 1657186415"#,
        &format!(r#""startTime": {}"#, timestamp),
    );
    let _ = replace_in_file(
        &devnet_dir.join("genesis-shelley.json").to_string_lossy(),
        r#""systemStart": "2022-07-07T09:33:35Z""#,
        &format!(r#""systemStart": "{}""#, formatted_time),
    );

    //  + mkdir "/devnet/ipc"
    let _ = fs::create_dir(devnet_dir.join("ipc"));
    //  + create file /devnet/node.socket
    let _ = fs::File::create(devnet_dir.join("node.socket"));
    //  + chmod /devnet => 400
    let _ = fs::set_permissions(
        devnet_dir.join("vrf.skey"),
        fs::Permissions::from_mode(0o400),
    );
}

fn replace_in_file(file_path: &str, old_string: &str, new_string: &str) -> io::Result<()> {
    // Read the file content
    let content = fs::read_to_string(file_path)?;

    // Replace the old string with the new string
    let new_content = content.replace(old_string, new_string);

    // Write the modified content back to the file
    let mut file = File::create(file_path)?;
    file.write_all(new_content.as_bytes())?;

    Ok(())
}
