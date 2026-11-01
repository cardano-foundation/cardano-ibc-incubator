use aiken/builtin
use aiken/collection/list
use aiken/primitive/bytearray
use ibc/client/ics_007_tendermint_client/cached/general
use ibc/client/ics_007_tendermint_client/cached/packed
use ibc/client/ics_007_tendermint_client/cached/proof
use ibc/client/ics_007_tendermint_client/cached/types.{
  Full, Leaf, PowerChange, Powers, Record, Update, max_records, max_signers,
}
use ibc/client/ics_007_tendermint_client/cached/vote_encoding
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
      let key = leaf.pubkey
      expect checked_signature(key, sig, prefix, suffix)
      leaf.power + signatures(rest, remaining, prefix, suffix)
    }
  }
}

fn checked_signature(
  key: ByteArray,
  sig: CommitSig,
  prefix: ByteArray,
  suffix: ByteArray,
) -> Bool {
  and {
    sig.block_id_flag == 2,
    sig.validator_address == proof.address(key),
    builtin.verify_ed25519_signature(
      key,
      vote_encoding.commit_sign_bytes(prefix, suffix, sig.timestamp),
      sig.signature,
    ),
  }
}

fn power_signatures(
  leaves: List<PowerChange>,
  positions: List<Int>,
  sigs: List<CommitSig>,
  prefix: ByteArray,
  suffix: ByteArray,
  new_power: Int,
  old_power: Int,
) -> (Int, Int) {
  when positions is {
    [] -> {
      expect sigs == []
      (new_power, old_power)
    }
    [index, ..rest] -> {
      expect [leaf, ..tail] = leaves
      expect index >= leaf.index
      if index == leaf.index {
        expect [sig, ..remaining] = sigs
        expect checked_signature(leaf.pubkey, sig, prefix, suffix)
        power_signatures(
          tail,
          rest,
          remaining,
          prefix,
          suffix,
          new_power + leaf.new_power,
          old_power + leaf.old_power,
        )
      } else {
        power_signatures(
          tail,
          positions,
          sigs,
          prefix,
          suffix,
          new_power,
          old_power,
        )
      }
    }
  }
}

fn full_signatures(
  vector: ByteArray,
  count: Int,
  positions: List<Int>,
  sigs: List<CommitSig>,
  prefix: ByteArray,
  suffix: ByteArray,
  previous: Int,
  power: Int,
  mask: ByteArray,
) -> (Int, ByteArray) {
  when positions is {
    [] -> {
      expect sigs == []
      (power, mask)
    }
    [index, ..rest] -> {
      expect index > previous && index >= 0 && index < count
      expect [sig, ..remaining] = sigs
      expect
        checked_signature(general.key_at_validated(vector, index), sig, prefix, suffix)
      full_signatures(
        vector,
        count,
        rest,
        remaining,
        prefix,
        suffix,
        index,
        power + general.power_at_validated(vector, index),
        builtin.write_bits(mask, [index], True),
      )
    }
  }
}

fn authenticate_cached(
  records: List<Record>,
  update: Update,
  trusted_root: ByteArray,
  prefix: ByteArray,
  suffix: ByteArray,
) -> (Record, Int, Option<(Record, Int)>) {
  when update.sets is {
    [] -> {
      let target = find(records, update.signed_header.header.validators_hash)
      expect
        proof.root(target.count, update.target, update.target_siblings) == target.root
      let signed_power =
        signatures(
          update.target,
          update.signed_header.commit.signatures,
          prefix,
          suffix,
        )
      if target.root == trusted_root {
        expect update.trusted == [] && update.trusted_siblings == []
        (target, signed_power, None)
      } else {
        let trusted = find(records, trusted_root)
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
        let overlap =
          list.foldl(update.trusted, 0, fn(leaf, total) { total + leaf.power })
        (target, signed_power, Some((trusted, overlap)))
      }
    }
    [Powers { old_root, leaves, siblings, signers }] -> {
      expect old_root == trusted_root
      expect
        update.target == [] && update.target_siblings == [] && update.trusted == [] && update.trusted_siblings == []
      let trusted = find(records, old_root)
      let target = proof.powers(trusted, leaves, siblings)
      let (signed_power, overlap) =
        power_signatures(
          leaves,
          signers,
          update.signed_header.commit.signatures,
          prefix,
          suffix,
          0,
          0,
        )
      (target, signed_power, Some((trusted, overlap)))
    }
    _ -> fail
  }
}

fn authenticate_full(
  _records: List<Record>,
  update: Update,
  trusted_root: ByteArray,
  prefix: ByteArray,
  suffix: ByteArray,
) -> (Record, Int, Option<(Record, Int)>) {
  expect [Full { leaves, trusted, signers, pubkey_order }] = update.sets
  expect
    update.target == [] && update.target_siblings == [] && update.trusted == [] && update.trusted_siblings == []
  let (target, vector) = packed.target(leaves, pubkey_order)
  let (signed_power, mask) =
    full_signatures(
      vector,
      target.count,
      signers,
      update.signed_header.commit.signatures,
      prefix,
      suffix,
      -1,
      0,
      builtin.integer_to_bytearray(True, 32, 0),
    )
  if target.root == trusted_root {
    expect trusted == #""
    (target, signed_power, None)
  } else {
    let (old, overlap) =
      general.trusted_packed(target.count, vector, trusted, mask)
    expect old.root == trusted_root
    (target, signed_power, Some((old, overlap)))
  }
}

fn header_with(
  client: ClientDatum,
  time: TxTime,
  records: List<Record>,
  update: Update,
  authenticate: fn(List<Record>, Update, ByteArray, ByteArray, ByteArray) ->
    (Record, Int, Option<(Record, Int)>),
) -> List<Record> {
  let cs = client.state.client_state
  expect client_datum.has_singleton_history(client)
  expect [Pair(trusted_height, consensus)] = client.state.consensus_states
  expect trusted_height == update.trusted_height
  expect
    client_state.status(cs, time.valid_to, client.state.consensus_states) == Active
  let signed = update.signed_header
  let tm = signed.header
  expect list.length(update.target) <= max_signers
  expect list.length(signed.commit.signatures) <= max_signers
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
  let (prefix, suffix) = vote.commit_sign_parts(signed.commit, cs.chain_id)
  let (target, signed_power, old_overlap) =
    authenticate(
      records,
      update,
      consensus.next_validators_hash,
      prefix,
      suffix,
    )
  expect target.root == tm.validators_hash
  expect signed_power * 3 > target.total_power * 2
  if tm.height == update.trusted_height.revision_height + 1 {
    expect target.root == consensus.next_validators_hash
  } else if target.root == consensus.next_validators_hash {
    expect
      signed_power * cs.trust_level.denominator > target.total_power * cs.trust_level.numerator
  } else {
    expect Some((trusted, overlap)) = old_overlap
    expect trusted.root == consensus.next_validators_hash
    expect
      overlap * cs.trust_level.denominator > trusted.total_power * cs.trust_level.numerator
  }
  let records =
    when old_overlap is {
      None -> records
      Some((trusted, _)) -> rotate(records, trusted)
    }
  rotate(records, target)
}

pub fn header(
  client: ClientDatum,
  time: TxTime,
  records: List<Record>,
  update: Update,
) -> List<Record> {
  header_with(client, time, records, update, authenticate_cached)
}

pub fn header_full(
  client: ClientDatum,
  time: TxTime,
  records: List<Record>,
  update: Update,
) -> List<Record> {
  header_with(client, time, records, update, authenticate_full)
}
