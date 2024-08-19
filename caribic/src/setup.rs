use crate::utils::{delete_dir, delete_file, download_file, unzip_file, IndicatorMessage};
use console::style;
use std::io::{self, Write};
use std::{path::Path, process::Command};

pub async fn install_osmosisd() {
    let question = "Do you want to install osmosisd? (yes/no): ";

    print!("{}", question);
    io::stdout().flush().unwrap();

    let mut input = String::new();
    io::stdin()
        .read_line(&mut input)
        .expect("Failed to read input");

    let input = input.trim().to_lowercase();

    if input == "yes" || input == "y" {
        let url = "https://github.com/osmosis-labs/osmosis/archive/refs/tags/v25.2.0.zip";
        let dest = Path::new("osmosis.zip");
        download_file(
            url,
            dest,
            Some(IndicatorMessage {
                message: "Downloading osmosis source code".to_string(),
                step: "Step 1/3".to_string(),
                emoji: "📥 ".to_string(),
            }),
        )
        .await
        .expect("Failed to download osmosis source code");

        println!(
            "{} 📦 Extracting osmosis source code...",
            style("Step 2/3").bold().dim()
        );

        unzip_file(dest, Path::new("osmosis")).expect("Failed to unzip osmosis source code");
        delete_file(dest).expect("Failed to cleanup osmosis.zip");

        println!(
            "{} 🛠️ Installing osmosisd...",
            style("Step 3/3").bold().dim()
        );

        Command::new("make")
            .current_dir("osmosis")
            .arg("install")
            .output()
            .expect("Failed to install osmosisd");

        println!("✅ osmosisd installed successfully");
        delete_dir(Path::new("osmosis")).expect("Failed to cleanup osmosis source folder");
    }
}
