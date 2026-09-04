//! Public-network capacity limits used by local Caribic profiles.
//!
//! These constants are intentionally limited to transaction construction and
//! relay caps. The chain setup scripts hold the corresponding consensus and
//! staking limits and are covered by the drift tests below.

/// A conservative relayer transaction-size cap below the public nodes' limits.
pub(crate) const HERMES_CONSERVATIVE_MAX_TX_SIZE: u64 = 1_000_000;

/// Injective rejects transactions requesting more than this amount of gas.
pub(crate) const INJECTIVE_MAX_TX_GAS: u64 = 75_000_000;

/// The local Osmosis profile models no lower per-transaction cap, so Hermes
/// follows the public block limit.
pub(crate) const OSMOSIS_MAX_TX_GAS: u64 = 300_000_000;

/// The local cheqd profile models no lower per-transaction cap, so Hermes
/// follows the public block limit.
pub(crate) const CHEQD_MAX_TX_GAS: u64 = 30_000_000;

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::PathBuf;

    use serde_json::Value;

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
        let alonzo: Value =
            serde_json::from_str(&read("chains/cardano/config/devnet/genesis-alonzo.json"))
                .expect("local Alonzo genesis should be JSON");
        assert_eq!(alonzo["maxTxExUnits"]["exUnitsMem"], 16_500_000);
        assert_eq!(alonzo["maxTxExUnits"]["exUnitsSteps"], 10_000_000_000_u64);
        assert_eq!(alonzo["maxBlockExUnits"]["exUnitsMem"], 72_000_000);
        assert_eq!(
            alonzo["maxBlockExUnits"]["exUnitsSteps"],
            20_000_000_000_u64
        );

        let shelley: Value =
            serde_json::from_str(&read("chains/cardano/config/devnet/genesis-shelley.json"))
                .expect("local Shelley genesis should be JSON");
        assert_eq!(shelley["protocolParams"]["maxTxSize"], 16_384);
        assert_eq!(shelley["protocolParams"]["maxBlockBodySize"], 90_112);
        assert_eq!(shelley["protocolParams"]["maxBlockHeaderSize"], 1_100);

        let ci = read(".github/workflows/ci.yml");
        assert!(ci.contains("CARDANO_TX_BUDGET_MAX_TX_EX_MEM: 16500000"));
        assert!(ci.contains("CARDANO_TX_BUDGET_MAX_TX_EX_STEPS: 10000000000"));
    }

    #[test]
    fn local_cardano_plutus_v3_cost_model_supports_protocol_version() {
        let shelley: Value =
            serde_json::from_str(&read("chains/cardano/config/devnet/genesis-shelley.json"))
                .expect("local Shelley genesis should be JSON");
        let protocol_major = shelley["protocolParams"]["protocolVersion"]["major"]
            .as_u64()
            .expect("local Shelley genesis should declare a protocol major version");

        let conway: Value =
            serde_json::from_str(&read("chains/cardano/config/devnet/genesis-conway.json"))
                .expect("local Conway genesis should be JSON");
        let plutus_v3_cost_model = conway["plutusV3CostModel"]
            .as_array()
            .expect("local Conway genesis should declare a PlutusV3 cost model");

        assert!(
            protocol_major < 10 || plutus_v3_cost_model.len() >= 297,
            "Cardano protocol version {protocol_major} requires the 297-entry PlutusV3 PV10 cost model, but the local Conway genesis has {} entries",
            plutus_v3_cost_model.len()
        );
    }

    #[test]
    fn compatibility_profiles_use_injective_capacity_limits() {
        let setup = read("chains/cosmos/scripts/setup_profile.sh");
        for expected in [
            "BLOCK_MAX_BYTES=4194304",
            "BLOCK_MAX_GAS=150000000",
            "EVIDENCE_MAX_AGE_NUM_BLOCKS=100000",
            "EVIDENCE_MAX_AGE_DURATION=172800000000000",
            "EVIDENCE_MAX_BYTES=1048576",
            "STAKING_UNBONDING_TIME=1814400s",
            "STAKING_MAX_VALIDATORS=45",
            "STAKING_MAX_ENTRIES=7",
            "STAKING_HISTORICAL_ENTRIES=10000",
            "MAX_TX_BYTES=1048576",
            "RPC_MAX_BODY_BYTES=4000000",
            "Preserved genesis does not match the pinned Injective capacity snapshot",
        ] {
            assert!(setup.contains(expected), "missing {expected}");
        }
    }

    #[test]
    fn chain_specific_local_templates_pin_public_capacity_limits() {
        let injective = read("chains/injective/scripts/setup_injective_local.sh");
        for expected in [
            "BLOCK_MAX_BYTES=4194304",
            "BLOCK_MAX_GAS=150000000",
            "EVIDENCE_MAX_AGE_NUM_BLOCKS=100000",
            "EVIDENCE_MAX_AGE_DURATION=172800000000000",
            "EVIDENCE_MAX_BYTES=1048576",
            "STAKING_UNBONDING_TIME=1814400s",
            "MAX_GAS_WANTED_PER_TX=75000000",
            "STAKING_MAX_VALIDATORS=45",
            "STAKING_MAX_ENTRIES=7",
            "STAKING_HISTORICAL_ENTRIES=10000",
            "MEMPOOL_MAX_TX_BYTES=1048576",
            "RPC_MAX_BODY_BYTES=4000000",
            "max_tx_bytes = ${MEMPOOL_MAX_TX_BYTES}",
            "max_body_bytes = ${RPC_MAX_BODY_BYTES}",
            "Injective genesis is missing app_state.txfees.params",
            ".app_state.txfees.params.max_gas_wanted_per_tx == $max_gas_wanted_per_tx",
            "Preserved genesis does not match the pinned Injective mainnet capacity snapshot",
        ] {
            assert!(injective.contains(expected), "missing {expected}");
        }

        let osmosis = read("chains/osmosis/scripts/setup_osmosis_local.sh");
        for expected in [
            "BLOCK_MAX_BYTES=3000000",
            "BLOCK_MAX_GAS=300000000",
            "EVIDENCE_MAX_AGE_NUM_BLOCKS=100000",
            "EVIDENCE_MAX_AGE_DURATION=172800000000000",
            "EVIDENCE_MAX_BYTES=1048576",
            "STAKING_UNBONDING_TIME=1209600s",
            "STAKING_MAX_VALIDATORS=70",
            "STAKING_MAX_ENTRIES=7",
            "STAKING_HISTORICAL_ENTRIES=10000",
            "MEMPOOL_MAX_TX_BYTES=1048576",
            "RPC_MAX_BODY_BYTES=4000000",
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
            "BLOCK_MAX_BYTES = '3000000'",
            "BLOCK_MAX_GAS = '30000000'",
            "EVIDENCE_MAX_AGE_NUM_BLOCKS = '25920'",
            "EVIDENCE_MAX_AGE_DURATION = '259200000000000'",
            "EVIDENCE_MAX_BYTES = '5000'",
            "STAKING_UNBONDING_TIME = '1210000s'",
            "STAKING_MAX_VALIDATORS = 125",
            "STAKING_MAX_ENTRIES = 7",
            "STAKING_HISTORICAL_ENTRIES = 10000",
            "MEMPOOL_MAX_TX_BYTES = 1048576",
            "RPC_MAX_BODY_BYTES = 4000000",
            "r'^max_tx_bytes = .*$'",
            "r'^max_body_bytes = .*$'",
        ] {
            assert!(cheqd.contains(expected), "missing {expected}");
        }
    }
}
