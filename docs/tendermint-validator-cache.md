# Authenticated Tendermint validator cache prototype

A small power change previously rebuilt overlapping validator data for the power proof, target signers and trusted overlap. The retained three-change example fell back to twelve transactions costing about 9.16 ADA. This prototype now authenticates those leaves with one shared Merkle frontier. The required two-, three- and four-change cases complete in one signed transaction below 3 ADA with the existing 5% resource reserve.

The cache is one persistent UTxO per client with at most two records. Each contains a validator root, count and total voting power. Admission computes them from the full set. Power updates disclose the union of selected signers, changed leaves and the required ordering neighbors. One tree traversal reconstructs both roots. An unchanged leaf is hashed once. An unchanged subtree reuses its computed hash. A linear merge matches every signer with its authenticated leaf and obtains its old voting power. The new denominator is the authenticated old total plus the proved power differences.

The proof must start at the client's actual trusted validator root and end at the root in the signed header. A valid proof from another cached root cannot supply trusted overlap. Every signer, leaf and subtree hash must be consumed exactly once. Positions are ordered and unique. Public keys cannot change through this path. Each changed position discloses its existing neighbors and must keep the canonical order. Existing order is inherited only for pairs whose powers did not change. Native Ed25519 checks, the strict target quorum and the trusted overlap quorum remain in force. The cache-only leaf encoder produces the same protobuf bytes as the existing encoder across all supported positive voting-power widths.

The spending guards read only the cache identity they need. They require the exact pinned update verifier, which fully decodes the same client spending redeemer and checks the header, proofs, signatures, quorums and outputs. Cache admission is bound to the authenticated HostState client-creation operation. Its token name is `sha3_256(serialise(subject))` for the actual client token. Every cache continuation preserves its token, client token and client address. Creation and retirement pair the client and cache tokens. Shutdown checks the existing authority and drained state and refunds both reserves.

The direct power path supports one transition from the live trusted root. Uncached trusted checkpoints, chained transitions, membership changes and reordered keys use staged verification. An existing cached target can still use ordinary membership proofs. The bounded witness accepts at most 24 signers and 256 validators. `sharedPowerUpdate` constructs the combined frontier for up to eight changed positions. That bound does not establish transaction eligibility.

`prepareCachedUpdate` evaluates and signs the complete candidate before selection. It reserves 5% of the signed-size, memory and CPU limits. A candidate outside that reserve uses staged verification. Staged transactions and initial cache admission are checked before submission too. Tests count actual submitted transactions and their complete fees. A cheap rejected candidate never counts as a successful direct update.

The [retained report](../tests/tendermint-cache/evidence/report.json) uses Scalus, protocol version 10 and the retained mainnet parameters. Every direct-path reference script is published in a real signed transaction. The comparison below uses the earlier prototype at commit `38cc4bd5`. Fees include the complete selected path. Memory is for the selected update transaction, or finalization when staging is required.

| Case | Earlier complete fee in ADA | New complete fee in ADA | Selected memory | Update transactions |
| --- | ---: | ---: | ---: | ---: |
| Cache hit, 17 signers | 2.279752 | 2.079407 | 11,188,694 | 1 |
| Changed powers at 0, 2 | 9.159032 | 2.245373 | 12,717,666 | 1 |
| Changed powers at 11, 20 | 9.159032 | 2.269408 | 12,943,657 | 1 |
| Changed powers at 0, 14, 26 | 9.159032 | 2.277714 | 13,025,335 | 1 |
| Changed powers at 0, 14, 26, 38 | 9.161475 | 2.322257 | 13,457,475 | 1 |
| 100 history records, two cache records, 24 signers | 2.521811 | 2.271449 | 12,527,093 | 1 |
| Same populated case with three dispersed changes | Not retained | 2.526222 | 14,890,621 | 1 |
| Same populated case with four dispersed changes | 9.168575 | 2.540792 | 15,041,963 | 1 |
| Same populated case with eight dispersed changes | Not retained | 9.134900 | 10,653,898 | 12 |

The eight-change candidate calculates to about 2.63 ADA but consumes about 15.97 million memory units. It fits the 16.5 million hard limit and fails the 15.675 million reserve threshold. Its selected twelve-transaction fallback costs about 9.13 ADA. The required smaller cases use one transaction. The largest required case uses about 15.04 million memory units and costs about 2.54 ADA. The benchmark gate requires the actual direct path, exactly one submitted update, a complete fee strictly below 3 ADA and the unchanged reserve.

The changed sets use synthetic old powers with one-unit reductions at the listed positions. The target header and signatures are the retained real Injective fixture. Populated cases seed an assumed previously authenticated 100-record history after actual client/cache admission. They do not replay those historical updates. Both cache records are authenticated on admission. These are capacity measurements rather than live changed-set replays. Setup costs for client creation, stake registration and reference publication are separate from ordinary updates.

This remains an opt-in Cardano prototype through `loadCachedTendermintValidators`. Gateway routing is unchanged. The frozen Go modules are unchanged. Direct updates write the client, cache and HostState together and introduce no collection timer or additional transfer waiting. Existing deployed clients are not migrated. The earlier 1 ADA component target remains unmet and is retained separately in the report.

Reproduce with Aiken v1.1.24 from the repository root:

```sh
cd cardano/onchain
aiken build --deny --trace-level silent
aiken check --deny -m 'cached/proof.{..}' -m 'cached/vote_parts.{..}' -m 'ibc_state_compact.{..}' -m 'ibc_state_collision_vectors.{..}' -m 'spending_multitx_client.{..}' -m 'validator_cache_security.{..}'
cd ../offchain
deno task test:tendermint-cache
deno task report:tendermint-cache --write --assert-direct-budget
```

`--assert-direct-budget` checks the new complete-update acceptance target. The older `--assert-budget` still deliberately fails against the original 1 ADA component budget. Regressions cover wrong cached roots, omitted signers and neighbors, altered powers and keys, extra or missing hashes, malformed nested headers, quorum failures, forged cache identities and paired retirement. The wrong-root test supplies an internally valid proof from another authenticated cache record. An isolated control confirms that removing only the trusted-root check makes that transaction pass.
