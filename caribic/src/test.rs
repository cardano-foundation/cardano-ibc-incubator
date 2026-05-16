use std::path::Path;

use crate::logger;

#[derive(Debug, Default)]
pub struct TestResults {
    pub passed: usize,
    pub skipped: usize,
    pub failed: usize,
}

impl TestResults {
    pub fn total(&self) -> usize {
        self.passed + self.skipped + self.failed
    }

    pub fn has_failures(&self) -> bool {
        self.failed > 0
    }

    pub fn all_passed(&self) -> bool {
        self.failed == 0 && self.skipped == 0
    }
}

pub async fn run_integration_tests(
    _project_root: &Path,
    tests: Option<&str>,
) -> Result<TestResults, Box<dyn std::error::Error>> {
    if tests.is_some() {
        logger::warn("Specific integration test selection is currently unavailable.");
    }

    logger::log(
        "Integration tests that depended on the former intermediary-chain topology have been removed. Add direct-route tests when direct Cardano-to-target routes are implemented.",
    );

    Ok(TestResults {
        passed: 0,
        skipped: 1,
        failed: 0,
    })
}
