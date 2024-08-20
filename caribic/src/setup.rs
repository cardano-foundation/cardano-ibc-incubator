use crate::utils::{delete_file, download_file, unzip_file, IndicatorMessage};
use console::style;
use std::io::{self, Write};
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
