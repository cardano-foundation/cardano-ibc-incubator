The optimized 64-request run now uses 32 two-request batches with no fallback to single sends. Its largest send uses 15.07 million memory units, about 8.7% below the unchanged 16.5-million limit. The same workload previously needed 56 batches. These are measured validator and dependency results, not a measured end-to-end speedup. The optimized measurements are in `packet-lane-benchmark-optimized.json`.

The optimization decodes each Merkle witness in the lane guard that validates it instead of repeatedly decoding every lane's siblings in unrelated policies. The wire format and proof checks are unchanged. The root update also avoids per-level integer division and temporary tuples. Tests reject malformed opaque witnesses and preserve the existing root vectors.

The following results preserve the baseline at `c70d0aaa` for comparison.

The local benchmark confirms that packet lanes reduce shared-state contention. It does not yet measure dapp-to-destination latency or prove an end-to-end throughput improvement over the old deployment. It constructs and signs real transactions against authenticated fixture state and evaluates the compiled validators. Ledger submission and inclusion use the emulator. The recorded node run also evaluates those transactions through the local Ogmios endpoint with additional fixture UTxOs. It does not submit them to the live node.

Every request uses a separate funded user wallet and sends two ADA on the same channel. All funding transactions are built before any are submitted. All packets are sent before any acknowledgement is processed. Acknowledgements are also built from one snapshot. Transactions that share a lane must fail as stale spends and then succeed after rebuilding. Separate fee wallets isolate lane contention. A second probe deliberately shares a fee wallet between two different lanes.

The baseline node-evaluated workload produced these dependency counts. A round means that the builder reloads state after the preceding transactions are included. It is not a measured block or settlement window. Independent transactions can still exceed the budget of one block.

| Requests | Lanes | Sequential send batches | Independent acknowledgement lanes | Acknowledgement rounds | Stale acknowledgement retries | Executor pauses between send batches |
| --- | --- | --- | --- | --- | --- | --- |
| 5 | 1, contention control | 3 | 1 | 5 | 4 | 10 seconds |
| 5 | 16 | 3 | 5 | 1 | 0 | 10 seconds |
| 16 | 16 | 8 | 16 | 1 | 0 | 35 seconds |
| 32 | 16 | 24 | 16 | 2 | 16 | 115 seconds |
| 64 | 16 | 56 | 16 | 4 | 48 | 275 seconds |

All requests were admitted with disjoint spending inputs. The one-lane control uses the new validators with one lane. It is not a run of the old HostState implementation and must not be described as a measured speedup over that implementation.

In the baseline, the first 16 sends fit into eight pairs. When sequence 17 revisited an occupied lane, the two-request transaction exceeded the 16.5 million memory-unit allowance. The builder then used one request per transaction. The 32-request burst therefore needed 24 batches and the 64-request burst needed 56. The benchmark records every rejected pair and the successful single-request fallback. This workload intentionally withholds acknowledgements to measure a backlog during settlement. It does not establish the behavior of maximum-size packets or full 64-entry lanes.

The baseline Hermes executor waited five seconds after each pass even when requests remained. For one initialized channel, that baseline pause alone contributed `5 * (batch_count - 1)` seconds between the first and last send. Add construction and signing, inclusion and history indexing for every batch. Initial discovery can add another five seconds. Initialization and other channels add more work. The background executor waits for inclusion rather than acknowledgement or the counterparty settlement window. Those baseline pauses capped sustained single-request batching below 0.2 requests per second even before inclusion time. The Gateway also serializes transaction construction through its shared wallet-selection lock.

The shared-wallet probe built two acknowledgements with different lane inputs but the same ordinary fee input. The first succeeded and the second was rejected. Adding workers with one uncoordinated fee wallet does not solve this.

The local node reports limits of 90,112 block-body bytes, 72 million memory units and 20 billion CPU units per block. Baseline empty-lane two-request batches used about 16.4 million memory units and 5.1 billion CPU units. At those costs, only three such batches fit the block CPU allowance even if they belong to different channels. These acknowledgement fixtures use approximately 2.4–2.6 billion CPU units each, allowing roughly seven or eight per otherwise empty block. Client updates and unrelated traffic consume the same budgets.

There is no finite worst-case completion time under arbitrary sustained arrivals, unavailable relayers or repeated rollbacks. If arrival rate exceeds service rate, the funded-request queue grows. A useful live follow-up should measure a fixed burst and then sustained arrival rates below and above the observed service rate. It should report funding inclusion, packet inclusion and destination receipt separately, including the slowest request and retry counts. It needs fresh lane contracts, the matching Gateway and Hermes, and the upgraded partner light client. Run an isolated old deployment with the same workload and settlement policy for a genuine before/after comparison. The existing local services were not repurposed for this benchmark.

Run from `cardano/offchain` after building the production validators with `aiken build --deny --trace-level silent` in `cardano/onchain`:

```sh
deno run --allow-env --allow-read --allow-write scripts/benchmark-packet-lanes.ts /tmp/packet-lanes.json
```

To verify execution budgets through a local node:

```sh
PACKET_LANE_NODE_URL=http://127.0.0.1:2637 deno run --allow-env --allow-read --allow-write --allow-net scripts/benchmark-packet-lanes.ts /tmp/packet-lanes-node.json
```

Optional arguments after the output path select workloads, for example `5:16 32:16 64:16`. The JSON includes transaction sizes, execution units, sequential local construction times, fallback reasons and contention counts. Local construction timings are not chain latency or Gateway throughput. The checked-in `packet-lane-benchmark-results.json` summarizes the observed runs. The full transaction measurements are produced by the command above. The benchmark exits unsuccessfully if any workload fails its assertions.

To require paired sends and at least one million memory units of headroom in this fixed workload, set `PACKET_LANE_REQUIRE_PAIR_BATCHES=1` on the benchmark command. This is a workload-specific regression bound, not a claim that every allowed packet fits two per transaction.
