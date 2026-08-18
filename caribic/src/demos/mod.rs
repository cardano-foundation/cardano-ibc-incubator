use std::path::Path;

use async_trait::async_trait;

use crate::{start::OptionalChainId, DemoType};

mod token_swap;

struct DemoRunOptions<'a> {
    chain: Option<OptionalChainId>,
    network: Option<&'a str>,
}

#[async_trait]
trait DemoDriver: Sync {
    fn use_case(&self) -> DemoType;
    async fn run(
        &self,
        project_root_path: &Path,
        options: &DemoRunOptions<'_>,
    ) -> Result<(), String>;
}

struct TokenSwapDemoDriver;

static TOKEN_SWAP_DEMO_DRIVER: TokenSwapDemoDriver = TokenSwapDemoDriver;

#[async_trait]
impl DemoDriver for TokenSwapDemoDriver {
    fn use_case(&self) -> DemoType {
        DemoType::TokenSwap
    }

    async fn run(
        &self,
        project_root_path: &Path,
        options: &DemoRunOptions<'_>,
    ) -> Result<(), String> {
        token_swap::run_token_swap_demo(project_root_path, options.chain, options.network).await
    }
}

fn registered_demo_drivers() -> Vec<&'static dyn DemoDriver> {
    vec![&TOKEN_SWAP_DEMO_DRIVER]
}

/// Dispatches demo execution through registered demo drivers.
pub async fn run_demo(
    use_case: DemoType,
    chain: Option<OptionalChainId>,
    network: Option<&str>,
    project_root_path: &Path,
) -> Result<(), String> {
    let options = DemoRunOptions { chain, network };

    for driver in registered_demo_drivers() {
        if driver.use_case() == use_case {
            return driver.run(project_root_path, &options).await;
        }
    }

    Err("No demo driver registered for selected use case".to_string())
}
