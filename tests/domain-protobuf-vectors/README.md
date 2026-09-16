# Domain protobuf compatibility and cost (issue #195)

The domain `ConnectionEnd` and `Channel` types remain separate from the generated
protobuf types. Production proof construction now marshals domain values directly.
This removes intermediate record reconstruction and enum-to-enum mapping without
changing domain constructors, transition validation, field tags, default omission,
or the channel's implicit `upgrade_sequence = 0`.

Generated protobuf sources are unchanged. The old conversion functions are retained
as a compatibility oracle; existing validator test fixtures still construct their
expected proof values through those functions and the generated marshallers.

## Compatibility

`main.go` calls the **ibc-go v10.2.0** generated `Marshal` methods using the existing
Go module and pinned **Go 1.25.13** toolchain. The resulting 69 Aiken tests compare
both marshalling paths to the Go bytes and check the channel's reported length.
They cover:

- All four connection states and all 15 supported channel state/order pairs.
- Empty/default fields, empty nested messages, and zero delay/upgrade sequence.
- Repeated versions/features/hops, including empty repeated entries.
- Length-prefix boundaries at 127/128 bytes and longer values.
- Delay varints at 0, 127, 128, 16383, 16384, and uint64 maximum.

From the repository root:

```sh
tests/domain-protobuf-vectors/generate.sh --check
# To regenerate after an intentional upstream compatibility change:
tests/domain-protobuf-vectors/generate.sh --write
```

`domain_protobuf.test.ak` additionally checks 500 randomized payloads per type,
each against **every** supported state/order, with arbitrary bytes, empty lists,
multiple nested records, and uint64 delays. This gives 9,500 paired comparisons
with seed 195. These properties run in the connection CI shard. Protobuf-only
`FLUSHING`/`FLUSHCOMPLETE` remain absent from the domain type; the unchanged wire
schema lock also verifies that no datum/redeemer representation was broadened.

## Measurements

Baseline: `d3b82f58` on `main`. Compiler: `aiken v1.1.21+42babe5` (CI's version).
Sizes are bytes of `compiledCode` in the blueprint from `aiken build --deny`
(default silent traces), before applying deployment parameters. Duplicate `.else`
entries refer to the same script and are counted once. All other validators have
identical compiled bytes.

| Validator | Before | After | Saved |
| --- | ---: | ---: | ---: |
| `minting_channel_stt.mint_channel_stt.mint` | 14,435 | 14,148 | 287 |
| `minting_connection_stt.mint_connection_stt.mint` | 11,874 | 11,742 | 132 |
| `spending_channel/chan_close_confirm.chan_close_confirm.mint` | 10,464 | 10,221 | 243 |
| `spending_channel/chan_open_ack.chan_open_ack.mint` | 11,086 | 10,846 | 240 |
| `spending_channel/chan_open_confirm.chan_open_confirm.mint` | 10,651 | 10,411 | 240 |
| `spending_channel/timeout_packet.timeout_packet.mint` | 13,640 | 13,361 | 279 |
| `spending_connection.spend_connection.spend` | 9,409 | 9,274 | 135 |

The following paired unit tests measure the **complete encoding expression plus
an identical non-empty-output assertion**, not the conversion in isolation or a
whole transaction. Their difference isolates the benefit for representative
proof-value shapes. They cover every active production call site; both channel
orderings are tested and have identical budgets here. Costs use `aiken check`'s
default verbose traces. Exact values for both orderings are in `measurements.json`.

| Call-site shape | CPU before → after | Memory before → after |
| --- | ---: | ---: |
| `conn_open_try` | 45,702,404 → 41,165,916 | 157,556 → 146,096 |
| `conn_open_ack` | 48,168,662 → 43,327,792 | 166,117 → 153,555 |
| `conn_open_confirm` | 48,168,662 → 43,327,792 | 166,117 → 153,555 |
| `chan_open_try_unordered` | 44,084,535 → 35,336,931 | 148,880 → 124,210 |
| `chan_open_ack_unordered` | 46,550,615 → 37,498,283 | 157,440 → 131,666 |
| `chan_open_confirm_unordered` | 47,159,379 → 37,802,665 | 159,644 → 132,768 |
| `chan_close_confirm_unordered` | 47,463,761 → 37,802,665 | 160,746 → 132,768 |
| `timeout_on_close_unordered` | 47,463,761 → 37,802,665 | 160,746 → 132,768 |

Call-site mapping:

- `conn_open_try`: `minting_connection_stt.validate_conn_open_try_proof`.
- `conn_open_ack` / `conn_open_confirm`: the corresponding proof helpers in
  `spending_connection`.
- `chan_open_try`: `minting_channel_stt.validate_chan_open_try_proof`.
- `chan_open_ack`, `chan_open_confirm`, `chan_close_confirm`: their respective
  spending-channel validators.
- `timeout_on_close`: `timeout_packet.validate_timeout_on_close_proofs`.

The library helpers `verify_connection_state` and `verify_channel_state` also use
the direct marshallers. Neither has a production caller on this baseline, so there
is no additional deployed script to measure. The existing channel verification
unit test covers the latter.

To reproduce the paired costs and compatibility run from `cardano/onchain`:

```sh
aiken check --deny --seed 195 --max-success 500 \
  -m ibc/core/domain_protobuf > /tmp/domain-protobuf.json
```

Existing validator fixtures also pass unchanged against both versions. These
budgets include fixture construction and assertions as well as the validator
invocation (they are not node-evaluated transaction budgets):

| Successful fixture | CPU before → after | Memory before → after |
| --- | ---: | ---: |
| `conn_open_ack_succeed` | 872,214,914 → 867,806,044 | 2,797,435 → 2,787,573 |
| `conn_open_confirm_succeed` | 842,793,645 → 838,384,775 | 2,679,139 → 2,669,277 |
| `succeed_chan_open_ack` | 2,148,837,577 → 2,140,041,245 | 6,890,907 → 6,866,733 |
| `succeed_chan_open_confirm` | 2,107,946,147 → 2,098,877,433 | 6,741,773 → 6,716,697 |
| `chan_close_confirm_succeed` | 1,942,354,318 → 1,933,013,222 | 6,198,847 → 6,172,869 |
| `succeed_timeout_on_close_unordered_future_packet` | 3,016,131,606 → 3,006,790,510 | 9,676,561 → 9,650,583 |
| `timeout_on_close_recovers_second_future_packet_from_closed_ordered_channel` | 2,835,717,328 → 2,826,376,232 | 9,039,193 → 9,013,215 |
| `chan_open_try_mint_ordered_protobuf_budget` | 2,552,692,339 → 2,544,184,735 | 8,251,866 → 8,228,696 |
| `chan_open_try_mint_unordered_protobuf_budget` | 2,554,870,186 → 2,546,362,582 | 8,255,523 → 8,232,353 |
| `conn_open_try_full_transition_protobuf_budget` | 3,056,888,689 → 3,052,720,201 | 9,915,717 → 9,906,557 |

The new mint fixtures are run unchanged on the baseline and this branch. The
connection fixture invokes the mint policy, HostState transition, and domain
transition. The channel fixtures invoke the full mint policy for each ordering;
delegated proof verification and the HostState transition are represented by
redeemers, as in the existing spending-channel fixtures. A negative fixture also
checks rejection of an incorrect protobuf proof value.

The unused library channel-verification helper saves 8,939,604 CPU and 25,870 memory
units in its existing test.

One early-rejection fixture (`conn_open_confirm_rejects_inactive_client`) increases
by 304,000 CPU and 1,900 memory units (about 0.05% CPU) after compilation; its
expected rejection is preserved. Other affected existing fixtures are unchanged
or cheaper. `measurements.json` includes all changed budgets from the focused
regression run, including this increase.

To reproduce the validator fixture comparison, run the following in both a
checkout of `d3b82f58` and this branch, retaining each JSON output. For the two
new mint budget fixtures, first copy `validators/minting_channel_stt_protobuf.test.ak`
and `validators/minting_connection_stt_contract.test.ak` from this branch into the
baseline's `cardano/onchain/` directory. The latter only adds a unit form of the
existing full-transition property; no baseline production code is changed.

```sh
cd cardano/onchain
aiken build --deny
aiken check --deny --seed 195 --max-success 1 \
  -m conn_open -m chan_open -m chan_close -m timeout \
  -m succeed_verify_channel_state > /tmp/validator-fixtures.json
```

These measurements establish that the compiler does not eliminate the original
conversion overhead. Script hashes change, so deployments must rebuild and apply
the new validators together through the normal deployment process.

## Validation result

The baseline full smoke run passes all 1,313 tests. The updated smoke run passes
all 1,384 tests collected before the budget fixtures were added; the separate
compatibility/cost and mint-fixture runs cover the 30 added budget tests. Together
these runs pass all 1,414 tests in the final tree, retaining every baseline test.
The compatibility run uses 500 iterations per property; the full smoke run uses
one iteration per existing property, matching CI's smoke job.

Formatting, warning-free build/type checking, vector regeneration, the wire-schema
lock, and the fuzz-import/layering guards also pass.
