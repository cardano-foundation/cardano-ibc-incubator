use std::path::Path;

use async_trait::async_trait;

use crate::{start::OptionalChainId, DemoType};

mod token_swap;
mod token_transfer;

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
struct TokenTransferDemoDriver;

static TOKEN_SWAP_DEMO_DRIVER: TokenSwapDemoDriver = TokenSwapDemoDriver;
static TOKEN_TRANSFER_DEMO_DRIVER: TokenTransferDemoDriver = TokenTransferDemoDriver;

#[async_trait]
impl DemoDriver for TokenTransferDemoDriver {
    fn use_case(&self) -> DemoType {
        DemoType::TokenTransfer
    }

    async fn run(
        &self,
        project_root_path: &Path,
        options: &DemoRunOptions<'_>,
    ) -> Result<(), String> {
        token_transfer::run_token_transfer_demo(project_root_path, options.chain, options.network)
            .await
    }
}

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
    vec![&TOKEN_TRANSFER_DEMO_DRIVER, &TOKEN_SWAP_DEMO_DRIVER]
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

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn transfer_targets_reject_swap_before_route_setup() {
        for chain in [OptionalChainId::Cosmos, OptionalChainId::Injective] {
            let error = run_demo(
                DemoType::TokenSwap,
                Some(chain),
                None,
                Path::new("/nonexistent-caribic-demo"),
            )
            .await
            .unwrap_err();
            assert!(error.contains("caribic demo token-transfer"), "{error}");
        }
    }

    #[tokio::test]
    async fn osmosis_rejects_transfer_before_route_setup() {
        let error = run_demo(
            DemoType::TokenTransfer,
            Some(OptionalChainId::Osmosis),
            None,
            Path::new("/nonexistent-caribic-demo"),
        )
        .await
        .unwrap_err();
        assert!(error.contains("caribic demo token-swap"), "{error}");
    }
}
