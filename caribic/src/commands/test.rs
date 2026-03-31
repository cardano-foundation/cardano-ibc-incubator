use std::path::Path;

use crate::{
    logger,
    test::{self, TestResults},
};

/// Runs integration tests and returns an error if any test fails.
pub async fn run_tests(project_root_path: &Path, tests: Option<&str>) -> Result<(), String> {
    let results = match test::run_integration_tests(project_root_path, tests).await {
        Ok(results) => results,
        Err(error) => return Err(format!("Integration tests failed: {}", error)),
    };

    print_summary(&results);
    if results.has_failures() {
        return Err("Some integration tests failed".to_string());
    }

    Ok(())
}

/// Prints a concise final summary for pass, skip, and fail counts.
fn print_summary(results: &TestResults) {
    logger::log(&format!(
        "\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\nTest Summary: {} total\n  ✓ {} passed\n  ⊘ {} skipped\n  ✗ {} failed\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
        results.total(),
        results.passed,
        results.skipped,
        results.failed
    ));

    if results.has_failures() {
        logger::error("\nTests failed! Fix the errors above and try again.");
    } else if results.all_passed() {
        logger::log("\nAll integration tests passed!");
    } else if results.skipped > 0 {
        logger::log(
            "\nAll runnable tests passed. Some tests were skipped due to known limitations.",
        );
        logger::log("See skipped test messages above for details.");
    }
}
