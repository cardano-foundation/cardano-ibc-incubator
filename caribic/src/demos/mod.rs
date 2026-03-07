use std::path::Path;

use async_trait::async_trait;

use crate::{DemoChain, DemoType};

mod message_exchange;
mod token_swap;

struct DemoRunOptions<'a> {
    chain: Option<DemoChain>,
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
struct MessageExchangeDemoDriver;

static TOKEN_SWAP_DEMO_DRIVER: TokenSwapDemoDriver = TokenSwapDemoDriver;
static MESSAGE_EXCHANGE_DEMO_DRIVER: MessageExchangeDemoDriver = MessageExchangeDemoDriver;

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

#[async_trait]
impl DemoDriver for MessageExchangeDemoDriver {
    fn use_case(&self) -> DemoType {
        DemoType::MessageExchange
    }

    async fn run(
        &self,
        project_root_path: &Path,
        options: &DemoRunOptions<'_>,
    ) -> Result<(), String> {
        if options.chain.is_some() || options.network.is_some() {
            return Err(
                "message-exchange demo does not support --chain/--network options".to_string(),
            );
        }

        message_exchange::run_message_exchange_demo(project_root_path).await
    }
}

fn registered_demo_drivers() -> Vec<&'static dyn DemoDriver> {
    vec![&TOKEN_SWAP_DEMO_DRIVER, &MESSAGE_EXCHANGE_DEMO_DRIVER]
}

/// Dispatches demo execution through registered demo drivers.
pub async fn run_demo(
    use_case: DemoType,
    chain: Option<DemoChain>,
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
