//! Capacity limits for public networks and local Caribic profiles.
//!
//! These constants are intentionally limited to transaction construction and
//! relay caps. The chain setup scripts hold the corresponding consensus and
//! staking limits and are covered by the drift tests below.
//! Local profiles support the larger probabilistic-client batches. Public
//! destinations require approved matching limits before using those batches.

/// A conservative relayer transaction-size cap below the public nodes' limits.
pub(crate) const HERMES_CONSERVATIVE_MAX_TX_SIZE: u64 = 1_000_000;

/// Hermes accepts at most 8 MiB per transaction. Local nodes allow 12 MiB.
/// Two admitted probabilistic headers fit below the smaller relayer cap.
pub(crate) const LOCAL_MAX_TX_SIZE: u64 = 8 * 1_048_576;

/// Match the larger block and transaction gas budgets in the local profiles.
pub(crate) const LOCAL_MAX_TX_GAS: u64 = 600_000_000;

/// Injective rejects transactions requesting more than this amount of gas.
pub(crate) const INJECTIVE_MAX_TX_GAS: u64 = 75_000_000;

/// Public Osmosis relay follows its block gas limit.
pub(crate) const OSMOSIS_MAX_TX_GAS: u64 = 300_000_000;

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::PathBuf;

    fn project_root() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .expect("caribic should be inside the repository")
            .to_path_buf()
    }

    fn read(relative: &str) -> String {
        fs::read_to_string(project_root().join(relative))
            .unwrap_or_else(|error| panic!("failed to read {relative}: {error}"))
    }

    #[test]
    fn local_cardano_capacity_matches_mainnet() {
        let properties = read("chains/cardano/devkit/node.properties");
        let parameters: std::collections::HashMap<_, _> = properties
            .lines()
            .filter_map(|line| line.split_once('='))
            .collect();
        for (key, expected) in [
            ("maxTxExUnitsMem", "16500000"),
            ("maxTxExUnitsSteps", "10000000000"),
            ("maxBlockExUnitsMem", "72000000"),
            ("maxBlockExUnitsSteps", "20000000000"),
            ("maxTxSize", "16384"),
            ("maxBlockBodySize", "90112"),
            ("maxBlockHeaderSize", "1100"),
        ] {
            assert_eq!(parameters.get(key).copied(), Some(expected), "{key}");
        }

        let ci = read(".github/workflows/ci.yml");
        assert!(ci.contains("run: deno task test:tx-budgets"));
        let fixture = read("cardano/offchain/src/testing/channel-fixture.ts");
        assert!(fixture.contains("chains/cardano/devkit/node.properties"));
        assert!(fixture.contains("maxTxSize: localLimit(\"maxTxSize\")"));
        assert!(fixture.contains("maxTxExMem: BigInt(localLimit(\"maxTxExUnitsMem\"))"));
        assert!(fixture.contains("maxTxExSteps: BigInt(localLimit(\"maxTxExUnitsSteps\"))"));
        // The DevKit smoke test checks its generated PlutusV3 cost model at runtime.
        assert_eq!(parameters.get("protocolMajorVer").copied(), Some("10"));
    }

    #[test]
    fn compatibility_profiles_support_probabilistic_catch_up() {
        let setup = read("chains/cosmos/scripts/setup_profile.sh");
        for expected in [
            "BLOCK_MAX_BYTES=16777216",
            "BLOCK_MAX_GAS=600000000",
            "EVIDENCE_MAX_AGE_NUM_BLOCKS=100000",
            "EVIDENCE_MAX_AGE_DURATION=172800000000000",
            "EVIDENCE_MAX_BYTES=1048576",
            "STAKING_UNBONDING_TIME=1814400s",
            "STAKING_MAX_VALIDATORS=45",
            "STAKING_MAX_ENTRIES=7",
            "STAKING_HISTORICAL_ENTRIES=10000",
            "MAX_TX_BYTES=12582912",
            "RPC_MAX_BODY_BYTES=20000000",
            "max-recv-msg-size = 16777216",
            "Preserved genesis does not match the probabilistic-client capacity profile",
        ] {
            assert!(setup.contains(expected), "missing {expected}");
        }
    }

    #[test]
    fn chain_specific_local_templates_support_probabilistic_catch_up() {
        let injective = read("chains/injective/scripts/setup_injective_local.sh");
        for expected in [
            "BLOCK_MAX_BYTES=16777216",
            "BLOCK_MAX_GAS=600000000",
            "EVIDENCE_MAX_AGE_NUM_BLOCKS=100000",
            "EVIDENCE_MAX_AGE_DURATION=172800000000000",
            "EVIDENCE_MAX_BYTES=1048576",
            "STAKING_UNBONDING_TIME=1814400s",
            "MAX_GAS_WANTED_PER_TX=600000000",
            "STAKING_MAX_VALIDATORS=45",
            "STAKING_MAX_ENTRIES=7",
            "STAKING_HISTORICAL_ENTRIES=10000",
            "MEMPOOL_MAX_TX_BYTES=12582912",
            "RPC_MAX_BODY_BYTES=20000000",
            "max-recv-msg-size = 16777216",
            "max_tx_bytes = ${MEMPOOL_MAX_TX_BYTES}",
            "max_body_bytes = ${RPC_MAX_BODY_BYTES}",
            "Injective genesis is missing app_state.txfees.params",
            ".app_state.txfees.params.max_gas_wanted_per_tx == $max_gas_wanted_per_tx",
            "Preserved genesis does not match the probabilistic-client capacity profile",
        ] {
            assert!(injective.contains(expected), "missing {expected}");
        }

        let osmosis = read("chains/osmosis/scripts/setup_osmosis_local.sh");
        for expected in [
            "BLOCK_MAX_BYTES=16777216",
            "BLOCK_MAX_GAS=600000000",
            "EVIDENCE_MAX_AGE_NUM_BLOCKS=100000",
            "EVIDENCE_MAX_AGE_DURATION=172800000000000",
            "EVIDENCE_MAX_BYTES=1048576",
            "STAKING_UNBONDING_TIME=1209600s",
            "STAKING_MAX_VALIDATORS=70",
            "STAKING_MAX_ENTRIES=7",
            "STAKING_HISTORICAL_ENTRIES=10000",
            "MEMPOOL_MAX_TX_BYTES=12582912",
            "RPC_MAX_BODY_BYTES=20000000",
            "max-recv-msg-size = 16777216",
            "max_tx_bytes = $MEMPOOL_MAX_TX_BYTES",
            "max_body_bytes = $RPC_MAX_BODY_BYTES",
            "'.app_state.gov.params.voting_period' -v '60s'",
            "'.app_state.gov.params.expedited_voting_period' -v '30s'",
            "'.app_state.epochs.epochs.[1].duration' -v \"60s\"",
            "'.app_state.poolincentives.lockable_durations.[0]' -v \"120s\"",
            "'.app_state.incentives.lockable_durations.[0]' -v \"1s\"",
        ] {
            assert!(osmosis.contains(expected), "missing {expected}");
        }

        let cheqd = read("chains/cheqd/scripts/generate_local_network.sh");
        for expected in [
            "BLOCK_MAX_BYTES = '16777216'",
            "BLOCK_MAX_GAS = '600000000'",
            "EVIDENCE_MAX_AGE_NUM_BLOCKS = '25920'",
            "EVIDENCE_MAX_AGE_DURATION = '259200000000000'",
            "EVIDENCE_MAX_BYTES = '5000'",
            "STAKING_UNBONDING_TIME = '1210000s'",
            "STAKING_MAX_VALIDATORS = 125",
            "STAKING_MAX_ENTRIES = 7",
            "STAKING_HISTORICAL_ENTRIES = 10000",
            "MEMPOOL_MAX_TX_BYTES = 12582912",
            "RPC_MAX_BODY_BYTES = 20000000",
            "max-recv-msg-size = 16777216",
            "r'^max_tx_bytes = .*$'",
            "r'^max_body_bytes = .*$'",
        ] {
            assert!(cheqd.contains(expected), "missing {expected}");
        }
    }
}
