use aiken/primitive/bytearray
use ibc/client/ics_007_tendermint_client/client_datum.{
  ClientDatum, ClientDatumState,
}
use ibc/client/ics_007_tendermint_client/client_state.{ClientState}
use ibc/client/ics_007_tendermint_client/cometbft/protos/upgrade_pb
use ibc/client/ics_007_tendermint_client/consensus_state.{ConsensusState}
use ibc/client/ics_007_tendermint_client/height
use ibc/core/ics_002_client_semantics/types/client.{Active}
use ibc/core/ics_023_vector_commitments/merkle.{
  MerklePath, MerkleProof, MerkleRoot,
}
use ibc/utils/string

pub type Upgrade {
  client_state: ClientState,
  consensus_state: ConsensusState,
  proof_client: MerkleProof,
  proof_consensus: MerkleProof,
  history_siblings: List<ByteArray>,
}

pub fn path(
  segments: List<ByteArray>,
  old_height: Int,
  key: ByteArray,
) -> List<ByteArray> {
  when segments is {
    [] -> fail
    [last] ->
      [
        bytearray.concat(
          last,
          bytearray.concat(
            "/",
            bytearray.concat(
              string.int_to_string(old_height),
              bytearray.concat("/", key),
            ),
          ),
        ),
      ]
    [first, ..rest] -> [first, ..path(rest, old_height, key)]
  }
}

/// ICS-07 upgrade, using the old client's tip and proof rules as the authority.
/// TODO: differential tests against live SDK upgrade-store proofs and an
/// independent audit of malicious upgrade plans before production deployment.
pub fn verify(
  input: ClientDatum,
  output: ClientDatum,
  upgrade: Upgrade,
  now: Int,
) -> Bool {
  let old = input.state.client_state
  expect client_datum.has_singleton_history(input)
  expect client_state.status(old, now, input.state.consensus_states) == Active
  expect [Pair(_, trusted)] = input.state.consensus_states
  expect trusted.root.hash != "sentinel_root"
  let proposed = upgrade.client_state
  expect height.compare(proposed.latest_height, old.latest_height) == Greater
  let next =
    ClientState {
      ..proposed,
      trust_level: old.trust_level,
      trusting_period: old.trusting_period,
      max_clock_drift: old.max_clock_drift,
      frozen_height: height.zero_height(),
    }
  // Preserve the v8 ICS-07 trust parameters. A shorter unbonding period must
  // still exceed the existing trusting period, otherwise reject the upgrade.
  expect client_state.validate(next)
  let kernel = upgrade.consensus_state
  expect kernel.timestamp > 0
  expect bytearray.length(kernel.next_validators_hash) == 32
  expect kernel.timestamp >= trusted.timestamp
  expect kernel.timestamp <= now + old.max_clock_drift
  expect !client_state.is_expired(next, kernel.timestamp, now)
  expect
    merkle.verify_membership(
      upgrade.proof_client,
      old.proof_specs,
      trusted.root,
      MerklePath {
        key_path: path(
          old.upgrade_path,
          old.latest_height.revision_height,
          "upgradedClient",
        ),
      },
      upgrade_pb.client(proposed),
    )
  expect
    merkle.verify_membership(
      upgrade.proof_consensus,
      old.proof_specs,
      trusted.root,
      MerklePath {
        key_path: path(
          old.upgrade_path,
          old.latest_height.revision_height,
          "upgradedConsState",
        ),
      },
      upgrade_pb.consensus(kernel),
    )
  let next_height = next.latest_height
  and {
    output.token == input.token,
    output.state == ClientDatumState {
      client_state: next,
      consensus_states: [
        Pair(
          next_height,
          ConsensusState {
            ..kernel,
            root: MerkleRoot { hash: "sentinel_root" },
          },
        ),
      ],
      processed_times: [Pair(next_height, now)],
      processed_heights: [
        Pair(next_height, client_datum.processed_height_from_time(now)),
      ],
    },
  }
}
