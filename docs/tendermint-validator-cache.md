# Authenticated Tendermint validator cache prototype

An update with eight dispersed power changes previously selected twelve transactions costing about 9.13 ADA. The direct witness also stopped at 24 signatures and general validator changes used the staged path. The prototype now submits every retained acceptance case in one transaction below 3 ADA with the existing 5% resource reserve. This includes genuine 28- and 34-signature availability cases, eight power changes and general key replacement, addition, removal and reordering.

The cache is one persistent UTxO per client with at most two records. Each record holds an authenticated validator root, count and total voting power. Admission calculates them from the full set. Power updates disclose the union of signers, changed leaves and ordering neighbors. One shared Merkle frontier reconstructs both roots and reuses unchanged hashes. Signer positions select those authenticated leaves directly. Their old powers establish trusted overlap and the proved power differences update the denominator.

General changes use complete target rows containing a public key and an eight-byte voting power. Positions follow from the exact row length. A permutation of positions in strict public-key order proves global key uniqueness. Canonical voting-power/address order is checked separately. A complete old set references surviving target keys by position and supplies old-only keys explicitly. Every byte, reference and signer must be consumed exactly once. Both roots and both denominators are reconstructed. This works when the trusted root is absent from the cache and when old and new counts differ. The internal hash vector and verified-signer mask are computed by the verifier and never supplied as independent claims.

Every native Ed25519 signature check, strict target quorum, trusted overlap rule and header/time check remains. The power proof starts at the client's actual trusted root and ends at the signed target root. Unchanged ordering is inherited only where powers did not change. Changed positions disclose their ordering neighbors. Direct timestamp encoding is tested against the existing protobuf encoder across retained votes and boundary values.

The client and cache spending guards pin a small dispatcher. It reads the actual client spending witness and requires the corresponding pinned normal or general verifier. That verifier decodes and validates the same complete witness and checks the client, cache and HostState outputs. Cache admission remains bound to authenticated HostState client creation. Its token name is `sha3_256(serialise(subject))` for the actual client token. All continuations preserve the cache token, client token and client address. Client/cache creation and retirement remain paired.

`prepareCachedUpdate` evaluates and signs the complete transaction before choosing its path. It reserves 5% of signed size, memory and CPU. Cases outside that reserve retain the staged fallback. Rejected direct candidates never count as successful updates. Setup publication and cache admission also receive explicit ledger-limit checks. The benchmark gate checks all 33 retained cases without mode exclusions.

The [protocol-10 comparison](../tests/tendermint-cache/evidence/protocol-10/report.json) runs the proof changes at commit `e3a35dcf` before the later merge from `main`. The [current report](../tests/tendermint-cache/evidence/report.json) uses the merged protocol-11 evaluator and native Value operations. Both use the same retained fee parameters and the same 350-entry cost-model array. Signed transactions and [comparison provenance](../tests/tendermint-cache/evidence/protocol-10/provenance.json) are retained beside the reports. The columns below identify the execution baseline. All rows submit one update transaction.

| Complete update | Protocol 10 fee in ADA | Current protocol 11 fee in ADA |
| --- | ---: | ---: |
| Cache hit, 17 signers | 2.054868 | 2.024497 |
| Eight dispersed power changes, 24 signers, populated history | 2.468436 | 2.434557 |
| Cache hit with 28 required signatures | 2.274602 | 2.244231 |
| Cache hit with 34 required signatures | 2.396703 | 2.366331 |
| Eight dispersed changes with 34 required signatures, populated history | 2.650075 | 2.616196 |
| General key replacement, 17 signers | 2.384943 | 2.354516 |
| General reordering, 34 required signatures, uncached trusted root | 2.638872 | 2.604855 |
| General removal, 34 required signatures, uncached trusted root | 2.656392 | 2.622375 |

The protocol-10 maximum is 2.656392 ADA with 15,376,782 memory units. It leaves 298,218 units beyond the 15,675,000 reserve threshold. The current protocol-11 maximum is 2.622375 ADA with 15,043,856 memory units. The largest current signed transaction is 8,919 bytes and the largest CPU budget is 8,029,516,849 units. Every referenced script is published in an actual signed setup transaction within the 16,384-byte limit. Ordinary-update fees exclude client creation, credential registration and reference publication.

Availability tests withhold real precommits from the retained Injective header. They keep every selected signature and timestamp unchanged. Removing the final selected signature fails the target quorum, so 28 and 34 are required counts rather than padding. Changed-set tests use synthetic trusted predecessors around the real signed target. Populated cases seed an assumed previously authenticated 100-record history after real admission. They do not replay those historical updates. Both cache records are authenticated on admission.

These measurements cover a 45-validator target and trusted sets of 44, 45 or 46 validators. The witness bounds of 45 signatures and 256 validators do not establish a universal 3 ADA ceiling. Complete evaluation still controls routing for larger or different workloads. The original 1 ADA component budget remains unmet and is reported separately.

This is an opt-in Cardano prototype through `loadCachedTendermintValidators`. Gateway routing and the frozen Go modules are unchanged. Direct updates write the client, cache and HostState together without session tokens or a collection timer. Deployment metadata records the finite verifier credentials and extra reference scripts. Shutdown refunds all five registered credential deposits before removing HostState and reclaims the extra references. Existing deployed clients are not migrated.

Reproduce the current gate with Aiken v1.1.24 and Deno v2.9.6:

```sh
cd cardano/onchain
aiken build --deny --trace-level silent
cd ../offchain
deno task test:tendermint-cache
deno task test:shutdown
deno task report:tendermint-cache --write --assert-direct-budget
```

The isolated protocol-10 run checks out `e3a35dcf` and replaces only its benchmark script with the retained `protocol-10/benchmark.source.ts` before running the same report command. The older `--assert-budget` deliberately fails against the original 1 ADA component budget.
