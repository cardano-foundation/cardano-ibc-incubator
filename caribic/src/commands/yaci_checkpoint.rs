use crate::{logger, setup};
use serde::Deserialize;
use std::path::Path;
use std::time::Duration;

#[derive(Debug, Deserialize)]
struct KoiosTip {
    epoch_no: u64,
    block_no: u64,
}

#[derive(Debug, Deserialize)]
struct KoiosBlock {
    hash: String,
    epoch_no: u64,
    abs_slot: u64,
    epoch_slot: u64,
    block_height: u64,
}

pub async fn run_yaci_checkpoint(
    project_root_path: &Path,
    network: &str,
    epochs_back: u64,
    write_env: bool,
) -> Result<(), String> {
    if network != "preprod" {
        return Err(format!(
            "ERROR: yaci-checkpoint currently supports only --network preprod, got '{}'.",
            network
        ));
    }

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|error| format!("ERROR: Failed to initialize HTTP client: {}", error))?;

    let tip_url = "https://preprod.koios.rest/api/v1/tip";
    let tip = first_row::<KoiosTip>(&client, tip_url, "preprod Koios tip").await?;
    let target_epoch = tip.epoch_no.checked_sub(epochs_back).ok_or_else(|| {
        format!(
            "ERROR: Cannot select checkpoint {} epochs behind tip epoch {}.",
            epochs_back, tip.epoch_no
        )
    })?;

    let blocks_url = format!(
        "https://preprod.koios.rest/api/v1/blocks?epoch_no=eq.{target_epoch}&order=abs_slot.asc&limit=1"
    );
    let block =
        first_row::<KoiosBlock>(&client, blocks_url.as_str(), "preprod checkpoint block").await?;
    if block.epoch_no != target_epoch {
        return Err(format!(
            "ERROR: Koios returned checkpoint block for epoch {}, expected {}.",
            block.epoch_no, target_epoch
        ));
    }
    let block_hash = block.hash.to_lowercase();

    logger::log(&format!(
        "Yaci preprod checkpoint (tip epoch {}, tip block {}, target epoch {}):",
        tip.epoch_no, tip.block_no, target_epoch
    ));
    logger::log(&format!("  block_no: {}", block.block_height));
    logger::log(&format!("  slot: {}", block.abs_slot));
    logger::log(&format!("  epoch_slot: {}", block.epoch_slot));
    logger::log(&format!("  hash: {}", block_hash));
    logger::log("");
    logger::log("Set these before starting preprod Yaci:");
    logger::log(&format!("{}={}", "YACI_SYNC_START_SLOT", block.abs_slot));
    logger::log(&format!("{}={}", "YACI_SYNC_START_BLOCKHASH", block_hash));
    logger::log(&format!(
        "{}={}",
        "YACI_SYNC_START_BLOCK_NO", block.block_height
    ));

    if write_env {
        write_checkpoint_env(project_root_path, &block)?;
        logger::log("");
        logger::log("Wrote checkpoint values to cardano/gateway/.env and chains/cardano/.env.");
    }

    Ok(())
}

async fn first_row<T: for<'de> Deserialize<'de>>(
    client: &reqwest::Client,
    url: &str,
    label: &str,
) -> Result<T, String> {
    let response = client
        .get(url)
        .send()
        .await
        .map_err(|error| format!("ERROR: Failed to query {} at {}: {}", label, url, error))?
        .error_for_status()
        .map_err(|error| format!("ERROR: {} returned an error: {}", label, error))?;

    let mut rows = response
        .json::<Vec<T>>()
        .await
        .map_err(|error| format!("ERROR: Failed to parse {} response: {}", label, error))?;
    rows.pop()
        .ok_or_else(|| format!("ERROR: {} returned no rows from {}", label, url))
}

fn write_checkpoint_env(project_root_path: &Path, block: &KoiosBlock) -> Result<(), String> {
    let gateway_env = project_root_path.join("cardano/gateway/.env");
    let cardano_env = project_root_path.join("chains/cardano/.env");
    let hash = block.hash.to_lowercase();

    for env_path in [gateway_env.as_path(), cardano_env.as_path()] {
        setup::set_or_append_env_var(
            env_path,
            "YACI_SYNC_START_SLOT",
            &block.abs_slot.to_string(),
        )
        .map_err(|error| format!("ERROR: Failed to write {}: {}", env_path.display(), error))?;
        setup::set_or_append_env_var(env_path, "YACI_SYNC_START_BLOCKHASH", hash.as_str())
            .map_err(|error| format!("ERROR: Failed to write {}: {}", env_path.display(), error))?;
        setup::set_or_append_env_var(
            env_path,
            "YACI_SYNC_START_BLOCK_NO",
            &block.block_height.to_string(),
        )
        .map_err(|error| format!("ERROR: Failed to write {}: {}", env_path.display(), error))?;
    }

    Ok(())
}
