use crate::logger::{
    self, verbose,
    Verbosity::{Info, Standard, Verbose},
};
use console::style;
use dirs::home_dir;
use indicatif::{ProgressBar, ProgressStyle};
use regex::Regex;
use reqwest::Client;
use serde_json::Value;
use std::{collections::HashMap, fs};
use std::fs::File;
use std::fs::Permissions;
use std::io::BufRead;
use std::io::{self, BufReader, Write};
#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::Duration;
use std::{collections::VecDeque, thread};
use std::{error::Error, process::Output};
use tokio::io::AsyncWriteExt;
use zip::read::ZipArchive;

pub fn print_header() {
    println!(
        r#"
 ________  ________  ________  ___  ________  ___  ________     
|\   ____\|\   __  \|\   __  \|\  \|\   __  \|\  \|\   ____\    
\ \  \___|\ \  \|\  \ \  \|\  \ \  \ \  \|\ /\ \  \ \  \___|    
 \ \  \    \ \   __  \ \   _  _\ \  \ \   __  \ \  \ \  \       
  \ \  \____\ \  \ \  \ \  \\  \\ \  \ \  \|\  \ \  \ \  \____   Cardano IBC
   \ \_______\ \__\ \__\ \__\\ _\\ \__\ \_______\ \__\ \_______\ Sidechain CLI
    \|_______|\|__|\|__|\|__|\|__|\|__|\|_______|\|__|\|_______| v0.1.0
    "#
    );
}

pub struct IndicatorMessage {
    pub message: String,
    pub step: String,
    pub emoji: String,
}

pub fn default_config_path() -> PathBuf {
    let mut config_path = home_dir().unwrap_or_else(|| PathBuf::from("~"));
    config_path.push(".caribic");
    config_path.push("config.json");
    config_path
}

pub fn get_cardano_tip_state(
    project_root_dir: &Path,
) -> Result<String, Box<dyn std::error::Error>> {
    let mut command = Command::new("docker");
    let query_output = command
        .current_dir(&project_root_dir.join("chains/cardano"))
        .args(&[
            "compose",
            "exec",
            "cardano-node",
            "cardano-cli",
            "query",
            "tip",
            "--cardano-mode",
            "--testnet-magic",
            "42",
        ]);

    let output = query_output.output().map_err(|error| {
        format!(
            "Failed to query tip from cardano-node: {}",
            error.to_string()
        )
    })?;

    if output.status.success() {
        verbose(&format!(
            "Querying tip from cardano-node: {}",
            String::from_utf8_lossy(&output.stdout)
        ));
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        Err(format!(
            "Failed to query tip from cardano-node: {}",
            String::from_utf8_lossy(&output.stderr)
        )
        .into())
    }
}

pub enum CardanoQuery {
    Epoch,
    Slot,
    SlotInEpoch,
    SlotsToEpochEnd,
}

impl CardanoQuery {
    fn as_str(&self) -> &'static str {
        match self {
            CardanoQuery::Epoch => "epoch",
            CardanoQuery::Slot => "slot",
            CardanoQuery::SlotInEpoch => "slotInEpoch",
            CardanoQuery::SlotsToEpochEnd => "slotsToEpochEnd",
        }
    }
}

pub fn get_cardano_state(
    project_root_dir: &Path,
    query: CardanoQuery,
) -> Result<u64, Box<dyn std::error::Error>> {
    let cardano_tip_state = get_cardano_tip_state(project_root_dir)?;
    let cardano_tip_json: Value = serde_json::from_str(&cardano_tip_state)?;
    let epoch_json = cardano_tip_json.get(query.as_str());
    if let Some(epoch) = epoch_json {
        if epoch.is_i64() {
            return Ok(epoch.as_i64().unwrap() as u64);
        } else {
            return Err(format!(
                "Failed to parse {} from cardano-node: {}",
                query.as_str(),
                cardano_tip_state
            )
            .into());
        }
    } else {
        return Err(format!(
            "Failed to extract {} from cardano-node: {}",
            query.as_str(),
            cardano_tip_state
        )
        .into());
    }
}

pub fn replace_text_in_file(path: &Path, pattern: &str, replacement: &str) -> io::Result<()> {
    let content = fs::read_to_string(path)?;
    let re = Regex::new(pattern).unwrap();
    let new_content = re.replace(&content, replacement).to_string();
    let mut file = fs::File::create(path)?;
    file.write_all(new_content.as_bytes())?;

    Ok(())
}

pub fn change_dir_permissions_read_only(
    dir: &Path,
    exclude_files: &Vec<&str>,
) -> std::io::Result<()> {
    if dir.is_dir() {
        for entry in fs::read_dir(dir)? {
            let entry = entry?;
            let path = entry.path();

            if path.is_dir() {
                change_dir_permissions_read_only(&path, &exclude_files)?;
            } else if path.is_file()
                && !exclude_files.contains(&path.file_name().unwrap().to_str().unwrap())
            {
                verbose(&format!(
                    "Set permissions to read-only for file: {}",
                    path.display()
                ));
                set_read_only(&path)?;
            }
        }
    }
    Ok(())
}

#[cfg(unix)]
fn set_read_only(path: &Path) -> std::io::Result<()> {
    let permissions = Permissions::from_mode(0o400);
    fs::set_permissions(path, permissions)
}

#[cfg(windows)]
fn set_read_only(path: &Path) -> std::io::Result<()> {
    let mut permissions = fs::metadata(path)?.permissions();
    permissions.set_readonly(true);
    fs::set_permissions(path, permissions)
}

pub fn wait_until_file_exists(
    file_path: &Path,
    retries: u32,
    interval: u64,
    retry_command: impl Fn() -> (),
) -> Result<(), String> {
    let mut file_exists = file_path.exists();
    for _ in 0..retries {
        if file_exists {
            return Ok(());
        }
        retry_command();

        thread::sleep(Duration::from_millis(interval));
        file_exists = file_path.exists();
    }
    Err(format!("File {} does not exist", file_path.display()))
}

pub async fn download_file(
    url: &str,
    path: &Path,
    indicator_message: Option<IndicatorMessage>,
) -> Result<(), Box<dyn Error>> {
    let mut response = reqwest::get(url).await?.error_for_status()?;

    let total_size = response.content_length();
    let mut fallback_message = String::from("Downloading ...");

    if let Some(indicator_message) = indicator_message {
        println!(
            "{} {}{}",
            style(indicator_message.step).bold().dim(),
            indicator_message.emoji,
            indicator_message.message
        );
        fallback_message = indicator_message.message;
    }

    let progress_bar = match total_size {
        Some(size) => ProgressBar::new(size),
        None => ProgressBar::new_spinner().with_message(fallback_message),
    };

    let mut file = tokio::fs::File::create(path).await?;
    while let Some(chunk) = response.chunk().await? {
        file.write_all(&chunk).await?;
        progress_bar.inc(chunk.len() as u64);
    }

    progress_bar.finish_with_message(format!("Downloaded {} to {}", url, path.to_string_lossy()));
    return Ok(());
}

pub fn delete_file(file_path: &Path) -> io::Result<()> {
    fs::remove_file(file_path)
}

pub async fn wait_for_health_check(
    url: &str,
    retries: u32,
    interval: u64,
    custom_condition: Option<impl Fn(&String) -> bool>,
) -> Result<(), String> {
    let client = Client::new();

    for retry in 0..retries {
        let response = client.get(url).send().await;

        match response {
            Ok(resp) if resp.status().is_success() => match custom_condition {
                Some(ref condition) => {
                    let body = resp.text().await.unwrap_or_default();
                    if condition(&body) {
                        verbose(&format!(
                            "Health on {} check passed on retry {}",
                            url,
                            retry + 1
                        ));
                        return Ok(());
                    }
                }
                None => {
                    verbose(&format!(
                        "Health on {} check passed on retry {}",
                        url,
                        retry + 1
                    ));
                    return Ok(());
                }
            },
            Ok(resp) => {
                verbose(&format!(
                    "Health check {} failed with status: {} on retry {}",
                    url,
                    resp.status(),
                    retry + 1
                ));
            }
            Err(e) => {
                verbose(&format!(
                    "Failed to send request to {} on retry {}: {}",
                    url,
                    retry + 1,
                    e
                ));
            }
        }

        thread::sleep(Duration::from_millis(interval));
    }

    return Err(format!(
        "Health check on {} failed after {} attempts",
        url, retries
    ));
}

pub fn execute_script(
    script_dir: &Path,
    script_name: &str,
    script_args: Vec<&str>,
    script_env: Option<Vec<(&str, &str)>>,
) -> io::Result<String> {
    logger::verbose(&format!(
        "{} {} {}",
        script_dir.display(),
        script_name,
        script_args.join(" ")
    ));
    let envs = script_env.unwrap_or_default();

    let mut cmd = Command::new(script_name)
        .current_dir(script_dir)
        .args(script_args)
        .envs(envs)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?;

    let stdout = cmd.stdout.take().expect("Failed to capture stdout");
    let stderr = cmd.stderr.take().expect("Failed to capture stderr");

    let stdout_reader = io::BufReader::new(stdout);
    let stderr_reader = io::BufReader::new(stderr);

    let mut output = String::new();
    for line in stdout_reader.lines() {
        let line = line?;
        output.push_str(&line);
        logger::info(&line);
    }

    for line in stderr_reader.lines() {
        let line = line?;
        logger::info(&line);
    }

    let status = cmd.wait()?;
    logger::info(&format!("Script exited with status: {}", status));
    Ok(output)
}

pub fn execute_script_with_progress(
    script_dir: &Path,
    script_name: &str,
    script_args: Vec<&str>,
    start_message: &str,
) -> Result<(), Box<dyn std::error::Error>> {
    let progress_bar = ProgressBar::new_spinner();
    progress_bar.enable_steady_tick(Duration::from_millis(100));
    progress_bar.set_style(
        ProgressStyle::with_template("{prefix:.bold} {spinner} {wide_msg}")
            .unwrap()
            .tick_chars("⠁⠂⠄⡀⢀⠠⠐⠈ "),
    );

    progress_bar.set_prefix(start_message.to_owned());

    let mut command = Command::new(script_name)
        .current_dir(script_dir)
        .args(script_args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("Failed to initialize localnet: {}", error))?;

    match logger::get_verbosity() {
        Verbose => {
            let stdout = command.stdout.as_mut().expect("Failed to open stdout");
            let reader = BufReader::new(stdout);

            for line in reader.lines() {
                let line = line.unwrap_or_else(|_| "Failed to read line".to_string());
                progress_bar.set_message(format!("{}", line.trim()));
            }
        }
        Info => {
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
        }
        Standard => {
            if let Some(stdout) = command.stdout.take() {
                let reader = BufReader::new(stdout);

                for line in reader.lines() {
                    let last_line = line.unwrap_or_else(|_| "Failed to read line".to_string());
                    progress_bar.set_message(format!("{}", last_line.trim()));
                }
            }
        }
        _ => {}
    }

    let status = command
        .wait()
        .map_err(|error| format!("Command wasn't running: {}", error))?;
    progress_bar.finish_and_clear();
    if status.success() {
        Ok(())
    } else {
        let mut error_output = String::new();
        if let Some(stderr) = command.stderr.take() {
            let reader = BufReader::new(stderr);
            for line in reader.lines() {
                let line = line.unwrap_or_else(|_| "Failed to read line".to_string());
                error_output.push_str(&line);
            }
            Err(error_output.into())
        } else {
            Err("Failed to execute script".into())
        }
    }
}

pub fn unzip_file(file_path: &Path, destination: &Path) -> Result<(), Box<dyn std::error::Error>> {
    // Open the ZIP file
    let file = File::open(file_path)?;
    let mut archive = ZipArchive::new(BufReader::new(file))?;

    let file_count = archive.len();
    let progress_bar = ProgressBar::new(file_count as u64);

    let mut root_folder: Option<PathBuf> = None;

    for i in 0..file_count {
        let mut file = archive.by_index(i)?;
        let outpath = destination.join(file.name());

        if i == 1 {
            if let Some(parent) = outpath.parent() {
                root_folder = Some(parent.to_path_buf());
            }
        }

        if file.name().ends_with('/') {
            fs::create_dir_all(&outpath)?;
        } else {
            if let Some(p) = outpath.parent() {
                if !p.exists() {
                    fs::create_dir_all(&p)?;
                }
            }
            let mut outfile = File::create(&outpath)?;
            io::copy(&mut file, &mut outfile)?;
        }

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            if let Some(mode) = file.unix_mode() {
                fs::set_permissions(&outpath, fs::Permissions::from_mode(mode))?;
            }
        }

        progress_bar.set_message(file.name().to_string());
        progress_bar.inc(1);
    }

    if let Some(root_folder) = root_folder {
        if root_folder != *destination {
            for entry in fs::read_dir(&root_folder)? {
                let entry = entry?;
                let path = entry.path();
                let file_name = path.file_name().unwrap(); // safe unwrap
                let new_path = destination.join(file_name);
                fs::rename(path, new_path)?;
            }
            fs::remove_dir_all(root_folder)?;
        }
    }

    Ok(())
}

pub fn get_osmosis_dir(project_root: &Path) -> PathBuf {
    project_root
        .join("chains")
        .join("osmosis")
        .join("osmosis")
        .to_path_buf()
}

pub fn extract_tendermint_client_id(output: Output) -> Option<String> {
    if output.status.success() {
        let regex = Regex::new(r#"client_id:\s*ClientId\(\s*"([^"]+)""#).unwrap();
        if let Some(results) = regex.captures(String::from_utf8_lossy(&output.stdout).as_ref()) {
            if let Some(result) = results.get(1) {
                return Some(result.as_str().to_string());
            }
        }
    }
    None
}

pub fn extract_tendermint_connection_id(output: Output) -> Option<String> {
    if output.status.success() {
        let regex = Regex::new(r#"\s*(connection-\d+)"#).unwrap();
        if let Some(results) = regex.captures(String::from_utf8_lossy(&output.stdout).as_ref()) {
            if let Some(result) = results.get(1) {
                return Some(result.as_str().to_string());
            }
        }
    }
    None
}

pub fn copy_dir_all(src: impl AsRef<Path>, dst: impl AsRef<Path>) -> io::Result<()> {
    fs::create_dir_all(dst.as_ref()).expect("failed to create target folder");

    // Iterate through the entries in the source directory
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let file_type = entry.file_type()?;
        
        // Get the source and destination paths
        let src_path = entry.path();
        let dst_path = dst.as_ref().join(entry.file_name());

        // If it's a directory, recursively copy it
        if file_type.is_dir() {
            copy_dir_all(&src_path, &dst_path)?;
        } else {
            // If it's a file, just copy it
            fs::copy(&src_path, &dst_path)?;
        }
    }
    Ok(())
}

pub fn query_balance(project_root_path: &Path, address: &str,) -> u64 {
    let cardano_dir = project_root_path.join("chains/cardano");

    let cardano_cli_args = vec!["compose", "exec", "cardano-node", "cardano-cli"];
    let build_address_args = vec![
        "query",
        "utxo",
        "--address",
        address,
        "--testnet-magic",
        "42",
        "--output-json",
    ];
    let balance = Command::new("docker")
        .current_dir(cardano_dir)
        .args(&cardano_cli_args)
        .args(build_address_args)
        .output()
        .expect("Failed to build address")
        .stdout;

    let v: HashMap<String, Value> =
        serde_json::from_str(String::from_utf8(balance).unwrap().as_str()).unwrap();

    v
        .values()
        .map(|k| k["value"]["lovelace"].as_u64().unwrap())
        .sum()

    
}