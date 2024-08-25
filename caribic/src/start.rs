use crate::check::check_osmosisd;
use crate::setup::{configure_local_cardano_devnet, copy_cardano_env_file};
use crate::utils::{execute_script, execute_script_with_progress};
use crate::{
    config,
    logger::{self, error, log},
};
use console::style;
use dirs::home_dir;
use fs_extra::{copy_items, remove_items};
use std::fs::copy;
use std::path::Path;
use std::process::Command;

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
            let scripts_dir = osmosis_dir.join("scripts");
            let status = Command::new("bash")
                .arg(scripts_dir.join("start.sh"))
                .status();
            match status {
                Ok(status) => {
                    if status.success() {
                        log("✅ Osmosis started successfully");
                    } else {
                        error(&format!("❌ Failed to start Osmosis"));
                    }
                }
                Err(e) => {
                    error(&format!("❌ Failed to start Osmosis: {}", e));
                }
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

    copy(
        osmosis_dir.join("../scripts/start.sh"),
        osmosis_dir.join("scripts/start.sh"),
    )?;

    copy(
        osmosis_dir.join("../scripts/stop.sh"),
        osmosis_dir.join("scripts/stop.sh"),
    )?;

    copy(
        osmosis_dir.join("../scripts/setup_crosschain_swaps.sh"),
        osmosis_dir.join("scripts/setup_crosschain_swaps.sh"),
    )?;

    copy(
        osmosis_dir.join("../scripts/setup_osmosis_local.sh"),
        osmosis_dir.join("tests/localosmosis/scripts/setup.sh"),
    )?;

    copy(
        osmosis_dir.join("../configuration/docker-compose.yml"),
        osmosis_dir.join("tests/localosmosis/docker-compose.yml"),
    )?;

    copy(
        osmosis_dir.join("../configuration/Dockerfile"),
        osmosis_dir.join("Dockerfile"),
    )?;

    Ok(())
}
