use std::path::Path;

use crate::check;

/// Verifies local tool prerequisites used by caribic workflows.
pub async fn run_check(project_root_path: &Path) -> Result<(), String> {
    check::check_prerequisites(Some(project_root_path)).await;

    Ok(())
}
