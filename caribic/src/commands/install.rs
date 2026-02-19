use std::path::Path;

use crate::install;

/// Installs missing local prerequisites and builds local Hermes from relayer sources.
pub fn run_install(project_root_path: &Path) -> Result<(), String> {
    install::run_install(project_root_path)
}
