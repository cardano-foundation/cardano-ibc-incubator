use std::path::Path;
use std::process::{Command, Stdio};
use std::{fs, path::PathBuf};

use crate::{
    config::{self, CoreCardanoNetwork},
    logger,
    test::{self, TestResults},
};

/// Runs integration tests by default, or the optional denom-registry benchmark when requested.
pub async fn run_tests(
    project_root_path: &Path,
    tests: Option<&str>,
    denom_registry: bool,
    bucket: Option<u8>,
    simulated_inserts: usize,
) -> Result<(), String> {
    if denom_registry {
        return run_denom_registry_benchmark(project_root_path, bucket, simulated_inserts);
    }

    let results = match test::run_integration_tests(project_root_path, tests).await {
        Ok(results) => results,
        Err(error) => return Err(format!("Integration tests failed: {}", error)),
    };

    print_summary(&results);
    if results.has_failures() {
        return Err("Some integration tests failed".to_string());
    }

    Ok(())
}

fn run_denom_registry_benchmark(
    project_root_path: &Path,
    bucket: Option<u8>,
    simulated_inserts: usize,
) -> Result<(), String> {
    let active_network = config::active_core_cardano_network(project_root_path);
    if active_network != CoreCardanoNetwork::Local {
        return Err(format!(
            "Denom-registry benchmark only supports the local Cardano runtime today (active network: {}).",
            active_network.as_str()
        ));
    }

    let profile = config::cardano_network_profile(active_network);
    let gateway_dir = project_root_path.join("cardano/gateway");
    let normalized_handler_json_path =
        normalize_existing_path(project_root_path.join("cardano/offchain/deployments/handler.json"))?;
    let normalized_bridge_manifest_path = Some(normalize_future_path(
        project_root_path.join("cardano/offchain/deployments/bridge-manifest.json"),
    )?);

    if let Some(bridge_manifest_path) = normalized_bridge_manifest_path.as_deref() {
        ensure_bridge_manifest_exists(
            &gateway_dir,
            &normalized_handler_json_path,
            bridge_manifest_path,
            &profile,
        )?;
    }

    let mut command = Command::new("npm");
    command
        .arg("run")
        .arg("benchmark:denom-registry")
        .arg("--")
        .arg("--simulated-inserts")
        .arg(simulated_inserts.to_string())
        .current_dir(&gateway_dir)
        .env("CARDANO_CHAIN_ID", &profile.chain_id)
        .env(
            "CARDANO_CHAIN_NETWORK_MAGIC",
            profile.network_magic.to_string(),
        )
        .env("KUPO_ENDPOINT", "http://127.0.0.1:1442")
        .env("OGMIOS_ENDPOINT", "http://127.0.0.1:1337")
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit());

    if let Some(bridge_manifest_path) = normalized_bridge_manifest_path.as_ref() {
        command.env("BRIDGE_MANIFEST_PATH", bridge_manifest_path);
        command.env_remove("HANDLER_JSON_PATH");
    } else {
        command.env("HANDLER_JSON_PATH", &normalized_handler_json_path);
        command.env_remove("BRIDGE_MANIFEST_PATH");
    }

    if let Some(bucket_index) = bucket {
        command.arg("--bucket").arg(bucket_index.to_string());
    }

    logger::log("Running on-chain denom-registry benchmark...");
    let status = command.status().map_err(|error| {
        format!(
            "Failed to start denom-registry benchmark from {}: {}",
            gateway_dir.display(),
            error
        )
    })?;

    if !status.success() {
        return Err(format!(
            "Denom-registry benchmark failed with status {}",
            status
        ));
    }

    logger::log("Denom-registry benchmark completed successfully.");
    Ok(())
}

fn normalize_existing_path(path: impl AsRef<Path>) -> Result<String, String> {
    let display = path.as_ref().display().to_string();
    fs::canonicalize(path.as_ref())
        .map(|resolved| resolved.to_string_lossy().to_string())
        .map_err(|error| format!("Failed to resolve required path {}: {}", display, error))
}

fn normalize_future_path(path: impl AsRef<Path>) -> Result<String, String> {
    let candidate = PathBuf::from(path.as_ref());
    if candidate.exists() {
        return normalize_existing_path(&candidate);
    }

    let parent = candidate.parent().ok_or_else(|| {
        format!(
            "Failed to resolve future path {} because it has no parent directory",
            candidate.display()
        )
    })?;
    let resolved_parent = fs::canonicalize(parent).map_err(|error| {
        format!(
            "Failed to resolve parent directory {} for {}: {}",
            parent.display(),
            candidate.display(),
            error
        )
    })?;

    let file_name = candidate.file_name().ok_or_else(|| {
        format!(
            "Failed to resolve future path {} because it has no file name",
            candidate.display()
        )
    })?;

    Ok(resolved_parent
        .join(file_name)
        .to_string_lossy()
        .to_string())
}

fn ensure_bridge_manifest_exists(
    gateway_dir: &Path,
    handler_json_path: &str,
    bridge_manifest_path: &str,
    profile: &config::CardanoNetworkProfile,
) -> Result<(), String> {
    if Path::new(bridge_manifest_path).exists() {
        return Ok(());
    }

    logger::log(&format!(
        "Bridge manifest not found at {}. Generating it from handler.json first...",
        bridge_manifest_path
    ));

    let status = Command::new("npm")
        .arg("run")
        .arg("export:bridge-manifest")
        .arg("--")
        .arg(handler_json_path)
        .arg(bridge_manifest_path)
        .current_dir(gateway_dir)
        .env("CARDANO_CHAIN_ID", &profile.chain_id)
        .env(
            "CARDANO_CHAIN_NETWORK_MAGIC",
            profile.network_magic.to_string(),
        )
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit())
        .status()
        .map_err(|error| {
            format!(
                "Failed to start bridge-manifest export from {}: {}",
                gateway_dir.display(),
                error
            )
        })?;

    if !status.success() {
        let handler_path = PathBuf::from(handler_json_path);
        let stale_handler = fs::read_to_string(&handler_path)
            .ok()
            .map(|contents| !contents.contains("\"mintIdentifier\""))
            .unwrap_or(false);

        if stale_handler {
            return Err(format!(
                "Failed to export bridge manifest for denom-registry benchmark because {} is from the pre-directory trace-registry model. Re-run `caribic start bridge --network local` on this branch to regenerate deployment artifacts, then retry.",
                handler_path.display()
            ));
        }

        return Err(format!(
            "Failed to export bridge manifest for denom-registry benchmark (status {})",
            status
        ));
    }

    Ok(())
}

/// Prints a concise final summary for pass, skip, and fail counts.
fn print_summary(results: &TestResults) {
    logger::log(&format!(
        "\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\nTest Summary: {} total\n  ✓ {} passed\n  ⊘ {} skipped\n  ✗ {} failed\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
        results.total(),
        results.passed,
        results.skipped,
        results.failed
    ));

    if results.has_failures() {
        logger::error("\nTests failed! Fix the errors above and try again.");
    } else if results.all_passed() {
        logger::log("\nAll integration tests passed!");
    } else if results.skipped > 0 {
        logger::log(
            "\nAll runnable tests passed. Some tests were skipped due to known limitations.",
        );
        logger::log("See skipped test messages above for details.");
    }
}
