use std::path::Path;

use async_trait::async_trait;

use crate::DemoType;

mod message_exchange;
mod token_swap;

#[async_trait]
trait DemoDriver: Sync {
    fn use_case(&self) -> DemoType;
    async fn run(&self, project_root_path: &Path) -> Result<(), String>;
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

    async fn run(&self, project_root_path: &Path) -> Result<(), String> {
        token_swap::run_token_swap_demo(project_root_path).await
    }
}

#[async_trait]
impl DemoDriver for MessageExchangeDemoDriver {
    fn use_case(&self) -> DemoType {
        DemoType::MessageExchange
    }

    async fn run(&self, project_root_path: &Path) -> Result<(), String> {
        message_exchange::run_message_exchange_demo(project_root_path).await
    }
}

fn registered_demo_drivers() -> Vec<&'static dyn DemoDriver> {
    vec![&TOKEN_SWAP_DEMO_DRIVER, &MESSAGE_EXCHANGE_DEMO_DRIVER]
}

/// Dispatches demo execution through registered demo drivers.
pub async fn run_demo(use_case: DemoType, project_root_path: &Path) -> Result<(), String> {
    for driver in registered_demo_drivers() {
        if driver.use_case() == use_case {
            return driver.run(project_root_path).await;
        }
    }

    Err("No demo driver registered for selected use case".to_string())
}
