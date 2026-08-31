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

The size gate uses Cardano's 16,384-byte transaction limit and keeps 750 bytes
of project headroom. The repository's local Cardano fixture raises the
execution limits to 140,000,000 memory units and 100,000,000,000 CPU steps.
Those are not public-network limits. On 2026-08-26, the Koios epoch-parameter
endpoints reported 16,500,000 memory units and 10,000,000,000 CPU steps per
transaction on [mainnet](https://api.koios.rest/api/v1/epoch_params?limit=1&order=epoch_no.desc),
and 17,500,000 and 10,000,000,000 respectively on
[preprod](https://preprod.koios.rest/api/v1/epoch_params?limit=1&order=epoch_no.desc)
and [preview](https://preview.koios.rest/api/v1/epoch_params?limit=1&order=epoch_no.desc).

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

## Compact reference prototype

The prototype keeps the standard Tendermint header but removes the validator
set from the update transaction. The Gateway packs the ordered validator public
keys and voting powers into a separate reference UTxO. The update carries a
signer bitmap and one signed timestamp and Ed25519 signature for each selected
validator. Validator addresses and total voting power are derived instead of
being relayed, and absent and nil commit slots are omitted.

The Aiken prototype has a separate content validator for the packed validator
data. It enforces the CometBFT ordering, derives each address from its public
key, rejects duplicate addresses, recomputes total voting power and the
ordinary CometBFT validator-set hash. The compact update verifier applies the
strict greater-than-two-thirds quorum. The full adjacent-update test also binds
the complete Tendermint header hash to the commit, checks the client chain and
monotonically increasing height, binds the trusted and target validator roots
to the referenced set, and preserves the existing trusting-period and
clock-drift bounds.

The structural Gateway measurements are:

| Scenario                    | Signers | Reference datum | Signed bytes | Safe margin |
| --------------------------- | ------: | --------------: | -----------: | ----------: |
| Injective, 45 validators    |      15 |     1,907 bytes |        2,833 |      12,801 |
| Equal-power, 200 validators |     134 |     8,296 bytes |       11,689 |       3,945 |
| Equal-power, 256 validators |     171 |    10,608 bytes |       14,444 |       1,190 |

For 200 equal-power validators, the full adjacent Aiken verification with 134
real signatures uses 40,175,516 memory units and 20,391,504,366 CPU steps. When
the same evaluation also validates the complete referenced validator set, it
uses 84,026,773 memory units and 35,409,519,082 CPU steps. The Gateway's
canonical compact-header CBOR is 10,469 bytes; Aiken serializes the same field
shape in 10,478 bytes because it uses indefinite record field lists.

The Gateway and Aiken 200-validator benchmarks currently use different
deterministic key generators. Their CBOR field layout is cross-checked, but a
single shared 200-validator vector is still required before production work.

These results show that the compact 200-validator payload fits by bytes. They
do not show that it fits in one current Cardano transaction. The 40,175,516
memory and 20,391,504,366 CPU used by the client verifier alone exceed current
public-network transaction limits before HostState verification is added. The
Gateway transactions are unbalanced structural lower bounds, are not provider
completed or ledger evaluated, and use two all-default HostState paths. The
production validators do not import the prototype code.

The reference UTxO is not authenticated by the prototype. Production code must
either validate its complete contents during the client update or require a
token minted by a validator-set registration policy that performed the same
validation. Trusting only the root claimed inside an arbitrary reference datum
would be unsafe. The isolated 200-validator content validation uses 43,625,956
memory units and 14,981,874,767 CPU steps, so it also exceeds current
public-network transaction limits and cannot simply be moved into one
registration transaction.

The next prototype must split validator-set certification and signature
verification into bounded transactions that produce authenticated receipts, or
replace those checks with a Cardano-verifiable aggregate proof. The final
client update would consume those receipts. It must also build and evaluate a
balanced whole transaction with populated HostState paths, implement
skipped-height trusted-overlap verification, and handle misbehaviour as
separately verified headers. Production integration would then require new
Aiken redeemer branches and Gateway transaction orchestration, but no change to
the standard Hermes header or the Go light client modules.
