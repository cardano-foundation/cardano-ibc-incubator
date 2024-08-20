use crate::check::check_osmosisd;
use dirs::home_dir;
use fs_extra::{copy_items, remove_items};
use indicatif::{ProgressBar, ProgressStyle};
use std::collections::VecDeque;
use std::fs::copy;
use std::io::{BufRead, BufReader};
use std::path::Path;
use std::process::{Command, Stdio};
use std::time::Duration;

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
    let progress_bar = ProgressBar::new_spinner();
    progress_bar.enable_steady_tick(Duration::from_millis(100));
    progress_bar.set_style(
        ProgressStyle::default_spinner()
            .tick_strings(&["-", "\\", "|", "/"])
            .template("{spinner:.green} Initialize local Osmosis network\n{wide_msg}")
            .unwrap(),
    );

    let mut command = Command::new("make")
        .current_dir(osmosis_dir)
        .arg("localnet-init")
        .stdout(Stdio::piped())
        .spawn()
        .expect("Failed to initialize localnet");

    let mut last_lines = VecDeque::with_capacity(5);

    if let Some(stdout) = command.stdout.take() {
        let reader = BufReader::new(stdout);

        for line in reader.lines() {
            let line = line.unwrap_or_else(|_| "Failed to read line".to_string());
            if last_lines.len() == 5 {
                last_lines.pop_front();
            }
            last_lines.push_back(line);
            let output = last_lines
                .iter()
                .cloned()
                .collect::<Vec<String>>()
                .join("\n");

            progress_bar.set_message(format!("{}", output));
        }
    }

    let status = command.wait().expect("Command wasn't running");
    progress_bar.finish_with_message("✅ Local Osmosis network initialized");

    if !status.success() {
        eprintln!("❌ Failed to initialize localnet");
        std::process::exit(1);
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
