use std::path::Path;

use crate::check::run_security_audit;
use crate::logger;

pub fn run_audit(project_root_path: &Path) -> Result<(), String> {
    let report = run_security_audit(project_root_path);
    logger::log(&report.output);

    if report.failed > 0 {
        Err("Audit checks failed. Review the output above.".to_string())
    } else {
        Ok(())
    }
}
