use crate::check::check_osmosisd;
use crate::logger::verbose;
use crate::setup::{configure_local_cardano_devnet, copy_cardano_env_file};
use crate::utils::{execute_script, execute_script_with_progress, wait_for_health_check};
use crate::{
    config,
    logger::{self, error, log},
};
use console::style;
use dirs::home_dir;
use fs_extra::file::copy;
use fs_extra::{copy_items, remove_items};
use serde_json::Value;
use std::path::Path;

pub fn start_local_cardano_network(project_root_path: &Path) {
    /*execute_script_with_progress(
        cardano_dir.join("scripts/").as_path(),
        "sh",
        Vec::from(["start.sh"]),
        "Initialize local Cardano network",
        "✅ Local Cardano network initialized",
        "❌ Failed to initialize localnet",
    );*/
    log(&format!(
        "{} 🛠️ Configuring local Cardano devnet",
        style("Step 1/5").bold().dim(),
    ));
    configure_local_cardano_devnet(project_root_path.join("chains/cardano").as_path());
    log(&format!(
        "{} 📝 Copying Cardano environment file",
        style("Step 2/5").bold().dim(),
    ));
    copy_cardano_env_file(project_root_path.join("cardano").as_path());
    log(&format!(
        "{} 🛠️ Building Aiken validators",
        style("Step 3/5").bold().dim()
    ));
    let _ = execute_script(
        project_root_path.join("cardano").as_path(),
        "aiken",
        Vec::from(["build", "--trace-level", "verbose"]),
    );
    log(&format!(
        "{} 🤖 Generating validator off-chain types",
        style("Step 4/5").bold().dim(),
    ));
    let _ = execute_script(
        project_root_path.join("cardano").as_path(),
        "deno",
        Vec::from(["run", "-A", "./aiken-to-lucid/src/main.ts"]),
    );
    log(&format!(
        "{} 🚀 Starting Cardano services",
        style("Step 5/5").bold().dim(),
    ));
    start_local_cardano_services(project_root_path.join("chains/cardano").as_path());
}

pub async fn start_cosmos_sidechain(cosmos_dir: &Path) {
    let _ = execute_script(cosmos_dir, "docker", Vec::from(["compose", "stop"]));
    let _ = execute_script(
        cosmos_dir,
        "docker",
        Vec::from(["compose", "up", "-d", "--build"]),
    );
    log("Waiting for the Cosmos sidechain to start...");
    // TODO: make the url configurable
    let is_healthy = wait_for_health_check("http://127.0.0.1:26657/", 10, 1000).await;
    if is_healthy.is_ok() {
        log("✅ Cosmos sidechain started successfully");
    } else {
        error("❌ Failed to start Cosmos sidechain");
    }
}

pub fn start_local_cardano_services(cardano_dir: &Path) {
    let configuration = config::get_config();

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
    let _ = execute_script(cardano_dir, "docker", script_stop_args);

    let mut script_start_args = vec!["compose", "up", "-d"];
    script_start_args.append(&mut services);
    let _ = execute_script(cardano_dir, "docker", script_start_args);
}

pub async fn start_osmosis(osmosis_dir: &Path) {
    check_osmosisd(osmosis_dir).await;
    match copy_osmosis_config_files(osmosis_dir) {
        Ok(_) => {
            log("✅ Osmosis configuration files copied successfully");
            remove_previous_chain_data()
                .expect("Failed to remove previous chain data from ~/.osmosisd-local");
            init_local_network(osmosis_dir);
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
            );

            if status.is_ok() {
                // TODD: make the url and port configurable
                let is_healthy = wait_for_health_check("http://127.0.0.1:26658/", 10, 1000).await;
                if is_healthy.is_ok() {
                    log("✅ Local Osmosis network started successfully");
                } else {
                    error("❌ Failed to start local Osmosis network");
                }
            } else {
                error("❌ Failed to start local Osmosis network");
            }
        }
        Err(e) => {
            error(&format!(
                "❌ Failed to copy Osmosis configuration files: {}",
                e
            ));
        }
    }
}

pub fn configure_hermes(osmosis_dir: &Path) {
    let script_dir = osmosis_dir.join("scripts");
    if let Some(home_path) = home_dir() {
        let hermes_dir = home_path.join(".hermes");
        let options = fs_extra::file::CopyOptions::new().overwrite(true);
        verbose(&format!(
            "Copying Hermes configuration files from {} to {}",
            script_dir.display(),
            hermes_dir.display()
        ));
        copy(
            script_dir.join("hermes/config.toml"),
            hermes_dir.join("config.toml"),
            &options,
        )
        .expect("Failed to copy Hermes configuration file");
    }

    /*
    hermes keys add --chain sidechain --mnemonic-file ${script_dir}/hermes/cosmos
    hermes keys add --chain localosmosis --mnemonic-file ${script_dir}/hermes/osmosis

    # Create osmosis client
    hermes create client --host-chain localosmosis --reference-chain sidechain
    localosmosis_client_id=$(hermes --json query clients --host-chain localosmosis | jq -r 'select(.result) | .result[-1].client_id')

    # Create sidechain client
    hermes create client --host-chain sidechain --reference-chain localosmosis --trusting-period 86000s
    sidechain_client_id=$(hermes --json query clients --host-chain sidechain | jq -r 'select(.result) | .result[-1].client_id')

    # Create connection
    hermes create connection --a-chain sidechain --a-client $sidechain_client_id --b-client $localosmosis_client_id
    connectionId=$(hermes --json query connections --chain sidechain | jq -r 'select(.result) | .result[-2]')

    # Create channel
    hermes create channel --a-chain sidechain --a-connection $connectionId --a-port transfer --b-port transfer
    channel_id=$(hermes --json query channels --chain localosmosis | jq -r 'select(.result) | .result[-1].channel_id')
    */

    let _ = execute_script(
        script_dir.as_path(),
        "hermes",
        Vec::from([
            "keys",
            "add",
            "--chain",
            "sidechain",
            "--mnemonic-file",
            osmosis_dir.join("scripts/hermes/cosmos").to_str().unwrap(),
        ]),
    );

    let _ = execute_script(
        script_dir.as_path(),
        "hermes",
        Vec::from([
            "keys",
            "add",
            "--chain",
            "localosmosis",
            "--mnemonic-file",
            osmosis_dir.join("scripts/hermes/osmosis").to_str().unwrap(),
        ]),
    );

    let _ = execute_script(
        script_dir.as_path(),
        "hermes",
        Vec::from([
            "create",
            "client",
            "--host-chain",
            "localosmosis",
            "--reference-chain",
            "sidechain",
        ]),
    );

    let query_clients_output = execute_script(
        script_dir.as_path(),
        "hermes",
        Vec::from(["--json", "query", "clients", "--host-chain", "localosmosis"]),
    )
    .unwrap();

    verbose(&format!("query_clients_output: {}", query_clients_output));

    let query_clients_json: Value =
        serde_json::from_str(query_clients_output.as_str()).expect("Failed to parse query clients");

    if let Some(client_id) = query_clients_json["result"]
        .as_array()
        .and_then(|result| result.last())
        .and_then(|last_result| last_result["client_id"].as_str())
    {
        println!("localosmosis_client_id: {}", client_id);
    } else {
        println!("Could not find the client_id");
    }
}

fn init_local_network(osmosis_dir: &Path) {
    if logger::is_quite() {
        let _ = execute_script(osmosis_dir, "make", Vec::from(["localnet-init"]));
    } else {
        execute_script_with_progress(
            osmosis_dir,
            "make",
            Vec::from(["localnet-init"]),
            "Initialize local Osmosis network",
            "✅ Local Osmosis network initialized",
            "❌ Failed to initialize localnet",
        );
    }
}

fn remove_previous_chain_data() -> Result<(), fs_extra::error::Error> {
    if let Some(home_path) = home_dir() {
        let osmosis_data_dir = home_path.join(".osmosisd-local");
        if osmosis_data_dir.exists() {
            remove_items(&vec![osmosis_data_dir])?;
            Ok(())
        } else {
            Ok(())
        }
    } else {
        Ok(())
    }
}

fn copy_osmosis_config_files(osmosis_dir: &Path) -> Result<(), fs_extra::error::Error> {
    copy_items(
        &vec![osmosis_dir.join("../configuration/cosmwasm/wasm")],
        osmosis_dir.join("cosmwasm"),
        &fs_extra::dir::CopyOptions::new().overwrite(true),
    )?;

    copy_items(
        &vec![osmosis_dir.join("../configuration/hermes")],
        osmosis_dir.join("scripts"),
        &fs_extra::dir::CopyOptions::new().overwrite(true),
    )?;

    let options = fs_extra::file::CopyOptions::new().overwrite(true);

    copy(
        osmosis_dir.join("../scripts/start.sh"),
        osmosis_dir.join("scripts/start.sh"),
        &options,
    )?;

    copy(
        osmosis_dir.join("../scripts/stop.sh"),
        osmosis_dir.join("scripts/stop.sh"),
        &options,
    )?;

    copy(
        osmosis_dir.join("../scripts/setup_crosschain_swaps.sh"),
        osmosis_dir.join("scripts/setup_crosschain_swaps.sh"),
        &options,
    )?;

    copy(
        osmosis_dir.join("../scripts/setup_osmosis_local.sh"),
        osmosis_dir.join("tests/localosmosis/scripts/setup.sh"),
        &options,
    )?;

    copy(
        osmosis_dir.join("../configuration/docker-compose.yml"),
        osmosis_dir.join("tests/localosmosis/docker-compose.yml"),
        &options,
    )?;

    copy(
        osmosis_dir.join("../configuration/Dockerfile"),
        osmosis_dir.join("Dockerfile"),
        &options,
    )?;

    Ok(())
}
