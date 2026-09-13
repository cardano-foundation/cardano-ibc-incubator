use std::{collections::BTreeMap, fs, path::Path};

use chrono::{DateTime, Duration, SecondsFormat};
use serde_json::{json, Value};

use super::config::CosmosProfileConfig;

const DEFAULT_GENESIS_TIME: &str = "2025-12-31T23:59:00Z";
const MARKER: &str = ".caribic-local-clock.json";

#[derive(Debug, PartialEq)]
pub(super) enum FixtureClock {
    Real,
    Devkit {
        offset: String,
        genesis_time: String,
        network_id: String,
    },
}

impl FixtureClock {
    pub(super) fn selected(root: &Path, profile: CosmosProfileConfig) -> Result<Self, String> {
        if !crate::local_runtime::is_devkit(root) {
            return Ok(Self::Real);
        }
        if profile.name != "v8-classic" {
            return Err(format!(
                "The DevKit clock is currently supported only by the local v8-classic Cosmos fixture, not {}. Use v8-classic or the legacy Cardano runtime",
                profile.name
            ));
        }
        Self::from_endpoints(&crate::local_runtime::environment(root, false)?)
    }

    fn from_endpoints(values: &BTreeMap<String, String>) -> Result<Self, String> {
        let required = |key: &str| {
            values.get(key).filter(|value| !value.is_empty()).cloned().ok_or_else(|| {
                format!("DevKit {key} is missing. Start the DevKit network before its Cosmos fixture")
            })
        };
        let offset = required("CARDANO_LOCAL_CLOCK_OFFSET")?;
        let seconds = offset
            .strip_suffix('s')
            .filter(|value| value.starts_with(['+', '-']))
            .and_then(|value| value.parse::<i64>().ok())
            .filter(|value| value.checked_mul(1_000_000_000).is_some())
            .ok_or("DevKit clock offset must be a signed integer number of seconds")?;
        if offset != format!("{seconds:+}s") {
            return Err("DevKit clock offset must use canonical signed seconds".into());
        }
        let system_start = required("CARDANO_SYSTEM_START")?;
        let system_start = DateTime::parse_from_rfc3339(&system_start)
            .map_err(|error| format!("Invalid DevKit system start: {error}"))?;
        let genesis_time = system_start
            .checked_sub_signed(Duration::seconds(60))
            .ok_or("DevKit system start is out of range")?
            .with_timezone(&chrono::Utc)
            .to_rfc3339_opts(SecondsFormat::Secs, true);
        Ok(Self::Devkit {
            offset,
            genesis_time,
            network_id: required("CARDANO_LOCAL_NETWORK_ID")?,
        })
    }

    fn binding(&self) -> Value {
        match self {
            Self::Real => json!({"mode": "real"}),
            Self::Devkit {
                offset,
                genesis_time,
                network_id,
            } => json!({
                "mode": "devkit", "offset": offset,
                "cardano_network_id": network_id, "cosmos_genesis_time": genesis_time,
            }),
        }
    }

    pub(super) fn validate_retained_state(&self, state_dir: &Path) -> Result<(), String> {
        let marker = state_dir.join(MARKER);
        let genesis_exists = state_dir.join("config/genesis.json").exists();
        if !genesis_exists && !marker.exists() {
            return Ok(());
        }
        if !marker.exists() && matches!(self, Self::Real) {
            // Existing real-clock homes predate the optional clock binding.
            return Ok(());
        }
        let actual = fs::read_to_string(marker)
            .ok()
            .and_then(|contents| serde_json::from_str::<Value>(&contents).ok());
        if actual.as_ref() != Some(&self.binding()) {
            return Err(format!(
                "Cosmos state at {} belongs to another local clock or Cardano network. Restart this Cosmos profile with --chain-flag stateful=false to reset its state",
                state_dir.display()
            ));
        }
        Ok(())
    }

    pub(super) fn environment(&self) -> Vec<(&'static str, String)> {
        let (mode, enabled, offset, network, genesis, image) = match self {
            Self::Real => (
                "real",
                "0",
                "",
                "",
                DEFAULT_GENESIS_TIME,
                "local:cardano-ibc-v8-classic",
            ),
            Self::Devkit {
                offset,
                genesis_time,
                network_id,
            } => (
                "devkit",
                "1",
                offset.as_str(),
                network_id.as_str(),
                genesis_time.as_str(),
                "local:cardano-ibc-v8-classic-devkit-clock",
            ),
        };
        vec![
            ("COSMOS_LOCAL_CLOCK_MODE", mode.to_owned()),
            ("COSMOS_LOCAL_CLOCK_BUILD", enabled.to_owned()),
            ("DEVKIT_CLOCK_OFFSET", offset.to_owned()),
            ("COSMOS_LOCAL_CARDANO_NETWORK_ID", network.to_owned()),
            ("COSMOS_GENESIS_TIME", genesis.to_owned()),
            ("COSMOS_V8_CLASSIC_IMAGE", image.to_owned()),
        ]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> FixtureClock {
        FixtureClock::from_endpoints(&BTreeMap::from([
            ("CARDANO_LOCAL_CLOCK_OFFSET".into(), "-22178336s".into()),
            ("CARDANO_SYSTEM_START".into(), "2025-12-31T00:00:00Z".into()),
            (
                "CARDANO_LOCAL_NETWORK_ID".into(),
                "first-network-instance".into(),
            ),
        ]))
        .unwrap()
    }

    #[test]
    fn devkit_genesis_precedes_cardano_and_uses_a_separate_image() {
        let environment: BTreeMap<_, _> = fixture().environment().into_iter().collect();
        assert_eq!(environment["COSMOS_GENESIS_TIME"], "2025-12-30T23:59:00Z");
        assert_eq!(environment["DEVKIT_CLOCK_OFFSET"], "-22178336s");
        assert_ne!(
            environment["COSMOS_V8_CLASSIC_IMAGE"],
            FixtureClock::Real
                .environment()
                .into_iter()
                .collect::<BTreeMap<_, _>>()["COSMOS_V8_CLASSIC_IMAGE"]
        );
    }

    #[test]
    fn preserved_clock_cannot_be_reused_after_a_reset_or_provider_change() {
        let root =
            std::env::temp_dir().join(format!("caribic-cosmos-clock-{}", std::process::id()));
        fs::create_dir_all(root.join("config")).unwrap();
        fs::write(root.join("config/genesis.json"), "{}").unwrap();
        assert!(FixtureClock::Real.validate_retained_state(&root).is_ok());
        let first = fixture();
        assert!(first.validate_retained_state(&root).is_err());
        fs::write(root.join(MARKER), first.binding().to_string()).unwrap();
        assert!(first.validate_retained_state(&root).is_ok());
        assert!(FixtureClock::Real.validate_retained_state(&root).is_err());
        let FixtureClock::Devkit {
            offset,
            genesis_time,
            ..
        } = first
        else {
            unreachable!()
        };
        let reset = FixtureClock::Devkit {
            offset,
            genesis_time,
            network_id: "second-network-instance".into(),
        };
        assert!(reset
            .validate_retained_state(&root)
            .unwrap_err()
            .contains("--chain-flag stateful=false"));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn devkit_clock_is_restricted_to_the_verified_local_profile() {
        use super::super::config::CosmosTestProfile;
        let root = std::env::temp_dir().join(format!(
            "caribic-cosmos-clock-selection-{}",
            std::process::id()
        ));
        fs::create_dir_all(root.join(".caribic")).unwrap();
        fs::create_dir_all(root.join("chains/cardano")).unwrap();
        fs::write(root.join(".caribic/local-runtime"), "devkit\n").unwrap();
        fs::write(root.join("chains/cardano/.caribic-network"), "local\n").unwrap();
        assert!(
            FixtureClock::selected(&root, *CosmosTestProfile::V10Classic.config())
                .unwrap_err()
                .contains("only")
        );
        assert!(FixtureClock::selected(&root, *CosmosTestProfile::V8Classic.config()).is_err());
        fs::write(root.join("chains/cardano/.caribic-network"), "preprod\n").unwrap();
        assert_eq!(
            FixtureClock::selected(&root, *CosmosTestProfile::V10Classic.config()).unwrap(),
            FixtureClock::Real
        );
        fs::remove_dir_all(root).unwrap();
    }
}
