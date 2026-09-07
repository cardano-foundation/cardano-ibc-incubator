# Tendermint UpdateClient capacity

This report tracks the whole-transaction capacity work in [issue
#613](https://github.com/cardano-foundation/cardano-ibc-incubator/issues/613).
It is deliberately separate from the validator hashing and lookup optimizations
in [PR #657](https://github.com/cardano-foundation/cardano-ibc-incubator/pull/657):
lower execution cost does not make an oversized transaction serializable.

## Benchmark boundary

The benchmark uses frozen, production-shaped Injective mainnet data with 45
validators. It covers:

- an adjacent update with all 45 commit signatures;
- an adjacent update containing the live mix of 43 commits, one absent vote,
  and one nil vote; and
- a skipped-height update using the same mixed target commit and a trusted
  height 54 blocks earlier.

The deterministic lower-bound shape has two script inputs (HostState and
client), two reference-script inputs, two continuing outputs with inline
datums, one collateral input, two spend redeemers, and one VKey witness. The
HostState update carries two complete 64-level sparse-Merkle sibling lists and
no consensus-state removals. The input client starts with one unexpired trusted
consensus state and the output retains it after inserting the target state.
This one-to-two transition is the minimum valid no-pruning history shape and
isolates validator-set capacity from the pruning growth tracked by issue #557.

The checked-in RPC responses are immutable inputs. CI never fetches live RPC
data. Their manifest records source URLs, hashes, heights, validator counts,
vote flags, voting power, and block/validator hashes.

## Limits

The project evaluates both Cardano's absolute transaction limit and its safer
CI limit:

| Limit                            |                Value |
| -------------------------------- | -------------------: |
| Cardano `maxTxSize`              |         16,384 bytes |
| Project signing/headroom reserve |            750 bytes |
| Project safe signed size         |         15,634 bytes |
| Transaction memory               |     16,500,000 units |
| Transaction CPU                  | 10,000,000,000 steps |
| Project ex-unit reserve          |                   5% |

## Results

The deterministic lower bounds use the production Gateway encoders for every
datum and redeemer. They are intentionally unbalanced and are not provider
completed, provider evaluated, or ledger submitted; resolving inputs and
adding change can only increase their size. The Aiken figures come from full
validator unit contexts and are summed for the two spending scripts rather
than being extracted from a completed transaction. Every generated report
prints these qualifications.

The execution-unit figures below were measured on `main` at `2c1c8c1f` and
include the verifier optimizations in PR #657. CI recomputes them for every
relevant Aiken or encoder change; the serialized-size result is independent of
those verifier optimizations.

| Scenario                               | Signed bytes | Absolute margin | Safe margin |     Memory |            CPU |
| -------------------------------------- | -----------: | --------------: | ----------: | ---------: | -------------: |
| Adjacent, all 45 commits               |       16,791 |            -407 |      -1,157 | 72,091,542 | 23,675,599,153 |
| Adjacent, 43 commit + absent + nil     |       16,698 |            -314 |      -1,064 | 71,866,206 | 23,551,367,592 |
| Non-adjacent, 43 commit + absent + nil |       16,698 |            -314 |      -1,064 | 80,979,625 | 28,348,286,191 |

Even the smallest candidate is 314 bytes over Cardano's absolute transaction
limit before provider completion can add anything. Every measured scenario
also exceeds Cardano mainnet's transaction memory and CPU limits. Transaction
size and execution cost are both binding constraints.

## Interpretation

These measurements establish the current boundary; they do not choose or
enforce a validator-count ceiling. A follow-up design must reconcile the
supported limit with Injective, introduce any required compact transaction
representation, add matching on-chain and Gateway guards, and test the chosen
limit and limit-plus-one. Explicit two-header misbehaviour evidence requires a
separate capacity result because its payload shape is materially larger than a
normal update.

## Expired or frozen client recovery

An expired or frozen Cardano-side Tendermint client cannot safely resume normal
header updates because its previous trust period has ended. Recovery uses a
second active client for the same chain as a new trusted checkpoint. The
deployment authority submits `MsgRecoverClient`, naming the inactive subject
client and the active substitute client.

The recovery transaction keeps the subject client token and identifier, clears
its frozen height, and copies the substitute's latest consensus state with its
processed time and height. Existing connections and channels therefore continue
to use the same client identifier. The substitute is read as a reference input
and is not modified.

This is not retroactive for deployments that use the previous `spend_client`
script. Adding recovery changes that script's hash, and its existing `Other`
branch cannot authorize a migration. Those deployments must deploy the new
contracts and establish new clients, connections, and channels. A recovery
operator runs `hermes tx recover-client` with the subject and substitute client
identifiers. Hermes asks the Gateway to build the transaction, checks it, then
signs and submits it with the selected deployment key. Hermes does not initiate
recovery automatically.

Recovery requires identical Tendermint parameters, including `chain_id` and
`trusting_period`, and requires the substitute height to be strictly newer. The
subject history is retained and only the oldest entry is removed when the
300-state bound is already full. This keeps recovery itself to at most one
consensus-state deletion. The broader incremental pruning work tracked by issue
#557 is still required for ordinary updates after long downtime.

The recovery validator still checks the retained lists, so its execution cost
grows with the number of stored consensus states. The Aiken fixtures show this
growth, but they include construction of the test transaction and are not
ledger-evaluated transaction costs. A provider-completed transaction is still
needed before claiming support at the full 300-state bound. The history work in
issue #557 is still required.

Recovery is an administrative trust decision rather than an ordinary relayer
operation. For a client frozen by misbehaviour, operators should also wait for
the counterparty evidence window to pass before selecting the substitute.
