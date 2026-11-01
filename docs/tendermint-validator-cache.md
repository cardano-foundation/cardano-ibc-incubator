# Authenticated Tendermint validator cache prototype

An update with 45 validators still rebuilds their complete validator root even when only 17 signatures are needed. This prototype authenticates the validator root, count and total voting power once. Later updates supply indexed signers and one shared RFC-6962 multiproof. Native Ed25519 verification remains in place. The retained Injective fixture needs five additional hashes for its 17 selected signers. Its target proof reconstructs the same root with 38 SHA-256 operations rather than 89. Address derivation and header hashing are additional work.

The cache is one persistent UTxO per client with at most two records. Its token is minted alongside the canonical client token. The admission policy computes the root and denominator from the full set. The cache token name comes from the client identity. It cannot be admitted again after that client's one-time creation. Cache retirement burns both tokens together. Ordinary updates rotate records in that UTxO without minting or burning tokens.

Fixed-position voting-power changes disclose old and new leaf powers with a shared proof frontier. The verifier reconstructs both roots using the same unchanged subtree hashes. It derives the new total from the authenticated old total plus the disclosed differences. The proof must include each changed position's neighbors so the new canonical power/address order can be checked. Public keys cannot change on this path. Full admission rejects repeated keys even at different powers. Membership proofs consume every disclosed position and subtree hash exactly once. Duplicate positions, wrong tree sizes and unused proof data fail.

The target signers must exceed two thirds of authenticated target power. Skipped updates must also exceed the configured trust fraction using authenticated trusted powers. A different trusted root has its own multiproof. Its leaves must match public keys whose target signatures were verified. The first bounded path uses the live trusted checkpoint and accepts at most 24 signers per set with at most 256 validators. Historical checkpoints and misbehaviour evidence retain the staged path. Membership changes, reordered keys and other cache misses use that full verification path too. Consuming its completed receipt can refresh the same cache in the final client/HostState transaction.

The ordinary path verifies the header and writes the client, cache and HostState in one transaction. It has no session initialization, intermediate session outputs or session-token mint/burn. Common canonical vote fields are encoded once and combined with each signer's timestamp. Sparse client-history and HostState witnesses can encode default siblings as empty bytes. Their 64 positions and committed roots stay the same. Existing full hash witnesses remain accepted. Collision-bucket witnesses keep their existing descriptor.

This is an opt-in prototype through `loadCachedTendermintValidators`. The normal Gateway deployment and routing are unchanged. A deployment using this loader must register its client spending validator and mint the cache during client creation. Existing deployed clients are not migrated. The signed fixture demonstrates creation, reference-script publication, direct updates and staged cache refresh.

The [retained report](../tests/tendermint-cache/evidence/report.json) measures complete signed transactions with Scalus at protocol version 10 and the repository's retained mainnet parameters. Every referenced script is first published in a real signed transaction. The cache-hit update costs about 2.22 ADA. The two-power-change update costs about 2.47 ADA. Both fit the retained ledger limits. The changed-set case uses a synthetic trusted bootstrap with two one-unit power reductions and the retained real Injective target header and signatures. It is not a live changed-set sample.

| Component | Acceptance budget | Cache hit | Two changed powers |
| --- | ---: | ---: | ---: |
| Signed bytes | 4,000 | 5,273 | 6,117 |
| Referenced script bytes | 20,000 | 39,916 | 39,916 |
| Execution memory | 4,000,000 | 13,116,568 | 15,676,065 |
| Execution CPU | 1,900,000,000 | 6,074,833,136 | 6,880,415,306 |
| Complete fee in ADA | 1.000000 | 2.224079 | 2.466980 |

The 1 ADA target is not met. Its stated component budget calculates to 0.999171 ADA. Script references and execution remain over budget after compacting the witnesses. The report includes costs per redeemer so the remaining work can be attributed to the header/history verifier and HostState transition. The staged row reports finalization separately from its verification transactions. Client creation, stake registration and reference publication are bootstrap costs outside the ordinary-update fee. This is an emulator measurement rather than an accepted mainnet transaction. Costs can vary slightly with transaction input ordering.

Reproduce from the repository root with Aiken v1.1.24:

```sh
cd cardano/onchain
aiken build
aiken check -m 'cached/proof.{..}' -m 'cached/vote_parts.{..}' -m 'ibc_state_compact.{..}' -m 'ibc_state_collision_vectors.{..}'
cd ../offchain
deno task test:tendermint-cache
deno task report:tendermint-cache --write
deno task report:tendermint-cache --assert-budget
```

The last command deliberately fails while any measured direct path exceeds the acceptance budget. The report command retains signed transaction CBOR and reports every missed component. The tests reject a false admission denominator, repeated positions, invalid signatures, insufficient target or trusted power, forged processing metadata and wrong history/cache continuations.
