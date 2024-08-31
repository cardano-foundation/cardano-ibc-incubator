use crate::check::check_osmosisd;
use crate::logger::{verbose, warn};
use crate::setup::{configure_local_cardano_devnet, copy_cardano_env_file, prepare_db_sync};
use crate::utils::{
    execute_script, execute_script_with_progress, wait_for_health_check, wait_until_file_exists,
};
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

pub fn start_relayer(relayer_path: &Path) -> Result<(), Box<dyn std::error::Error>> {
    let options = fs_extra::file::CopyOptions::new().overwrite(true);
    copy(
        relayer_path.join(".env.example"),
        relayer_path.join(".env"),
        &options,
    )?;
    execute_script(relayer_path, "docker", Vec::from(["compose", "stop"]))?;

    execute_script_with_progress(
        relayer_path,
        "docker",
        Vec::from(["compose", "up", "-d", "--build"]),
        "⚡ Starting relayer...",
        "✅ Relayer started successfully",
        "❌ Failed to start relayer",
    );
    Ok(())
}

pub fn start_local_cardano_network(project_root_path: &Path) {
    log(&format!(
        "{} 🛠️ Configuring local Cardano devnet",
        style("Step 1/6").bold().dim(),
    ));
    configure_local_cardano_devnet(project_root_path.join("chains/cardano").as_path());

    log(&format!(
        "{} 🚀 Starting Cardano services: cardano-node postgres kupo cardano-node-ogmios",
        style("Step 2/6").bold().dim(),
    ));

    start_local_cardano_services(
        project_root_path.join("chains/cardano").as_path(),
        vec!["cardano-node", "postgres", "kupo", "cardano-node-ogmios"],
    );

    // prepare db sync
    log(&format!(
        "{} 🛠️ Configuring and start local Cardano DB-Sync",
        style("Step 3/6").bold().dim(),
    ));
    prepare_db_sync(project_root_path.join("chains/cardano").as_path());

    start_local_cardano_services(
        project_root_path.join("chains/cardano").as_path(),
        vec!["cardano-db-sync"],
    );

    log(&format!(
        "{} 📝 Copying Cardano environment file",
        style("Step 4/6").bold().dim(),
    ));
    copy_cardano_env_file(project_root_path.join("cardano").as_path());

    log(&format!(
        "{} 🛠️ Building Aiken validators",
        style("Step 5/6").bold().dim()
    ));
    let _ = execute_script(
        project_root_path.join("cardano").as_path(),
        "aiken",
        Vec::from(["build", "--trace-level", "verbose"]),
    );
    log(&format!(
        "{} 🤖 Generating validator off-chain types",
        style("Step 6/6").bold().dim(),
    ));
    let _ = execute_script(
        project_root_path.join("cardano").as_path(),
        "deno",
        Vec::from(["run", "-A", "./aiken-to-lucid/src/main.ts"]),
    );

    log("🕦 Waiting for the Cardano services to start ...");
    let handler_json_exists = wait_until_file_exists(
        project_root_path
            .join("cardano/deployments/handler.json")
            .as_path(),
        20,
        2000,
        || {
            let _ = execute_script(
                project_root_path.join("cardano").as_path(),
                "deno",
                Vec::from(["run", "-A", "--unstable", "src/deploy.ts"]),
            );
        },
    );
    if handler_json_exists.is_ok() {
        log("✅ Cardano services started successfully");
        let options = fs_extra::file::CopyOptions::new().overwrite(true);
        let _ = copy(
            project_root_path.join("cardano/deployments/handler.json"),
            project_root_path.join("cardano/gateway/src/deployment/handler.json"),
            &options,
        );
        let _ = copy(
            project_root_path.join("cardano/deployments/handler.json"),
            project_root_path.join("relayer/examples/demo/configs/chains/chain_handler.json"),
            &options,
        );
    } else {
        error("❌ Failed to start Cardano services. The handler.json file should have been created, but it doesn't exist. Consider running the start command again using --verbose 5.");
    }
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

pub fn start_local_cardano_services(cardano_dir: &Path, services: Vec<&str>) {
    let configuration = config::get_config();

    let mut this_services = vec![];
    if services.len() == 0 {
        if configuration.services.cardano_node {
            this_services.push("cardano-node");
        }
        if configuration.services.postgres {
            this_services.push("postgres");
        }
        if configuration.services.kupo {
            this_services.push("kupo");
        }
        if configuration.services.ogmios {
            this_services.push("cardano-node-ogmios");
        }
    } else {
        this_services = services.clone()
    }

    let mut script_stop_args = vec!["compose", "down"];
    script_stop_args.append(&mut this_services.clone());
    let _ = execute_script(cardano_dir, "docker", script_stop_args);

    let mut script_start_args = vec!["compose", "up", "-d"];
    script_start_args.append(&mut this_services);
    let _ = execute_script(cardano_dir, "docker", script_start_args);
}

pub async fn start_osmosis(osmosis_dir: &Path) {
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

pub async fn prepare_osmosis(osmosis_dir: &Path) {
    check_osmosisd(osmosis_dir).await;
    match copy_osmosis_config_files(osmosis_dir) {
        Ok(_) => {
            log("✅ Osmosis configuration files copied successfully");
            remove_previous_chain_data()
                .expect("Failed to remove previous chain data from ~/.osmosisd-local");
            init_local_network(osmosis_dir);
        }
        Err(e) => {
            error(&format!(
                "❌ Failed to copy Osmosis configuration files: {}",
                e
            ));
        }
    }
}

pub fn configure_hermes(osmosis_dir: &Path) -> Result<(), Box<dyn std::error::Error>> {
    let script_dir = osmosis_dir.join("scripts");
    if let Some(home_path) = home_dir() {
        let hermes_dir = home_path.join(".hermes");
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
            "--chain",
            "sidechain",
            "--mnemonic-file",
            osmosis_dir.join("scripts/hermes/cosmos").to_str().unwrap(),
        ]),
    )?;

    execute_script(
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
    )?;

    // Create osmosis client
    execute_script(
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
    )?;

    let query_clients_output = execute_script(
        script_dir.as_path(),
        "hermes",
        Vec::from(["--json", "query", "clients", "--host-chain", "localosmosis"]),
    )?;

    verbose(&format!("query_clients_output: {}", query_clients_output));

    let query_clients_json: Value = serde_json::from_str(query_clients_output.as_str())?;

    if let Some(client_id) = query_clients_json["result"]
        .as_array()
        .and_then(|result| result.last())
        .and_then(|last_result| last_result["client_id"].as_str())
    {
        verbose(&format!("localosmosis_client_id: {}", client_id));

        // Create sidechain client
        execute_script(
            script_dir.as_path(),
            "hermes",
            Vec::from([
                "create",
                "client",
                "--host-chain",
                "sidechain",
                "--reference-chain",
                "localosmosis",
                "--trusting-period",
                "86000s",
            ]),
        )?;

        let query_clients_output = execute_script(
            script_dir.as_path(),
            "hermes",
            Vec::from(["--json", "query", "clients", "--host-chain", "sidechain"]),
        );

        let query_clients_json: Value =
            serde_json::from_str(query_clients_output.unwrap().as_str())?;

        if let Some(sidechain_client_id) = query_clients_json["result"]
            .as_array()
            .and_then(|result| result.last())
            .and_then(|last_result| last_result["client_id"].as_str())
        {
            verbose(&format!("sidechain_client_id: {}", sidechain_client_id));

            // Create connection
            execute_script(
                script_dir.as_path(),
                "hermes",
                Vec::from([
                    "create",
                    "connection",
                    "--a-chain",
                    "sidechain",
                    "--a-client",
                    sidechain_client_id,
                    "--b-client",
                    client_id,
                ]),
            )?;

            let query_connections_output = execute_script(
                script_dir.as_path(),
                "hermes",
                Vec::from(["--json", "query", "connections", "--chain", "sidechain"]),
            );

            let query_connections_json: Value =
                serde_json::from_str(query_connections_output.unwrap().as_str())?;

            if let Some(connection_id) =
                query_connections_json["result"]
                    .as_array()
                    .and_then(|result| {
                        result
                            .iter()
                            .filter_map(|result| result["connection_id"].as_str())
                            .last()
                    })
            {
                verbose(&format!("connection_id: {}", connection_id));

                // Create channel
                execute_script(
                    script_dir.as_path(),
                    "hermes",
                    Vec::from([
                        "create",
                        "channel",
                        "--a-chain",
                        "sidechain",
                        "--a-connection",
                        connection_id,
                        "--a-port",
                        "transfer",
                        "--b-port",
                        "transfer",
                    ]),
                )?;

                let query_channels_output = execute_script(
                    script_dir.as_path(),
                    "hermes",
                    Vec::from(["--json", "query", "channels", "--chain", "localosmosis"]),
                );

                let query_channels_json: Value =
                    serde_json::from_str(query_channels_output.unwrap().as_str())?;

                if let Some(channel_id) = query_channels_json["result"]
                    .as_array()
                    .and_then(|result| result.last())
                    .and_then(|last_result| last_result["channel_id"].as_str())
                {
                    verbose(&format!("channel_id: {}", channel_id));
                } else {
                    warn("Failed to get channel_id");
                }
            } else {
                warn("Failed to get connection_id");
            }
        } else {
            warn("Failed to get sidechain client_id");
        }
    } else {
        warn("Failed to get localosmosis client_id");
    }
    Ok(())
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
        "Copying start.sh from {} to {}",
        osmosis_dir.join("../scripts/start.sh").display(),
        osmosis_dir.join("scripts/start.sh").display()
    ));
    copy(
        osmosis_dir.join("../scripts/start.sh"),
        osmosis_dir.join("scripts/start.sh"),
        &options,
    )?;

    verbose(&format!(
        "Copying stop.sh from {} to {}",
        osmosis_dir.join("../scripts/stop.sh").display(),
        osmosis_dir.join("scripts/stop.sh").display()
    ));
    copy(
        osmosis_dir.join("../scripts/stop.sh"),
        osmosis_dir.join("scripts/stop.sh"),
        &options,
    )?;

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
