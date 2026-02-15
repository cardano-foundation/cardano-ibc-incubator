use std::path::Path;

use crate::{logger, start};

/// Runs service health checks for one service or the full stack.
pub fn run_health_check(project_root_path: &Path, service: Option<&str>) -> Result<(), String> {
    match start::comprehensive_health_check(project_root_path, service) {
        Ok(output) => logger::log(&output),
        Err(error) => return Err(format!("Health check failed: {}", error)),
    }

    Ok(())
}
