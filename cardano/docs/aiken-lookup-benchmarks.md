# Aiken state lookup benchmarks

This report measures the lookup changes for issues #193 and #200 against
`94c1bbba597c31ee12261ae96ea9809c5e1fc222`. Measurements use Aiken
`v1.1.21+42babe5`, silent traces, and the deterministic tests committed with
the change. No redeemer fields or transaction-builder inputs were added, so
transaction and redeemer sizes are unchanged.

## Output-scan inventory and decision

- `host_state_stt` previously used `list.find` to select the HostState output
  and then `list.count` over the same outputs to prove uniqueness. It now uses
  one singleton `list.filter`, preserving the exactly-one invariant in one
  traversal.
- `find_unique_continuation_output` performs one token-and-address-scoped scan
  for client, connection, and channel continuations. A recursive selector was
  benchmarked at roughly 1–2% more CPU and memory, so the existing optimized
  filter was retained.
- The client, connection, channel, port, and HostState transition validators
  each use `transaction.find_script_outputs` once on the applicable execution
  path. Those scans retain their existing uniqueness and script-address checks;
  replacing them without a validated output hint did not remove a repeated scan
  and would add code.
- Channel operations and channel creation previously scanned reference inputs
  once for the authenticated connection and again from the start for its
  authenticated client. They now retain the connection scan's remaining input
  suffix and search it for the client, with a complete-list fallback whenever a
  client-policy input may precede the connection.

The output tests contain nine outputs with the HostState target first, fifth,
or ninth. The reference tests contain ten inputs with the connection/client
targets at positions 1/2, 5/6, or 9/10.

| Lookup | Position | Memory before | Memory after | Change | CPU before | CPU after | Change |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| HostState output | First | 511,602 | 494,582 | -3.3% | 158,718,906 | 153,404,260 | -3.3% |
| HostState output | Middle | 629,539 | 541,935 | -13.9% | 192,429,284 | 167,521,250 | -12.9% |
| HostState output | Last | 672,826 | 514,638 | -23.5% | 204,040,028 | 159,538,606 | -21.8% |
| Connection + client | First | 427,459 | 422,106 | -1.3% | 147,922,260 | 146,122,095 | -1.2% |
| Connection + client | Middle | 592,147 | 564,058 | -4.7% | 195,565,000 | 186,790,843 | -4.5% |
| Connection + client | Last | 726,523 | 675,698 | -7.0% | 235,784,174 | 220,036,025 | -6.7% |

## Serialized script sizes

The HostState validator becomes smaller. Validators using the combined
reference lookup grow modestly in exchange for traversing realistic reference
input lists once instead of twice.

| Validator | Bytes before | Bytes after | Delta |
| --- | ---: | ---: | ---: |
| `host_state_stt` | 12,363 | 12,283 | -80 |
| `minting_channel_stt` | 14,330 | 14,524 | +194 |
| `acknowledge_packet` | 10,427 | 10,565 | +138 |
| `chan_close_confirm` | 10,107 | 10,253 | +146 |
| `chan_close_init` | 7,445 | 7,640 | +195 |
| `chan_open_ack` | 10,873 | 11,012 | +139 |
| `chan_open_confirm` | 10,295 | 10,441 | +146 |
| `recv_packet` | 7,608 | 7,748 | +140 |
| `send_packet` | 7,168 | 7,283 | +115 |
| `timeout_packet` | 10,880 | 11,026 | +146 |

Regression tests cover targets before and after unrelated entries, reordered
client/connection references, duplicate HostState outputs, missing references,
wrong derived tokens, forged datums without the expected token, and malformed
client or connection datums. Every selected reference remains authenticated by
the exact derived policy id and asset name before its inline datum is decoded.

## ICS-23 verification (#725)

Compared with `bfc77fc69` using Aiken `v1.1.21+42babe5` and the default
`aiken check` traces. Chained membership now validates and calculates each
subroot once. Neighbor checking walks reversed paths instead of repeatedly
copying their prefixes. The existing singleton-path behavior is unchanged.

| Operation | Depth | Memory before | Memory after | CPU before | CPU after |
| --- | ---: | ---: | ---: | ---: | ---: |
| Chained membership | 1 | 799,964 | 613,023 | 307,999,955 | 230,688,074 |
| Chained membership | 8 | 2,234,089 | 1,796,415 | 857,246,919 | 656,399,479 |
| Chained membership | 32 | 7,151,089 | 5,853,759 | 2,740,379,367 | 2,115,981,439 |
| Chained membership | 64 | 13,707,089 | 11,263,551 | 5,251,222,631 | 4,062,090,719 |
| Chained membership | 128 | 26,819,089 | 22,083,135 | 10,272,909,159 | 7,954,309,279 |
| Neighbor check | 0 | 448,417 | 393,086 | 139,522,340 | 120,779,147 |
| Neighbor check | 8 | 1,755,713 | 570,894 | 546,133,564 | 176,900,059 |
| Neighbor check | 32 | 12,102,689 | 1,104,318 | 3,799,151,236 | 345,262,795 |
| Neighbor check | 64 | 40,890,529 | 1,815,550 | 12,880,604,132 | 569,746,443 |
| Neighbor check | 126 | 145,424,017 | 3,193,562 | 45,904,820,618 | 1,004,683,511 |

Membership depth applies to each of the IAVL and Tendermint proofs. Neighbor
depth counts shared root-side steps, with two additional steps on each path.
These are verification microbenchmarks, not complete transaction budgets.
The deepest membership fixture still exceeds Cardano's transaction memory limit.

From `cardano/onchain`, run
`aiken check --deny --plain-numbers -m 'ibc/core/ics_023_vector_commitments/ics23/verification_benchmark'`.
To reproduce the baseline, copy only `verification_benchmark.test.ak` into the
same directory of a worktree at `bfc77fc69` and run the same command. All fixtures
and trusted roots are constants, so their construction is excluded from the
measured execution units.
