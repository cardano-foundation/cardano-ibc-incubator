use crate::check::check_osmosisd;
use crate::utils::execute_script_with_progress;
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
    start_local_cardano_services(project_root_path.join("chains/cardano").as_path());
}

pub fn start_local_cardano_services(cardano_dir: &Path) {
    Command::new("docker")
        .current_dir(cardano_dir)
        .arg("compose")
        .arg("stop")
        .arg("cardano-node")
        .arg("postgres")
        .arg("kupo")
        .arg("cardano-node-ogmios")
        .status()
        .expect("Failed to stop local Cardano services");
    Command::new("docker")
        .current_dir(cardano_dir)
        .arg("compose")
        .arg("up")
        .arg("-d")
        .arg("cardano-node")
        .arg("postgres")
        .arg("kupo")
        .arg("cardano-node-ogmios")
        .status()
        .expect("Failed to start local Cardano services");
}

pub async fn start_osmosis(osmosis_dir: &Path) {
    check_osmosisd(osmosis_dir).await;
    match copy_osmosis_config_files(osmosis_dir) {
        Ok(_) => {
            println!("✅ Osmosis configuration files copied successfully");
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
                        println!("✅ Osmosis started successfully");
                    } else {
                        println!("❌ Failed to start Osmosis");
                    }
                }
                Err(e) => {
                    println!("❌ Failed to start Osmosis: {}", e);
                }
            }
        }
        Err(e) => {
            println!("❌ Failed to copy Osmosis configuration files: {}", e);
        }
    }
}

fn init_local_network(osmosis_dir: &Path) {
    execute_script_with_progress(
        osmosis_dir,
        "make",
        Vec::from(["localnet-init"]),
        "Initialize local Osmosis network",
        "✅ Local Osmosis network initialized",
        "❌ Failed to initialize localnet",
    );
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
