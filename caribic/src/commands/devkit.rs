use std::path::Path;

#[derive(clap::ValueEnum, Clone, Debug)]
pub enum DevkitAction {
    /// Inspect containers, endpoints, and bridge compatibility
    Status,
    /// Submit a transaction and check inclusion, history, and chain evidence
    Test,
}

pub fn run_devkit(project_root: &Path, action: DevkitAction) -> Result<(), String> {
    let action = match action {
        DevkitAction::Status => "status",
        DevkitAction::Test => "test",
    };
    crate::local_network::run(project_root, action, &[])
}
