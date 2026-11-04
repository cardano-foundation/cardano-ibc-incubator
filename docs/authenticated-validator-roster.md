# Authenticated validator roster experiment

This prototype does not reach the proposed 5% funding hurdle at a 60% roster-hit rate. It reduces complete hit fees by about 0.347 to 0.429 ADA in the retained 45-validator workloads. Writing the roster back makes changes more expensive and sometimes pushes an otherwise direct update onto staging. Even assuming free refreshes, the measured hit savings at 60% give only 0.208 to 0.257 ADA per update. The requested hurdle is 0.284 ADA per update.

The prototype is opt-in and the production deployment loader remains unchanged. It uses experimental non-upgradeable client wrappers and native signed transaction fixtures. Gateway routing, historical header reconstruction, Hermes signing policy and registry migration would need integration before a production rollout. The measurements do not justify that rollout at the assumed workload.

One controlled identity token identifies the roster for a client. Minting requires that client's authenticated creation through HostState and its canonical summary cache. The roster can be created empty. The token cannot be minted again during later updates. Its datum binds the client token, client address and deployment owner to at most two distinct validator roots. Each set has a root, count, total power and packed `key32 || powerBE8` rows. Each set is capped at 128 validators. These bounds do not establish that every maximum-size admission fits one transaction.

Admission recomputes the root and denominator and checks canonical power/address order and global key uniqueness with the current packed full-set verifier. Refreshes co-spend the actual client and summary cache. Their accepted continuation supplies the allowed roots. Every new row vector is admitted again. An exact record from the consumed roster can be retained without repeating its admission. Merely claiming the same root does not qualify a changed vector for that reuse. Refreshes preserve the token, client binding, owner and existing funding. Additional minimum ADA must be supplied when the datum grows.

A roster hit reads the token-authenticated output without spending it. An output at the roster address without the correct token is rejected. Creation, refresh and the hit verifier reject an attached reference script on the data output. The hit supplies a new signed header, canonical selected indices, fresh signatures and any trusted-overlap indices. The separate hit verifier reads keys and powers from the admitted rows. It checks every selected signature and both strict voting-power thresholds through the existing shared header/time checks. It contains no fresh validator-membership proof reconstruction. Both same-root and different-root updates are tested.

The recorded deployment owner can retire the roster independently while the client remains. Retirement requires that owner's signature, burns the token and refunds at least its reserve to that owner. Permissionless relayers can fund refreshes but cannot withdraw the reserve or change its owner. This makes top-ups funding for the deployment rather than a refundable claim by each relayer. The ordinary direct, full and staged client paths remain executable through the experimental wrapper. Empty creation followed by full admission during an accepted update and staged finalization with roster admission are tested.

The public client and consensus commitment bytes, packet layout and frozen Go interfaces are unchanged. The native paired comparisons assert equal public client and consensus payloads. The wire-schema check remains at version 7. The existing cache/client/HostState compiled scripts are unchanged by making the two shared verifier helpers public. Private tag seven and the helper identity belong only to the experimental wrapper. Existing client identities cannot be converted by changing a relayer setting.

The [recorded report](../tests/validator-roster/evidence/report.json) contains the source, blueprint and parameter hashes, signed transaction files, complete fees, selected routes, execution budgets, referenced script bytes, admission costs and funding. It uses Aiken v1.1.24 with silent traces and the retained protocol-11 evaluator and mainnet fee parameters. The headers and votes are retained Injective data. Power and key changes use controlled trusted predecessors. These are native emulator measurements of fixed workloads. They do not measure public-chain inclusion or the frequency of validator changes.

| Update | Current fee, ADA | Roster fee, ADA | Roster update transactions |
| --- | ---: | ---: | ---: |
| Hit, 17 signatures | 2.025 | 1.678 | 1 |
| Hit, 28 required signatures | 2.245 | 1.846 | 1 |
| Hit, 34 required signatures | 2.367 | 1.938 | 1 |
| Two power changes, 17 signatures | 2.122 | 2.611 | 1 |
| Three power changes, 28 signatures | 2.401 | 9.85 | 12 |
| Eight power changes, 34 signatures | 2.600 | 10.10 | 12 |
| Key replacement, 17 signatures | 2.355 | 9.50 | 12 |
| First full admission from empty caches | 2.150 | 2.550 | 1 |

The 17-signature hit shrinks from 5,415 to 4,008 signed bytes. Referenced scripts fall from 39,716 to 31,917 bytes. Execution memory falls from about 10.24 million to 8.50 million units. The roster remains the same ledger output and its rows are not retransmitted in the transaction. These savings include the actual smaller referenced verifier set.

Combining that hit with the two-power-change case gives `0.60 × 0.347178 - 0.40 × 0.489271 = 0.0125984 ADA/update`. At 6,000 monthly updates this is about 75.6 ADA before setup costs. The supplied hurdle is 1,704 ADA per month. This pair would need roughly a 92.4% hit rate to clear it. The larger changed-set profiles fare worse.

The refresh experiment explicitly keeps the roster populated. Some refreshes exceed the existing 5% memory reserve and select the retained staged path. The 34-signature eight-change candidate also exceeds the hard memory limit. All twelve staged transactions are included in each complete fee. A production router should prefer the ordinary update and leave the roster cold when maintaining it would cause this extra staging. Such a policy cannot assume that the next update still obtains a roster hit. The report's separate free-refresh calculation shows that removing these refresh fees entirely would still miss the hurdle at 60% hits for all three measured hit workloads.

One 45-validator roster contains 1,800 raw row bytes. Its complete datum is 2,103 CBOR bytes and its actual minimum output funding is 10.249180 ADA. Two sets require 18.451110 ADA. The raw rows alone account for 7.758 ADA per set at 4,310 lovelace per output byte. These are locked reserves and are not fees on every hit. The additional registered credential locks 2 ADA per deployment. The additional reference-output minimum funding is about 96.55 ADA per deployment. The fixture's publication outputs are deliberately overfunded at 100 ADA each, so the report records their minimum funding separately.

In the 17-signature case, creating the admitted roster adds about 0.459 ADA to client/cache admission. Additional reference publication costs about 1.461 ADA and registration adds about 0.0015 ADA once per deployment. Retiring that roster costs about 0.338 ADA and returns its reserve. These setup and retirement fees are recorded separately and are not amortized into the recurring savings calculation above. Including them cannot rescue a workload that already misses the hurdle.

Reproduce from the repository root with Aiken v1.1.24 and Deno:

```sh
cd cardano/onchain
aiken build --deny --trace-level silent
aiken check --deny -m 'ibc/client/ics_007_tendermint_client/cached/roster'
cd ../offchain
deno task test:tendermint-cache
deno task report:validator-roster --write
```

The report uses SHA-256 of decoded signed CBOR bytes. Its source hashes identify the measured implementation. The tests include identity reminting, forged outputs, wrong policies, malformed rows and totals, signature and quorum failures, false reuse of altered records, funding withdrawals, attached scripts and unauthorized or incomplete retirement.
