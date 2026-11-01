use aiken/builtin
use aiken/collection/list
use aiken/primitive/bytearray
use ibc/client/ics_007_tendermint_client/cached/proof
use ibc/client/ics_007_tendermint_client/cached/types.{
  Leaf, Powers, Record, Update, max_records, max_signers,
}
use ibc/client/ics_007_tendermint_client/client_datum.{ClientDatum}
use ibc/client/ics_007_tendermint_client/client_state
use ibc/client/ics_007_tendermint_client/cometbft/block/block_id
use ibc/client/ics_007_tendermint_client/cometbft/block/commit_sig.{CommitSig}
use ibc/client/ics_007_tendermint_client/cometbft/block/header as tm_header
use ibc/client/ics_007_tendermint_client/cometbft/vote
use ibc/client/ics_007_tendermint_client/height
use ibc/core/ics_002_client_semantics/types/client.{Active}
use ibc/utils/tx_time.{TxTime}

pub fn find(records: List<Record>, root: ByteArray) -> Record {
  expect Some(record) = list.find(records, fn(record) { record.root == root })
  record
}

pub fn rotate(records: List<Record>, record: Record) -> List<Record> {
  [record, ..list.filter(records, fn(old) { old.root != record.root })]
    |> list.take(max_records)
}

fn signatures(
  leaves: List<Leaf>,
  sigs: List<CommitSig>,
  prefix: ByteArray,
  suffix: ByteArray,
) -> Int {
  when leaves is {
    [] -> {
      expect sigs == []
      0
    }
    [leaf, ..rest] -> {
      expect [sig, ..remaining] = sigs
      expect sig.block_id_flag == 2
      expect sig.validator_address == proof.address(leaf.pubkey)
      expect
        builtin.verify_ed25519_signature(
          leaf.pubkey,
          vote.commit_sign_bytes(prefix, suffix, sig.timestamp),
          sig.signature,
        )
      leaf.power + signatures(rest, remaining, prefix, suffix)
    }
  }
}

pub fn header(
  client: ClientDatum,
  time: TxTime,
  records: List<Record>,
  update: Update,
) -> List<Record> {
  let cs = client.state.client_state
  expect client_datum.has_singleton_history(client)
  expect [Pair(trusted_height, consensus)] = client.state.consensus_states
  // The first bounded path trusts the live checkpoint. Historical and
  // conflicting-header evidence retain the existing staged path.
  expect trusted_height == update.trusted_height
  expect
    client_state.status(cs, time.valid_to, client.state.consensus_states) == Active
  let signed = update.signed_header
  let tm = signed.header
  expect list.length(update.target) <= max_signers
  expect tm_header.validate_basic(tm)
  expect tm.chain_id == cs.chain_id
  expect signed.commit.height == tm.height && signed.commit.round >= 0
  expect tm_header.hash(tm) == signed.commit.block_id.hash
  expect block_id.validate_basic(signed.commit.block_id)
  expect bytearray.length(tm.next_validators_hash) == 32
  expect
    height.parse_chain_id(tm.chain_id) == update.trusted_height.revision_number
  expect tm.height > cs.latest_height.revision_height
  expect tm.time > consensus.timestamp
  expect tm.time < time.valid_from + cs.max_clock_drift
  expect consensus.timestamp + cs.trusting_period > time.valid_to
  let (target, authenticated_overlap) =
    when update.sets is {
      [] -> {
        let target = find(records, tm.validators_hash)
        expect
          proof.root(target.count, update.target, update.target_siblings) == target.root
        (target, 0)
      }
      [Powers { old_root, leaves, siblings }] -> {
        // This single transition must start at the actual trusted checkpoint.
        // No independently supplied target/trusted proof can replace its leaves.
        expect old_root == consensus.next_validators_hash
        expect
          update.target_siblings == [] && update.trusted == [] && update.trusted_siblings == []
        let old = find(records, old_root)
        let (target, overlap) =
          proof.shared_powers(old, leaves, siblings, update.target)
        expect target.root == tm.validators_hash
        (target, overlap)
      }
      _ -> fail
    }
  let (prefix, suffix) = vote.commit_sign_parts(signed.commit, cs.chain_id)
  let signed_power =
    signatures(update.target, signed.commit.signatures, prefix, suffix)
  expect signed_power * 3 > target.total_power * 2
  if tm.height == update.trusted_height.revision_height + 1 {
    expect target.root == consensus.next_validators_hash
    expect update.trusted == [] && update.trusted_siblings == []
  } else if target.root == consensus.next_validators_hash {
    expect update.trusted == [] && update.trusted_siblings == []
    expect
      signed_power * cs.trust_level.denominator > target.total_power * cs.trust_level.numerator
  } else {
    let trusted = find(records, consensus.next_validators_hash)
    let overlap =
      if update.sets == [] {
        expect list.length(update.trusted) <= max_signers
        expect
          proof.root(trusted.count, update.trusted, update.trusted_siblings) == trusted.root
        expect
          list.all(
            update.trusted,
            fn(leaf) {
              list.any(
                update.target,
                fn(signer) { signer.pubkey == leaf.pubkey },
              )
            },
          )
        list.foldl(update.trusted, 0, fn(leaf, total) { total + leaf.power })
      } else {
        authenticated_overlap
      }
    expect
      overlap * cs.trust_level.denominator > trusted.total_power * cs.trust_level.numerator
  }
  rotate(records, target)
}
