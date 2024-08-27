use crate::logger::{
    self, error, verbose,
    Verbosity::{Info, Standard, Verbose},
};
use console::style;
use indicatif::{ProgressBar, ProgressStyle};
use reqwest::Client;
use std::error::Error;
use std::fs;
use std::fs::File;
use std::io::BufRead;
use std::io::{self, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::Duration;
use std::{collections::VecDeque, thread};
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

pub fn get_project_root_path(project_root: Option<String>) -> PathBuf {
    let mut project_root_dir = match project_root {
        Some(dir) => dir,
        None => ".".to_string(),
    };

    if project_root_dir.starts_with(".") {
        project_root_dir = std::env::current_dir()
            .unwrap_or_else(|err| {
                logger::log(&format!("Failed to get current directory: {}", err));
                panic!("Failed to get current directory: {}", err);
            })
            .join(project_root_dir)
            .to_str()
            .unwrap()
            .to_string();
    }

    return Path::new(project_root_dir.as_str()).to_path_buf();
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

pub async fn wait_for_health_check(url: &str, retries: u32, interval: u64) -> Result<(), String> {
    let client = Client::new();

    for retry in 0..retries {
        let response = client.get(url).send().await;

        match response {
            Ok(resp) if resp.status().is_success() => {
                verbose(&format!(
                    "Health on {} check passed on retry {}",
                    url,
                    retry + 1
                ));
                return Ok(());
            }
            Ok(resp) => {
                verbose(&format!(
                    "Health check {} failed with status: {} on retry {}",
                    url,
                    resp.status(),
                    retry + 1
                ));
            }
            Err(e) => {
                error(&format!(
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
) -> io::Result<String> {
    logger::verbose(&format!(
        "{} {} {}",
        script_dir.display(),
        script_name,
        script_args.join(" ")
    ));
    let mut cmd = Command::new(script_name)
        .current_dir(script_dir)
        .args(script_args)
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
    success_message: &str,
    error_message: &str,
) {
    let progress_bar = ProgressBar::new_spinner();
    progress_bar.enable_steady_tick(Duration::from_millis(100));
    progress_bar.set_style(
        ProgressStyle::default_spinner()
            .tick_strings(&["-", "\\", "|", "/"])
            .template(
                format!("{} {}\n{}", "{spinner:.green}", start_message, "{wide_msg}").as_str(),
            )
            .unwrap(),
    );

    let mut command = Command::new(script_name)
        .current_dir(script_dir)
        .args(script_args)
        .stdout(Stdio::piped())
        .spawn()
        .expect("Failed to initialize localnet");

    match logger::get_verbosity() {
        Verbose => {
            let stdout = command.stdout.as_mut().expect("Failed to open stdout");
            let reader = BufReader::new(stdout);

            for line in reader.lines() {
                let line = line.unwrap_or_else(|_| "Failed to read line".to_string());
                progress_bar.set_message(format!("{}", line));
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
                    progress_bar.set_message(format!("{}", last_line));
                }
            }
        }
        _ => {}
    }

    let status = command.wait().expect("Command wasn't running");
    if status.success() {
        progress_bar.finish_with_message(success_message.to_owned());
    } else {
        progress_bar.finish_with_message(error_message.to_owned());
    }
}

pub fn unzip_file(file_path: &Path, destination: &Path) -> Result<(), Box<dyn std::error::Error>> {
    // Open the ZIP file
    let file = File::open(file_path)?;
    let mut archive = ZipArchive::new(BufReader::new(file))?;

    let file_count = archive.len();
    let progress_bar = ProgressBar::new(file_count as u64);

    let mut root_folder: Option<PathBuf> = None;

    // Extract each file in the ZIP archive
    for i in 0..file_count {
        let mut file = archive.by_index(i)?;
        let outpath = destination.join(file.name());

        if i == 1 {
            if let Some(parent) = outpath.parent() {
                root_folder = Some(parent.to_path_buf());
            }
        }

        // Check if it's a directory or file
        if file.name().ends_with('/') {
            fs::create_dir_all(&outpath)?;
        } else {
            // Create the file's parent directories if necessary
            if let Some(p) = outpath.parent() {
                if !p.exists() {
                    fs::create_dir_all(&p)?;
                }
            }

            // Write the file's content
            let mut outfile = File::create(&outpath)?;
            io::copy(&mut file, &mut outfile)?;
        }

        // Set the file's permissions to be the same as in the ZIP archive
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
