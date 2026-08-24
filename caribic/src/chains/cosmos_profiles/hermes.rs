use std::fs;
use std::path::Path;

use super::config::{CosmosProfileConfig, RELAYER_MNEMONIC};
use crate::chains::hermes_support::{
    self, HermesAddressType, HermesCosmosChainProfile, HermesEventSource, HermesGasPrice,
    HermesTrustThreshold,
};
use crate::process::hermes::HermesCli;

// The local simd profiles accept 1,048,576-byte transactions. Keep enough
// headroom for encoding while allowing Gateway's bounded Cardano headers to fit.
const LOCAL_COSMOS_MAX_TX_SIZE: u64 = 1_000_000;

pub(super) fn sync_profile_with_hermes(
    project_root_path: &Path,
    profile: CosmosProfileConfig,
) -> Result<(), Box<dyn std::error::Error>> {
    if !profile.supports_classic_routes() || hermes_support::hermes_config_path().is_none() {
        return Ok(());
    }

    configure_classic_profile(project_root_path, profile)
}

pub(super) fn configure_classic_profile(
    project_root_path: &Path,
    profile: CosmosProfileConfig,
) -> Result<(), Box<dyn std::error::Error>> {
    if !profile.supports_classic_routes() {
        return Err(format!(
            "Profile '{}' uses IBC v2 semantics. Cardano/Hermes v2 route testing is intentionally deferred; use v8-classic or v10-classic today.",
            profile.name
        )
        .into());
    }

    hermes_support::ensure_cosmos_chain_in_hermes_config(
        &hermes_profile(profile),
        &format!(
            "Local {} chain used by Cardano compatibility routes",
            profile.display_name
        ),
    )?;
    ensure_relayer_key(project_root_path, profile)
}

fn hermes_profile(profile: CosmosProfileConfig) -> HermesCosmosChainProfile {
    HermesCosmosChainProfile {
        id: profile.chain_id.to_string(),
        rpc_addr: format!("http://127.0.0.1:{}", profile.rpc_port),
        grpc_addr: format!("http://127.0.0.1:{}", profile.grpc_port),
        event_source: HermesEventSource::Push {
            url: format!("ws://127.0.0.1:{}/websocket", profile.rpc_port),
            batch_delay: "200ms",
        },
        rpc_timeout: "10s",
        trusted_node: Some(true),
        account_prefix: "cosmos",
        key_name: relayer_key_name(profile),
        address_type: Some(HermesAddressType::Cosmos),
        store_prefix: "ibc",
        default_gas: 5_000_000,
        max_gas: 15_000_000,
        gas_price: HermesGasPrice {
            price: "0.0025",
            denom: "stake",
        },
        gas_multiplier: "1.8",
        max_msg_num: 20,
        max_tx_size: LOCAL_COSMOS_MAX_TX_SIZE,
        clock_drift: "8760h",
        max_block_time: "10s",
        trusting_period: "10days",
        memo_prefix: Some("Cardano IBC compatibility"),
        trust_threshold: HermesTrustThreshold {
            numerator: "1",
            denominator: "3",
        },
        compat_mode: Some("0.38"),
    }
}

fn ensure_relayer_key(
    project_root_path: &Path,
    profile: CosmosProfileConfig,
) -> Result<(), Box<dyn std::error::Error>> {
    let working_dir = project_root_path.join("chains").join("cosmos");
    let hermes_binary =
        hermes_support::resolve_local_hermes_binary(project_root_path, working_dir.as_path())
            .ok_or_else(|| {
                format!(
                    "Local Hermes binary not found. Expected {}",
                    project_root_path
                        .join("relayer/target/release/hermes")
                        .display()
                )
            })?;

    let key_name = relayer_key_name(profile);
    if chain_has_key(
        hermes_binary.as_path(),
        working_dir.as_path(),
        profile.chain_id,
        key_name.as_str(),
    )? {
        return Ok(());
    }

    let mnemonic_file =
        hermes_support::write_temp_mnemonic_file(profile.name, RELAYER_MNEMONIC.to_string())?;
    let mnemonic_arg = mnemonic_file.to_string_lossy().to_string();
    let add_result = HermesCli::new(hermes_binary.as_path()).output(
        Some(working_dir.as_path()),
        &[
            "keys",
            "add",
            "--overwrite",
            "--chain",
            profile.chain_id,
            "--key-name",
            key_name.as_str(),
            "--mnemonic-file",
            mnemonic_arg.as_str(),
        ],
    );
    let _ = fs::remove_file(mnemonic_file.as_path());
    add_result?;
    Ok(())
}

fn relayer_key_name(profile: CosmosProfileConfig) -> String {
    format!("{}-relayer", profile.chain_id)
}

fn chain_has_key(
    hermes_binary: &Path,
    working_dir: &Path,
    chain_id: &str,
    key_name: &str,
) -> Result<bool, Box<dyn std::error::Error>> {
    let output = HermesCli::new(hermes_binary)
        .output(Some(working_dir), &["keys", "list", "--chain", chain_id]);
    let Ok(output) = output else {
        return Ok(false);
    };

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    Ok(stdout.contains(key_name) || stderr.contains(key_name))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::chains::cosmos_profiles::config::CosmosTestProfile;

    #[test]
    fn classic_profiles_allow_bounded_cardano_headers_below_the_node_limit() {
        const LOCAL_SIMD_MAX_TX_BYTES: u64 = 1_048_576;

        let setup_script = include_str!("../../../../chains/cosmos/scripts/setup_profile.sh");
        assert!(setup_script.contains("COSMOS_MAX_TX_BYTES:-1048576"));

        for test_profile in [CosmosTestProfile::V8Classic, CosmosTestProfile::V10Classic] {
            let profile = hermes_profile(*test_profile.config());
            assert_eq!(profile.max_tx_size, LOCAL_COSMOS_MAX_TX_SIZE);
            assert!(profile.max_tx_size < LOCAL_SIMD_MAX_TX_BYTES);
        }
    }
}
