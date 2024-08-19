use console::style;
use indicatif::ProgressBar;
use std::error::Error;
use std::fs;
use std::fs::File;
use std::io::{self, BufReader};
use std::path::Path;
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

pub fn delete_dir(dir_path: &Path) -> io::Result<()> {
    fs::remove_dir_all(dir_path)
}

pub fn unzip_file(file_path: &Path, destination: &Path) -> Result<(), Box<dyn std::error::Error>> {
    // Open the ZIP file
    let file = File::open(file_path)?;
    let mut archive = ZipArchive::new(BufReader::new(file))?;

    let file_count = archive.len();
    let progress_bar = ProgressBar::new(file_count as u64);

    // Extract each file in the ZIP archive
    for i in 0..file_count {
        let mut file = archive.by_index(i)?;
        let outpath = destination.join(file.name());

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

    Ok(())
}
