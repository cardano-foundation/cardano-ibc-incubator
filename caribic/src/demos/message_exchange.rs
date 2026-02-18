use std::path::Path;

use crate::{logger, start};

/// Starts the message exchange demo chain and relayer services.
pub async fn run_message_exchange_demo(project_root_path: &Path) -> Result<(), String> {
    let project_config = crate::config::get_config();
    let chain_root_path = project_root_path.join("chains/summit-demo/");

    let cosmos_chain_repo_url = format!(
        "{}/archive/refs/heads/{}.zip",
        project_config.vessel_oracle.repo_base_url, project_config.vessel_oracle.target_branch
    );

    match start::start_cosmos_entrypoint_chain_from_repository(
        &cosmos_chain_repo_url,
        chain_root_path.as_path(),
    )
    .await
    {
        Ok(_) => logger::log("PASS: Cosmos Entrypoint chain up and running"),
        Err(error) => {
            return Err(format!(
                "ERROR: Failed to start Cosmos Entrypoint chain: {}",
                error
            ))
        }
    }

    match start::start_relayer(
        project_root_path.join("relayer").as_path(),
        chain_root_path.join("relayer/.env.relayer").as_path(),
        chain_root_path.join("relayer/config").as_path(),
        project_root_path
            .join("cardano/offchain/deployments/handler.json")
            .as_path(),
    ) {
        Ok(_) => logger::log("PASS: Relayer started successfully"),
        Err(error) => return Err(format!("ERROR: Failed to start relayer: {}", error)),
    }

    logger::log("\nPASS: Message exchange demo services started successfully");

    Ok(())
}
