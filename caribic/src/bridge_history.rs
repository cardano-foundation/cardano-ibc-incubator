use crate::config::CoreCardanoNetwork;
use serde::Deserialize;
use std::path::Path;

#[derive(Clone, Debug, Deserialize, PartialEq)]
pub struct HistoryPoint {
    pub slot: u64,
    pub block_hash: String,
    pub block_height: u64,
}

#[derive(Deserialize)]
struct Anchor {
    tx_hash: String,
    output_index: u64,
}

#[derive(Deserialize)]
struct History {
    format: String,
    start: HistoryPoint,
    host_state_nft_mint: Anchor,
}

#[derive(Deserialize)]
struct Manifest {
    cardano: Cardano,
    history: History,
}

#[derive(Deserialize)]
struct Cardano {
    network_magic: u64,
    chain_id: String,
}

pub fn read_checkpoint(path: &Path, network: CoreCardanoNetwork) -> Result<HistoryPoint, String> {
    parse_checkpoint(
        &std::fs::read_to_string(path)
            .map_err(|e| format!("Cannot read bridge manifest {}: {e}", path.display()))?,
        network,
    )
}

fn parse_checkpoint(json: &str, network: CoreCardanoNetwork) -> Result<HistoryPoint, String> {
    let manifest: Manifest = serde_json::from_str(json).map_err(|e| format!("Bridge manifest requires a cardano-history-v1 replay checkpoint and HostState creation output; upgrade it from retained chain history: {e}"))?;
    let (magic, chain_id) = match network {
        CoreCardanoNetwork::Preprod => (1, "cardano-preprod"),
        CoreCardanoNetwork::Preview => (2, "cardano-preview"),
        CoreCardanoNetwork::Local => {
            return Err("Explicit public history checkpoint expected".into())
        }
    };
    if manifest.cardano.network_magic != magic || manifest.cardano.chain_id != chain_id {
        return Err("Bridge manifest belongs to a different Cardano network".into());
    }
    let hash = |s: &str| {
        s.len() == 64
            && s.bytes()
                .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
    };
    let h = manifest.history;
    if h.format != "cardano-history-v1"
        || h.start.slot == 0
        || h.start.slot > 9_007_199_254_740_991
        || h.start.block_height > 9_007_199_254_740_991
        || !hash(&h.start.block_hash)
        || !hash(&h.host_state_nft_mint.tx_hash)
        || h.host_state_nft_mint.output_index > 9_007_199_254_740_991
    {
        return Err("Invalid or unsupported bridge history bootstrap".into());
    }
    Ok(h.start)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn manifest() -> serde_json::Value {
        serde_json::json!({"cardano":{"network_magic":2,"chain_id":"cardano-preview"},"history":{"format":"cardano-history-v1","start":{"slot":123,"block_hash":"ab".repeat(32),"block_height":10},"host_state_nft_mint":{"tx_hash":"cd".repeat(32),"output_index":0}}})
    }
    #[test]
    fn checkpoint_is_deployment_stable_not_relative_to_todays_tip() {
        let point = parse_checkpoint(&manifest().to_string(), CoreCardanoNetwork::Preview).unwrap();
        assert_eq!(point.slot, 123);
        assert_eq!(point.block_height, 10);
    }
    #[test]
    fn missing_unsupported_malformed_and_wrong_network_manifests_fail() {
        let m = manifest();
        assert!(parse_checkpoint(&m.to_string(), CoreCardanoNetwork::Preprod).is_err());
        for (field, value) in [
            ("format", serde_json::json!("future")),
            ("start", serde_json::json!("origin")),
            (
                "host_state_nft_mint",
                serde_json::json!({"tx_hash":"bad","output_index":0}),
            ),
        ] {
            let mut invalid = m.clone();
            invalid["history"][field] = value;
            assert!(parse_checkpoint(&invalid.to_string(), CoreCardanoNetwork::Preview).is_err());
        }
        let mut old = m;
        old.as_object_mut().unwrap().remove("history");
        assert!(parse_checkpoint(&old.to_string(), CoreCardanoNetwork::Preview).is_err());
    }
}
