# Authenticated Tendermint validator cache prototype

An update with 45 validators still rebuilds their complete validator root even when only 17 signatures are needed. This prototype authenticates the validator root, count and total voting power once. Later updates supply indexed signers and one shared RFC-6962 multiproof. Native Ed25519 verification remains in place. The retained Injective fixture needs five additional hashes for its 17 selected signers. Its target proof reconstructs the same root with 38 SHA-256 operations rather than 89. Address derivation and header hashing are additional work.

The cache is one persistent UTxO per client with at most two records. Each record contains a validator root, count and total voting power. Admission computes these values from the full set. Ordinary updates rotate the records without creating additional cache objects.

The cache identity is `sha3_256(serialise(subject))` where `subject` is the actual client token. Admission requires the authenticated HostState `CreateClient` operation and its unique canonical client output. An extra token with the same client name under another policy cannot stand in for that output. The client spending validator pins the cache policy and canonical name. The cache spending validator independently preserves its token, client token and client address. Every continuation must invoke the pinned direct or staged verifier. A captured script address alone cannot authorize a cache transition.

The opt-in client minting policy requires the canonical cache to be created with the client. Client retirement consumes both UTxOs and burns both tokens in the same transaction. It uses the existing shutdown authority, grace period and drained-state checks. Both reserves and any other assets are refunded to the authenticated deployer. Retirement cannot leave a cache that needs a client token which no longer exists.

Fixed-position voting-power changes disclose old and new leaf powers with a shared proof frontier. The verifier reconstructs both roots using the same unchanged subtree hashes. It derives the new total from the authenticated old total plus the disclosed differences. The proof includes each changed position's neighbors so the new canonical power/address order can be checked. Public keys cannot change on this path. Full admission rejects repeated keys even at different powers. Membership proofs consume every disclosed position and subtree hash exactly once. Duplicate positions, wrong tree sizes and unused proof data fail.

The target signers must exceed two thirds of authenticated target power. Skipped updates must also exceed the configured trust fraction using authenticated trusted powers. A different trusted root has its own multiproof. Its leaves must match public keys whose target signatures were verified. The bounded path uses the live trusted checkpoint and accepts at most 24 signers per set with at most 256 validators. Historical checkpoints, misbehaviour, membership changes and reordered keys use staged verification. Consuming its completed receipt refreshes the same cache in the final client/HostState transaction.

A direct update verifies the header and writes the client, cache and HostState in one transaction. It has no session initialization or session-token mint/burn. Common canonical vote fields are encoded once and combined with each signer's timestamp. Sparse client-history and HostState witnesses can encode default siblings as empty bytes. Their 64 positions and committed roots stay the same. Existing full hash witnesses and collision descriptors remain accepted.

`powerUpdate` accepts at most eight changed positions as a witness construction bound. That does not establish transaction eligibility. `prepareCachedUpdate` evaluates and signs the complete direct candidate before selecting it. It reserves 5% of each ledger limit for signed size, memory and CPU. A candidate outside that reserve uses staged verification. A transaction-size rejection during completion also takes the staged path. Script failures remain errors. Staged verification transactions and finalization are checked before submission too. The emulator's willingness to accept a transaction is not the resource check.

This is an opt-in prototype through `loadCachedTendermintValidators`. It returns the paired client minting policy as well as the spending and cache scripts. The normal Gateway deployment and routing are unchanged. Existing deployed clients are not migrated. The signed fixture demonstrates client/cache creation, script publication, budget selection, direct updates, staged cache refresh and paired retirement.

The [retained report](../tests/tendermint-cache/evidence/report.json) measures complete signed transactions with Scalus at protocol version 10 and the repository's retained mainnet parameters. The hard limits are 16,384 signed bytes, 16.5 million memory units and 10 billion CPU units. Every reference script used by a direct update is first published in a signed transaction. The table distinguishes the evaluated direct candidate from the selected path. An oversized candidate is never submitted.

| Case | Direct candidate memory | Within hard limits | Selected path | Complete update fee in ADA |
| --- | ---: | --- | --- | ---: |
| Cache hit, 17 signers | 13,397,727 | Yes | Direct | 2.279752 |
| Changed powers at 0, 2 | 15,966,270 | Yes | Staged for headroom | 9.161475 |
| Changed powers at 11, 20 | 16,645,363 | No | Staged | 9.161475 |
| Changed powers at 0, 14, 26 | 17,115,715 | No | Staged | 9.161475 |
| Changed powers at 0, 14, 26, 38 | 17,951,348 | No | Staged | 9.161475 |
| Cache hit, 24 signers | 15,360,794 | Yes | Direct | 2.510607 |
| 100 history records, two cache records, 24 signers | 15,403,936 | Yes | Direct | 2.521811 |
| Same populated case with four dispersed power changes | 19,936,465 | No | Staged | 9.166132 |

The staged fees include all eleven session transactions and finalization. Finalization alone is about 2.20 ADA. The two-change direct candidate calculates to about 2.52 ADA but is rejected by the reserve check. It is not the price of the selected update. A cache hit improves on the retained 4.811116 ADA staged comparison in PR #951. These measurements do not establish a cheaper ordinary changed-set workload.

The changed-set cases use synthetic old powers with one-unit reductions at the listed positions. The target header and signatures are the retained real Injective fixture. The full fallback also replaces one trusted public key. Populated-history cases seed an assumed previously authenticated 100-record history after real client/cache admission. Those historical updates are not replayed. Both cache records are authenticated by admission. These are capacity tests rather than live changed-set replays.

| Component | Acceptance budget | Cache hit |
| --- | ---: | ---: |
| Signed bytes | 4,000 | 5,273 |
| Referenced script bytes | 20,000 | 40,498 |
| Execution memory | 4,000,000 | 13,397,727 |
| Execution CPU | 1,900,000,000 | 6,476,691,235 |
| Complete fee in ADA | 1.000000 | 2.279752 |

The 1 ADA target is not met. Its stated component budget calculates to 0.999171 ADA. The report includes per-redeemer costs and selected transaction CBOR. Client creation, stake registration and reference publication are setup costs outside the ordinary-update fee. These are compiled-script emulator measurements rather than accepted mainnet transactions. Costs can vary slightly with transaction input ordering.

Reproduce from the repository root with Aiken v1.1.24:

```sh
cd cardano/onchain
aiken build --deny --trace-level silent
aiken check --deny -m 'cached/proof.{..}' -m 'cached/vote_parts.{..}' -m 'ibc_state_compact.{..}' -m 'ibc_state_collision_vectors.{..}' -m 'spending_multitx_client.{..}' -m 'validator_cache_security.{..}'
cd ../offchain
deno task test:tendermint-cache
deno task report:tendermint-cache --write
deno task report:tendermint-cache --assert-budget
```

The last command deliberately fails while measured updates exceed the acceptance budget. Regressions cover forged cache/client identities, unrelated client admission, missing verifier calls, paired retirement and refunds, dispersed changes, populated history, two cache records and less favorable signer distributions. Existing proof, quorum, trusted-overlap and state-transition rejection tests remain in place.
