use std::path::Path;

use crate::{start::OptionalChainId, DemoType};

mod token_swap;
mod token_transfer;

/// Dispatches execution to the selected demo.
pub async fn run_demo(
    use_case: DemoType,
    chain: Option<OptionalChainId>,
    network: Option<&str>,
    project_root_path: &Path,
) -> Result<(), String> {
    match use_case {
        DemoType::TokenTransfer => {
            token_transfer::run_token_transfer_demo(project_root_path, chain, network).await
        }
        DemoType::TokenSwap => {
            token_swap::run_token_swap_demo(project_root_path, chain, network).await
        }
    }
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
