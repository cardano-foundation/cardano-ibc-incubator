use std::path::Path;

use crate::{demos, DemoType};

/// Dispatches demo execution through demo drivers.
pub async fn run_demo(use_case: DemoType, project_root_path: &Path) -> Result<(), String> {
    demos::run_demo(use_case, project_root_path).await
}
