use crate::{config, logger, setup};
use reqwest::header::{ACCEPT, AUTHORIZATION};
use serde::Deserialize;
use std::time::Duration;
use std::{fs, path::Path};

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
    let cardano_network = config::CoreCardanoNetwork::parse(Some(network))?;
    if !cardano_network.is_public_testnet() {
        return Err(format!(
            "ERROR: yaci-checkpoint supports only public Cardano testnets (preprod, preview), got '{}'.",
            network
        ));
    }
    let koios_base_url = cardano_network
        .koios_base_url()
        .ok_or_else(|| format!("ERROR: Missing Koios endpoint for {}.", network))?;

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|error| format!("ERROR: Failed to initialize HTTP client: {}", error))?;
    let authorization = koios_authorization_header(project_root_path)?;

    let tip_url = format!("{koios_base_url}/tip");
    let tip = first_row::<KoiosTip>(
        &client,
        tip_url.as_str(),
        &format!("{} Koios tip", cardano_network.as_str()),
        authorization.as_deref(),
    )
    .await?;
    let target_epoch = tip.epoch_no.checked_sub(epochs_back).ok_or_else(|| {
        format!(
            "ERROR: Cannot select checkpoint {} epochs behind tip epoch {}.",
            epochs_back, tip.epoch_no
        )
    })?;

    let blocks_url =
        format!("{koios_base_url}/blocks?epoch_no=eq.{target_epoch}&order=abs_slot.asc&limit=1");
    let block = first_row::<KoiosBlock>(
        &client,
        blocks_url.as_str(),
        &format!("{} checkpoint block", cardano_network.as_str()),
        authorization.as_deref(),
    )
    .await?;
    if block.epoch_no != target_epoch {
        return Err(format!(
            "ERROR: Koios returned checkpoint block for epoch {}, expected {}.",
            block.epoch_no, target_epoch
        ));
    }
    let block_hash = block.hash.to_lowercase();

    logger::log(&format!(
        "Yaci {} checkpoint (tip epoch {}, tip block {}, target epoch {}):",
        cardano_network.as_str(),
        tip.epoch_no,
        tip.block_no,
        target_epoch
    ));
    logger::log(&format!("  block_no: {}", block.block_height));
    logger::log(&format!("  slot: {}", block.abs_slot));
    logger::log(&format!("  epoch_slot: {}", block.epoch_slot));
    logger::log(&format!("  hash: {}", block_hash));
    logger::log("");
    logger::log(&format!(
        "Set these before starting {} Yaci:",
        cardano_network.as_str()
    ));
    logger::log(&format!("{}={}", "YACI_SYNC_START_SLOT", block.abs_slot));
    logger::log(&format!("{}={}", "YACI_SYNC_START_BLOCKHASH", block_hash));
    logger::log(&format!(
        "{}={}",
        "YACI_SYNC_START_BLOCK_NO", block.block_height
    ));

    if write_env {
        let profile = config::cardano_network_profile(cardano_network);
        write_checkpoint_env(
            project_root_path,
            cardano_network,
            profile.chain_id.as_str(),
            profile.network_magic,
            &block,
        )?;
        logger::log("");
        logger::log(&format!(
            "Wrote the {} network marker and checkpoint values to cardano/gateway/.env. Caribic will generate chains/cardano/.env when that network starts.",
            cardano_network.as_str()
        ));
    }

    Ok(())
}

fn koios_authorization_header(project_root_path: &Path) -> Result<Option<String>, String> {
    let process_value = [
        "CARIBIC_KOIOS_API_KEY",
        "CARDANO_KOIOS_API_KEY",
        "KOIOS_API_KEY",
    ]
    .iter()
    .find_map(|key| std::env::var(key).ok())
    .map(|value| value.trim().to_string())
    .filter(|value| !value.is_empty());
    let gateway_env = project_root_path.join("cardano/gateway/.env");
    let file_value = if gateway_env.exists() {
        setup::read_gateway_env_value(&gateway_env, "CARDANO_KOIOS_API_KEY")
            .map_err(|error| format!("ERROR: Failed to read {}: {error}", gateway_env.display()))?
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
    } else {
        None
    };

    Ok(process_value.or(file_value).map(|api_key| {
        if api_key.to_ascii_lowercase().starts_with("bearer ") {
            api_key
        } else {
            format!("Bearer {api_key}")
        }
    }))
}

async fn first_row<T: for<'de> Deserialize<'de>>(
    client: &reqwest::Client,
    url: &str,
    label: &str,
    authorization: Option<&str>,
) -> Result<T, String> {
    let mut request = client.get(url).header(ACCEPT, "application/json");
    if let Some(authorization) = authorization {
        request = request.header(AUTHORIZATION, authorization);
    }

    let response = request
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

fn write_checkpoint_env(
    project_root_path: &Path,
    network: config::CoreCardanoNetwork,
    chain_id: &str,
    network_magic: u64,
    block: &KoiosBlock,
) -> Result<(), String> {
    let gateway_env = project_root_path.join("cardano/gateway/.env");
    if !gateway_env.exists() {
        let template = project_root_path.join("cardano/gateway/.env.example");
        fs::copy(&template, &gateway_env).map_err(|error| {
            format!(
                "ERROR: Failed to seed {} from {}: {}",
                gateway_env.display(),
                template.display(),
                error
            )
        })?;
    }
    setup::secure_env_file_permissions(&gateway_env)
        .map_err(|error| format!("ERROR: Failed to secure {}: {error}", gateway_env.display()))?;
    let hash = block.hash.to_lowercase();
    let network_magic = network_magic.to_string();

    setup::validate_public_testnet_env_network_state(&gateway_env, network).map_err(|error| {
        format!(
            "ERROR: Refusing to overwrite checkpoint state in {}: {}",
            gateway_env.display(),
            error
        )
    })?;

    for (key, value) in [
        (setup::CARDANO_RUNTIME_NETWORK_KEY, network.as_str()),
        ("CARDANO_CHAIN_ID", chain_id),
        ("CARDANO_CHAIN_NETWORK_MAGIC", network_magic.as_str()),
        ("CARDANO_NETWORK_MAGIC", network_magic.as_str()),
    ] {
        setup::set_or_append_env_var(&gateway_env, key, value).map_err(|error| {
            format!(
                "ERROR: Failed to write {}: {}",
                gateway_env.display(),
                error
            )
        })?;
    }
    setup::set_or_append_env_var(
        &gateway_env,
        "YACI_SYNC_START_SLOT",
        &block.abs_slot.to_string(),
    )
    .map_err(|error| {
        format!(
            "ERROR: Failed to write {}: {}",
            gateway_env.display(),
            error
        )
    })?;
    setup::set_or_append_env_var(&gateway_env, "YACI_SYNC_START_BLOCKHASH", hash.as_str())
        .map_err(|error| {
            format!(
                "ERROR: Failed to write {}: {}",
                gateway_env.display(),
                error
            )
        })?;
    setup::set_or_append_env_var(
        &gateway_env,
        "YACI_SYNC_START_BLOCK_NO",
        &block.block_height.to_string(),
    )
    .map_err(|error| {
        format!(
            "ERROR: Failed to write {}: {}",
            gateway_env.display(),
            error
        )
    })?;
    setup::secure_env_file_permissions(&gateway_env)
        .map_err(|error| format!("ERROR: Failed to secure {}: {error}", gateway_env.display()))?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{write_checkpoint_env, KoiosBlock};
    use crate::config::CoreCardanoNetwork;
    use std::{fs, time::SystemTime};

    #[test]
    fn checkpoint_write_updates_only_operator_gateway_state() {
        let unique = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "caribic-checkpoint-state-{}-{unique}",
            std::process::id()
        ));
        let gateway_dir = root.join("cardano/gateway");
        fs::create_dir_all(&gateway_dir).unwrap();
        fs::write(
            gateway_dir.join(".env.example"),
            "CARDANO_RUNTIME_NETWORK=local\nCARDANO_CHAIN_ID=cardano-devnet\nCARDANO_CHAIN_NETWORK_MAGIC=42\nCARDANO_NETWORK_MAGIC=42\n",
        )
        .unwrap();
        let block = KoiosBlock {
            hash: "ABCD".repeat(16),
            epoch_no: 10,
            abs_slot: 123,
            epoch_slot: 1,
            block_height: 456,
        };

        write_checkpoint_env(
            &root,
            CoreCardanoNetwork::Preview,
            "cardano-preview",
            2,
            &block,
        )
        .unwrap();

        let gateway_env = gateway_dir.join(".env");
        let contents = fs::read_to_string(&gateway_env).unwrap();
        assert!(contents.contains("CARDANO_RUNTIME_NETWORK=preview"));
        assert!(contents.contains("CARDANO_NETWORK_MAGIC=2"));
        assert!(contents.contains("YACI_SYNC_START_SLOT=123"));
        assert!(!root.join("chains/cardano/.env").exists());

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                fs::metadata(&gateway_env).unwrap().permissions().mode() & 0o777,
                0o600
            );
        }

        fs::remove_dir_all(root).unwrap();
    }
}
