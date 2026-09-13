use std::path::Path;

#[derive(clap::ValueEnum, Clone, Debug)]
pub enum DevkitAction {
    /// Start the five-producer network and its history services
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
    crate::local_runtime::run(project_root, action, &[])
}
