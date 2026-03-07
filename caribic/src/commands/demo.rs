use std::path::Path;

use crate::{demos, DemoChain, DemoType};

/// Dispatches demo execution through demo drivers.
pub async fn run_demo(
    use_case: DemoType,
    chain: Option<DemoChain>,
    network: Option<String>,
    project_root_path: &Path,
) -> Result<(), String> {
    demos::run_demo(use_case, chain, network.as_deref(), project_root_path).await
}
