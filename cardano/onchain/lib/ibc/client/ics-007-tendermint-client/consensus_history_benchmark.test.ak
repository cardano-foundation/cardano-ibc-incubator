use aiken/collection/list
use aiken/collection/pairs
use aiken/math
use ibc/auth.{AuthToken}
use ibc/client/ics_007_tendermint_client/client_datum.{
  ClientDatum, ClientDatumState,
}
use ibc/client/ics_007_tendermint_client/client_state.{ClientState}
use ibc/client/ics_007_tendermint_client/cometbft/block/header.{TmHeader} as tm_header
use ibc/client/ics_007_tendermint_client/cometbft/constants.{
  max_consensus_state_size,
}
use ibc/client/ics_007_tendermint_client/cometbft/signed_header.{SignedHeader}
use ibc/client/ics_007_tendermint_client/consensus_state.{ConsensusState}
use ibc/client/ics_007_tendermint_client/header.{Header}
use ibc/client/ics_007_tendermint_client/height.{Height}
use ibc/client/ics_007_tendermint_client/misbehaviour_handle
use ibc/client/ics_007_tendermint_client/msgs.{HeaderCase}
use ibc/client/ics_007_tendermint_client/types/unchecked_rational
use ibc/core/ics_023_vector_commitments/merkle

// This measures the two history-processing functions, not signature validation,
// HostState witnesses or a complete transaction. All fixture construction is
// evaluated at compile time. Run with --trace-level silent for production traces.
type Fixture {
  input: ClientDatum,
  output: ClientDatum,
  next_header: Header,
}

const tx_valid_from = 1000

const tx_valid_to = 2000

const trusting_period = 1_000_000_000_000

const one = fixture(1, False)

const ten = fixture(10, False)

const sixteen = fixture(16, False)

const seventeen = fixture(17, False)

const fifty = fixture(50, False)

const one_fifty = fixture(150, False)

const three_hundred = fixture(300, False)

const mixed_expiry = fixture(300, True)

fn fixture(count: Int, expire_alternate: Bool) -> Fixture {
  let initial_header = header.null_header()
  let next_header =
    Header {
      ..initial_header,
      signed_header: SignedHeader {
        ..initial_header.signed_header,
        header: TmHeader {
          ..initial_header.signed_header.header,
          chain_id: "history-0",
          height: count + 1,
          time: ( count + 1 ) * 1_000_000,
        },
      },
    }
  let consensus_states =
    list.range(1, count)
      |> list.reverse()
      |> list.map(
          fn(n) {
            Pair(
              Height { revision_number: 0, revision_height: n },
              ConsensusState {
                timestamp: if expire_alternate && n % 2 == 1 {
                  -trusting_period
                } else {
                  n * 1_000_000
                },
                next_validators_hash: #"01",
                root: merkle.new_merkle_root(#"02"),
              },
            )
          },
        )
  let input =
    ClientDatum {
      state: ClientDatumState {
        client_state: client_state.new_client_state(
          "history-0",
          unchecked_rational.from_int(1),
          trusting_period,
          trusting_period + 1,
          1,
          Height { revision_number: 0, revision_height: count },
          merkle.get_sdk_specs(),
        ),
        consensus_states,
        processed_times: list.map(consensus_states, fn(p) { Pair(p.1st, 0) }),
        processed_heights: list.map(consensus_states, fn(p) { Pair(p.1st, 0) }),
      },
      token: AuthToken { policy_id: #"03", name: #"04" },
    }
  Fixture { input, output: legacy_output(input, next_header), next_header }
}

// Frozen reference of the pre-#726 filtering and truncation algorithm. This only
// constructs expected fixtures at compile time, outside the measured functions.
fn legacy_output(input: ClientDatum, next_header: Header) -> ClientDatum {
  let next_height = header.get_height(next_header)
  let retained =
    list.filter(
      input.state.consensus_states,
      fn(p) {
        !client_state.is_expired(
          input.state.client_state,
          p.2nd.timestamp,
          tx_valid_from * 1_000_000,
        )
      },
    )
  let keys = pairs.keys(retained)
  let times =
    list.filter(input.state.processed_times, fn(p) { list.has(keys, p.1st) })
  let heights =
    list.filter(input.state.processed_heights, fn(p) { list.has(keys, p.1st) })
  let end = math.min(max_consensus_state_size - 1, list.length(retained))
  let processed_time = tx_valid_to * 1_000_000
  ClientDatum {
    ..input,
    state: ClientDatumState {
      client_state: ClientState {
        ..input.state.client_state,
        latest_height: next_height,
      },
      consensus_states: list.slice(
        [Pair(next_height, header.consensus_state(next_header)), ..retained],
        0,
        end,
      ),
      processed_times: list.slice(
        [Pair(next_height, processed_time), ..times],
        0,
        end,
      ),
      processed_heights: list.slice(
        [
          Pair(
            next_height,
            client_datum.processed_height_from_time(processed_time),
          ),
          ..heights
        ],
        0,
        end,
      ),
    },
  }
}

fn current(f: Fixture) -> Bool {
  and {
    !misbehaviour_handle.check_for_misbehaviour(
      HeaderCase(f.next_header),
      f.input.state.consensus_states,
    ),
    client_datum.update_state(
      f.input,
      f.output,
      f.next_header,
      tx_valid_from,
      tx_valid_to,
    ),
  }
}

test history_001() {
  current(one)
}

test history_010() {
  current(ten)
}

test history_050() {
  current(fifty)
}

test history_016() {
  current(sixteen)
}

test history_017() {
  current(seventeen)
}

test history_150() {
  current(one_fifty)
}

test history_300() {
  current(three_hundred)
}

test history_300_mixed_expiry() {
  current(mixed_expiry)
}
