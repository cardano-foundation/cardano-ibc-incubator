use aiken/collection/list
use cardano/address.{Address}
use ibc/auth.{AuthToken}
use ibc/client/ics_007_tendermint_client/cached/general
use ibc/client/ics_007_tendermint_client/cached/packed
use ibc/client/ics_007_tendermint_client/cached/types.{
  Record, Update, max_signers,
}
use ibc/client/ics_007_tendermint_client/cached/verify
use ibc/client/ics_007_tendermint_client/client_datum.{ClientDatum}
use ibc/client/ics_007_tendermint_client/cometbft/block/commit_sig.{CommitSig}
use ibc/client/ics_007_tendermint_client/cometbft/signed_header.{SignedHeader}
use ibc/client/ics_007_tendermint_client/height.{Height}
use ibc/utils/tx_time.{TxTime}

// Experimental helper data. Neither this datum nor its redeemer is a public
// commitment schema. There is one identity token per client and at most two sets.
pub const max_roster_validators = 128

pub type Roster {
  root: ByteArray,
  count: Int,
  total_power: Int,
  rows: ByteArray,
}

pub type Datum {
  token: AuthToken,
  client_token: AuthToken,
  client_address: Address,
  owner: ByteArray,
  records: List<Roster>,
}

pub type Mint {
  Initialize { client_token: AuthToken, orders: List<List<Int>> }
  Retire { client_token: AuthToken }
}

pub type Spend {
  Refresh { orders: List<List<Int>> }
  Close
}

pub type Hit {
  roster_token: AuthToken,
  signed_header: SignedHeader,
  trusted_height: Height,
  signers: List<Int>,
  trusted: List<Int>,
  history_siblings: List<ByteArray>,
}

pub fn record(roster: Roster) -> Record {
  Record {
    root: roster.root,
    count: roster.count,
    total_power: roster.total_power,
  }
}

/// Run only at admission or refresh. Hashes and totals are recomputed from all
/// rows. The existing packed admission also checks ordering and key uniqueness.
pub fn admit(
  rosters: List<Roster>,
  summaries: List<Record>,
  orders: List<List<Int>>,
) -> Bool {
  admit_changes([], rosters, summaries, orders)
}

/// Exact records inherited from the consumed identity need no fresh admission.
/// Every other row vector is authenticated again before it can be referenced.
pub fn admit_changes(
  known: List<Roster>,
  rosters: List<Roster>,
  summaries: List<Record>,
  orders: List<List<Int>>,
) -> Bool {
  expect list.length(rosters) <= 2
  expect
    when rosters is {
      [first, second] -> first.root != second.root
      _ -> True
    }
  when rosters is {
    [] -> orders == []
    [roster, ..rest] -> {
      expect [order, ..remaining] = orders
      expect [summary, ..tail] = summaries
      expect roster.count <= max_roster_validators
      expect record(roster) == summary
      expect
        if list.has(known, roster) {
          order == []
        } else {
          let (authenticated, _) = packed.target(roster.rows, order)
          record(roster) == authenticated
        }
      admit_changes(known, rest, tail, remaining)
    }
  }
}

fn signatures(
  roster: Roster,
  positions: List<Int>,
  sigs: List<CommitSig>,
  prefix: ByteArray,
  suffix: ByteArray,
  previous: Int,
) -> Int {
  when positions is {
    [] -> {
      expect sigs == []
      0
    }
    [index, ..rest] -> {
      expect index > previous && index >= 0 && index < roster.count
      expect [sig, ..remaining] = sigs
      expect
        verify.checked_signature(
          general.key_at_validated(roster.rows, index),
          sig,
          prefix,
          suffix,
        )
      general.power_at_validated(roster.rows, index) + signatures(
        roster,
        rest,
        remaining,
        prefix,
        suffix,
        index,
      )
    }
  }
}

fn overlap(
  old: Roster,
  target: Roster,
  trusted: List<Int>,
  signers: List<Int>,
  previous: Int,
) -> Int {
  when trusted is {
    [] -> 0
    [index, ..rest] -> {
      expect index > previous && index >= 0 && index < old.count
      let key = general.key_at_validated(old.rows, index)
      expect
        list.any(
          signers,
          fn(signer) { general.key_at_validated(target.rows, signer) == key },
        )
      general.power_at_validated(old.rows, index) + overlap(
        old,
        target,
        rest,
        signers,
        index,
      )
    }
  }
}

/// The token-authenticated ledger datum already establishes every row and total.
/// The same header/time checks and strict quorum rules remain in header_with.
pub fn header(
  client: ClientDatum,
  time: TxTime,
  rosters: List<Roster>,
  hit: Hit,
) -> Bool {
  expect
    list.length(hit.signers) <= max_signers && list.length(hit.trusted) <= max_signers
  let update = Update {
    cache_token: hit.roster_token,
    signed_header: hit.signed_header,
    trusted_height: hit.trusted_height,
    target: [],
    target_siblings: [],
    trusted: [],
    trusted_siblings: [],
    sets: [],
    history_siblings: hit.history_siblings,
  }
  expect [_, ..] = verify.header_with(
    client,
    time,
    [],
    update,
    fn(_, _, trusted_root, prefix, suffix) {
      expect Some(target) = list.find(
        rosters,
        fn(roster) { roster.root == hit.signed_header.header.validators_hash },
      )
      let signed = signatures(
        target,
        hit.signers,
        hit.signed_header.commit.signatures,
        prefix,
        suffix,
        -1,
      )
      if target.root == trusted_root {
        expect hit.trusted == []
        (record(target), signed, None)
      } else {
        expect Some(old) = list.find(
          rosters,
          fn(roster) { roster.root == trusted_root },
        )
        (
          record(target),
          signed,
          Some(
            (record(old), overlap(old, target, hit.trusted, hit.signers, -1)),
          ),
        )
      }
    },
  )
  True
}
