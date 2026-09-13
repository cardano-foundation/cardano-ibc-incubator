use std::{path::Path, process::Command};

#[derive(clap::ValueEnum, Clone, Debug)]
pub enum DevkitAction {
    /// Start the experimental single-producer network and its history service
    Start,
    /// Stop this checkout's DevKit containers and retain their data
    Stop,
    /// Delete this checkout's DevKit network and history, then start again
    Reset,
    /// Inspect containers, endpoints, and bridge compatibility
    Status,
    /// Submit a transaction and check inclusion, history, and chain evidence
    Test,
}

pub fn run_devkit(project_root: &Path, action: DevkitAction) -> Result<(), String> {
    let action = match action {
        DevkitAction::Start => "start",
        DevkitAction::Stop => "stop",
        DevkitAction::Reset => "reset",
        DevkitAction::Status => "status",
        DevkitAction::Test => "test",
    };
    let status = Command::new("python3")
        .arg(project_root.join("chains/cardano/devkit/profile.py"))
        .arg(action)
        .status()
        .map_err(|error| format!("Failed to run DevKit profile, Python 3 is required: {error}"))?;
    if !status.success() {
        return Err(format!("DevKit {action} failed ({status})"));
    }
    Ok(())
}
