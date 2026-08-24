use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::thread;
use std::time::Duration;

use chrono::{DateTime, Utc};

use crate::chains::cosmos_profiles::{self, IbcSemantics};
use crate::logger;
use crate::process::docker::DockerCli;
use crate::route_setup::{self, RouteChain, RouteEndpoint};
use crate::start::{self, CoreServiceId, HealthTarget, OptionalChainId};
use crate::stop::stop_relayer;
use crate::utils::{self, execute_script};
use crate::{setup, LightClientTest};

const TEST_SUBJECT_ACTIVE_WINDOW_SECONDS: u64 = 600;
const TEST_EXPIRY_TIMEOUT_SECONDS: u64 = 900;
const GATEWAY_READY_URL: &str = "http://127.0.0.1:8000/health/ready";

pub(crate) async fn run(
    project_root_path: &Path,
    scenario: LightClientTest,
    chain: Option<OptionalChainId>,
    network: Option<&str>,
) -> Result<(), String> {
    let options = LightClientTestOptions::resolve(scenario, chain, network)?;
    let relayer_path = project_root_path.join("relayer");
    let relayer_was_running = matches!(
        start::check_health_target(project_root_path, HealthTarget::Core(CoreServiceId::Hermes)),
        Ok((true, _))
    );

    let stop_result = if relayer_was_running {
        logger::verbose(
            "Stopping the Hermes daemon while the focused light-client test drives exact packets",
        );
        stop_relayer(relayer_path.as_path());
        match start::check_health_target(
            project_root_path,
            HealthTarget::Core(CoreServiceId::Hermes),
        ) {
            Ok((false, _)) => Ok(()),
            Ok((true, _)) => Err(
                "Hermes daemon is still running; refusing to race the focused light-client test"
                    .to_string(),
            ),
            Err(error) => Err(format!("Could not verify that Hermes stopped: {error}")),
        }
    } else {
        Ok(())
    };

    let test_result = stop_result.and_then(|()| run_recover_client(project_root_path, &options));
    let restart_result = if relayer_was_running {
        start::start_hermes_daemon().map_err(|error| {
            format!("Light-client test finished, but Hermes restart failed: {error}")
        })
    } else {
        Ok(())
    };

    match (test_result, restart_result) {
        (Ok(()), Ok(())) => Ok(()),
        (Err(test_error), Ok(())) => Err(test_error),
        (Ok(()), Err(restart_error)) => Err(restart_error),
        (Err(test_error), Err(restart_error)) => {
            Err(format!("{test_error}; additionally, {restart_error}"))
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct LightClientTestOptions {
    scenario: LightClientTest,
    network: String,
    cosmos_chain_id: String,
}

impl LightClientTestOptions {
    fn resolve(
        scenario: LightClientTest,
        chain: Option<OptionalChainId>,
        network: Option<&str>,
    ) -> Result<Self, String> {
        let chain = chain.unwrap_or(OptionalChainId::Cosmos);
        if chain != OptionalChainId::Cosmos {
            return Err(format!(
                "Focused probabilistic light-client tests require '--chain cosmos', got '{chain:?}'"
            ));
        }

        let network = network.unwrap_or("v8-classic");
        if cosmos_profiles::semantics(network)? != IbcSemantics::Classic {
            return Err(format!(
                "Profile '{network}' uses IBC v2 semantics; recover-client testing currently requires v8-classic or v10-classic"
            ));
        }

        Ok(Self {
            scenario,
            network: network.to_string(),
            cosmos_chain_id: cosmos_profiles::chain_id(network)?.to_string(),
        })
    }
}

fn run_recover_client(
    project_root_path: &Path,
    options: &LightClientTestOptions,
) -> Result<(), String> {
    match options.scenario {
        LightClientTest::RecoverClient => {}
    }

    logger::log(&format!(
        "Running focused recover-client test against {}",
        options.network
    ));
    logger::log("This test requires a clean, running Cardano bridge and Cosmos profile.");

    let subject_trusting_period_seconds = local_subject_trusting_period(project_root_path)?;
    logger::log(&format!(
        "Using a {subject_trusting_period_seconds}s subject trusting period: local clock offset plus a {TEST_SUBJECT_ACTIVE_WINDOW_SECONDS}s active test window"
    ));

    let mut trusting_period = GatewayTrustingPeriodGuard::new(project_root_path)?;
    trusting_period.apply(subject_trusting_period_seconds.to_string().as_str())?;

    let route = route_setup::setup_fresh_transfer_route(
        project_root_path,
        RouteEndpoint::new(RouteChain::Cardano, Some("local".to_string())),
        RouteEndpoint::new(RouteChain::Cosmos, Some(options.network.clone())),
    )?;

    // Only the subject is created with the short period. A recovered subject inherits the
    // substitute's normal period, which keeps the governance/recovery window deterministic.
    trusting_period.restore()?;

    let script_path = project_root_path
        .join("chains")
        .join("cosmos")
        .join("scripts")
        .join("run_light_client_recovery.sh");
    let script = script_path
        .to_str()
        .ok_or_else(|| "Invalid recover-client script path".to_string())?;
    let project_root = project_root_path
        .to_str()
        .ok_or_else(|| "Invalid project root path".to_string())?;
    let trusting_period_seconds = subject_trusting_period_seconds.to_string();
    let expiry_timeout_seconds = TEST_EXPIRY_TIMEOUT_SECONDS.to_string();

    execute_script(
        project_root_path,
        script,
        Vec::new(),
        Some(vec![
            ("CARIBIC_PROJECT_ROOT", project_root),
            ("COSMOS_PROFILE", options.network.as_str()),
            ("CARDANO_CHAIN_ID", route.cardano_chain_id.as_str()),
            ("COSMOS_CHAIN_ID", options.cosmos_chain_id.as_str()),
            (
                "CARDANO_COSMOS_CHANNEL_ID",
                route.direct_channel_pair.a_channel_id.as_str(),
            ),
            (
                "COSMOS_CARDANO_CHANNEL_ID",
                route.direct_channel_pair.b_channel_id.as_str(),
            ),
            (
                "SUBJECT_TRUSTING_PERIOD_SECONDS",
                trusting_period_seconds.as_str(),
            ),
            (
                "RECOVERY_EXPIRY_TIMEOUT_SECONDS",
                expiry_timeout_seconds.as_str(),
            ),
        ]),
    )
    .map_err(|error| format!("Focused recover-client test failed: {error}"))?;

    logger::log(&format!(
        "PASS: recover-client preserved the {} Classic route",
        options.network
    ));
    Ok(())
}

fn local_subject_trusting_period(project_root_path: &Path) -> Result<u64, String> {
    let genesis_path = project_root_path.join("chains/cardano/devnet/genesis-shelley.json");
    let genesis_text = std::fs::read_to_string(&genesis_path).map_err(|error| {
        format!(
            "Could not read local Cardano genesis at {}: {error}",
            genesis_path.display()
        )
    })?;
    let genesis: serde_json::Value = serde_json::from_str(&genesis_text)
        .map_err(|error| format!("Could not parse {}: {error}", genesis_path.display()))?;
    let system_start = genesis
        .get("systemStart")
        .and_then(serde_json::Value::as_str)
        .ok_or_else(|| format!("{} has no systemStart", genesis_path.display()))?;
    let system_start_ms = DateTime::parse_from_rfc3339(system_start)
        .map_err(|error| format!("Invalid local Cardano systemStart '{system_start}': {error}"))?
        .timestamp_millis() as f64;
    let slot_length_seconds = genesis
        .get("slotLength")
        .and_then(serde_json::Value::as_f64)
        .filter(|value| value.is_finite() && *value > 0.0)
        .ok_or_else(|| format!("{} has no positive slotLength", genesis_path.display()))?;

    let tip_text = utils::get_cardano_tip_state(project_root_path)
        .map_err(|error| format!("Could not derive the local Cardano clock: {error}"))?;
    let tip: serde_json::Value = serde_json::from_str(&tip_text)
        .map_err(|error| format!("Could not parse local Cardano tip: {error}"))?;
    let tip_slot = tip
        .get("slot")
        .and_then(serde_json::Value::as_u64)
        .ok_or_else(|| "Local Cardano tip has no numeric slot".to_string())?;

    let cardano_tip_ms = system_start_ms + tip_slot as f64 * slot_length_seconds * 1_000.0;
    let clock_offset_ms = (Utc::now().timestamp_millis() as f64 - cardano_tip_ms).max(0.0);

    subject_trusting_period_for_clock_offset_ms(clock_offset_ms)
}

fn subject_trusting_period_for_clock_offset_ms(clock_offset_ms: f64) -> Result<u64, String> {
    if !clock_offset_ms.is_finite() || clock_offset_ms < 0.0 {
        return Err("Local Cardano clock offset is invalid".to_string());
    }
    let clock_offset_seconds = (clock_offset_ms / 1_000.0).ceil() as u64;

    clock_offset_seconds
        .checked_add(TEST_SUBJECT_ACTIVE_WINDOW_SECONDS)
        .ok_or_else(|| "Local Cardano clock offset overflowed the trusting period".to_string())
}

struct GatewayTrustingPeriodGuard {
    project_root: PathBuf,
    gateway_env: PathBuf,
    original: Option<String>,
    restored: bool,
}

impl GatewayTrustingPeriodGuard {
    fn new(project_root_path: &Path) -> Result<Self, String> {
        let gateway_env = project_root_path.join("cardano/gateway/.env");
        let original = setup::read_gateway_env_value(
            gateway_env.as_path(),
            "CARDANO_CLIENT_TRUSTING_PERIOD_SECONDS",
        )
        .map_err(|error| format!("Could not read Gateway trusting period: {error}"))?;

        Ok(Self {
            project_root: project_root_path.to_path_buf(),
            gateway_env,
            original,
            restored: false,
        })
    }

    fn apply(&mut self, value: &str) -> Result<(), String> {
        setup::set_or_append_env_var(
            self.gateway_env.as_path(),
            "CARDANO_CLIENT_TRUSTING_PERIOD_SECONDS",
            value,
        )
        .map_err(|error| format!("Could not set Gateway trusting period: {error}"))?;
        recreate_gateway(self.project_root.as_path())
    }

    fn restore(&mut self) -> Result<(), String> {
        if self.restored {
            return Ok(());
        }

        if let Some(original) = self.original.as_deref() {
            setup::set_or_append_env_var(
                self.gateway_env.as_path(),
                "CARDANO_CLIENT_TRUSTING_PERIOD_SECONDS",
                original,
            )
            .map_err(|error| format!("Could not restore Gateway trusting period: {error}"))?;
        } else {
            setup::remove_env_var(
                self.gateway_env.as_path(),
                "CARDANO_CLIENT_TRUSTING_PERIOD_SECONDS",
            )
            .map_err(|error| {
                format!("Could not remove temporary Gateway trusting period: {error}")
            })?;
        }
        recreate_gateway(self.project_root.as_path())?;
        self.restored = true;
        Ok(())
    }
}

impl Drop for GatewayTrustingPeriodGuard {
    fn drop(&mut self) {
        if self.restored {
            return;
        }

        if let Err(error) = self.restore() {
            logger::error(&format!(
                "Failed to restore Gateway trusting period after light-client test: {error}"
            ));
        }
    }
}

fn recreate_gateway(project_root_path: &Path) -> Result<(), String> {
    let gateway_dir = project_root_path.join("cardano/gateway");
    DockerCli::new(gateway_dir.as_path())
        .compose_ok(&["up", "-d", "--force-recreate", "app"])
        .map_err(|error| format!("Could not recreate Gateway: {error}"))?;

    for _ in 0..90 {
        let ready = Command::new("curl")
            .args(["-fsS", GATEWAY_READY_URL])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map(|status| status.success())
            .unwrap_or(false);
        if ready {
            return Ok(());
        }
        thread::sleep(Duration::from_secs(2));
    }

    Err(format!(
        "Gateway did not become proof-ready at {GATEWAY_READY_URL} after changing the test trusting period"
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Command;

    #[test]
    fn recover_client_defaults_to_v8_classic() {
        let options = LightClientTestOptions::resolve(LightClientTest::RecoverClient, None, None)
            .expect("default focused test options should resolve");

        assert_eq!(options.network, "v8-classic");
        assert_eq!(options.cosmos_chain_id, "v8-classic-1");
    }

    #[test]
    fn recover_client_accepts_v10_classic() {
        let options = LightClientTestOptions::resolve(
            LightClientTest::RecoverClient,
            Some(OptionalChainId::Cosmos),
            Some("v10-classic"),
        )
        .expect("v10 Classic focused test options should resolve");

        assert_eq!(options.cosmos_chain_id, "v10-classic-1");
    }

    #[test]
    fn recover_client_rejects_non_cosmos_and_v2() {
        assert!(LightClientTestOptions::resolve(
            LightClientTest::RecoverClient,
            Some(OptionalChainId::Osmosis),
            None,
        )
        .is_err());
        assert!(LightClientTestOptions::resolve(
            LightClientTest::RecoverClient,
            Some(OptionalChainId::Cosmos),
            Some("v10-v2"),
        )
        .is_err());
    }

    #[test]
    fn recovery_orchestration_script_is_present() {
        let script = include_str!("../../chains/cosmos/scripts/run_light_client_recovery.sh");
        assert!(script.contains("recover-client"));
        assert!(script.contains("PROPOSAL_STATUS_PASSED"));
        assert!(script.contains("SUBJECT_TRUSTING_PERIOD_SECONDS"));
    }

    #[test]
    fn recovery_orchestration_is_fail_closed() {
        let script = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../chains/cosmos/scripts/test_run_light_client_recovery.sh");
        let status = Command::new("bash")
            .arg(&script)
            .status()
            .expect("light-client recovery orchestration test should run");

        assert!(status.success(), "{} failed", script.display());
    }

    #[test]
    fn local_default_trusting_period_is_longer_than_the_subject_fixture() {
        let local_setup = include_str!("setup.rs");

        assert!(local_setup.contains("CARDANO_CLIENT_TRUSTING_PERIOD_SECONDS\", \"315360000"));
    }

    #[test]
    fn subject_window_is_added_to_the_local_clock_offset() {
        assert_eq!(
            subject_trusting_period_for_clock_offset_ms(250_001.0)
                .expect("clock offset should resolve"),
            851
        );
    }
}
