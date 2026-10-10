# Cardano Mainnet Stake Distribution Findings

Recorded on October 9, 2026 for [PR #873](https://github.com/cardano-foundation/cardano-ibc-incubator/pull/873).

An internally consistent stake table can still assign false amounts to real pools. This study asks whether limits on stake changes and requirements for recent block production could restrict that fabrication while admitting the changes observed on mainnet. The findings suggest that absolute limits per pool and recent-production qualifications deserve further testing. They do not authenticate stake amounts.

The analysis covers 101 effective election snapshots from epochs 558 through 658, giving 100 transitions. Another 20 snapshots from epochs 538 through 557 provide earlier production history. The settlement replay uses the light-client policy at commit [`6b2dc8c9`](https://github.com/cardano-foundation/cardano-ibc-incubator/tree/6b2dc8c9a59bd405f26497a9470e3bba004c6f42): at least 24 descendants, five distinct qualifying pools and 511 basis points, or 5.11%, of unique active stake. The first registration must precede January 1, 2026. Each pool contributes its stake once. The anchor producer contributes only if it also produces a descendant. Scored descendants stay in the anchor's epoch.

The main pattern is that stake usually moves in modest amounts across many pools, but occasionally changes much more sharply. A rule can look reasonable for most epochs and still reject a real mainnet transition.

Across the 100 transitions, the median change in the whole distribution was **0.731 percentage points**. This measures how much normalized stake share moved between pools. It does not measure how much ADA was transferred. For example, a pool moving from 0.2% to 0.7% gains 0.5 percentage points. The whole-distribution measure is half the sum of the absolute changes in all pool shares. It counts each reallocation once rather than counting both the increase and the corresponding decrease.

That gives us a fairly direct picture of the cost of a limit on changes to the whole table:

| Maximum movement allowed per epoch | Real transitions rejected |
| --- | ---: |
| 0.5 percentage points | 85 of 100 |
| 1 percentage point | 20 of 100 |
| 1.5 percentage points | 8 of 100 |
| 2 percentage points | 2 of 100 |

The largest transition was **5.411 percentage points**, between epochs 638 and 639. Eighteen pools went from zero active stake to positive active stake. Together they accounted for **4.777% of the new distribution**. Meanwhile, total active stake increased by only **0.161%**. So the large change was mostly a change in where stake was allocated rather than a large increase in total stake. Zero stake in the previous snapshot does not mean these were newly registered pools. These observations do not identify the operators or establish why the allocation changed.

This outlier also exposed a problem with choosing a threshold from earlier history. The largest movement in the first 70 transitions was 2.643 points. A limit chosen to admit all of those would still have rejected the later 5.411-point transition in the final 30 transitions.

Individual pool changes told a different story. The largest increase was about **0.405 percentage points**, even during these much larger changes across the whole table. A 0.5-point limit on each pool's increase would therefore have admitted all 100 observed transitions.

But relative growth can be enormous. Between epochs 609 and 610, one pool went from approximately **147,000 ADA to 87.45 million ADA** in one transition, roughly 600 times its previous stake. Its delegator count stayed at **six**. One existing account accounted for almost the entire increase. That illustrates why a rule such as "a pool cannot grow by more than 20%" would reject real changes. Delegator count alone tells us little about the amount of stake behind a pool.

A limit on each pool's absolute increase looks more useful. With a 0.5-point limit, five controlled pools could gain at most 2.5 percentage points collectively in one epoch. However, the allowed increase grows with the number of controlled identities. Eleven pools could collectively gain 5.5 points under that rule alone. This would constrain fabrication, but would not establish that the supplied amounts are correct. Admitting all 100 historical transitions also does not establish that the same limit would admit every future legitimate transition.

Recent block production looked promising as a separate qualification. There were roughly 2,700 pools with positive stake in each epoch, but only about 900 to 1,050 produced a block. Around 1,500 old pools had produced no blocks in the preceding five epochs. Many have so little stake that this is an ordinary outcome of the block-selection process.

Requiring a pool to have produced blocks in at least three of the previous five epochs excluded many identities while changing settlement time relatively little. The settlement counter was replayed across **233,711 historical anchors in 11 sampled epochs**. About **96% of anchors that settled under both policies had no additional delay**. Median settlement time moved from **8 minutes 43 seconds to 8 minutes 44 seconds**. The largest additional delay was 3 minutes 48 seconds. This concerns whether a pool receives credit toward bridge settlement. It does not mean its blocks would become invalid.

The added production qualification was compared against the existing registration cutoff. The replay measures time between historical blocks rather than network or relayer latency. It does not repeat cryptographic header verification. Under both policies, 273 anchors did not settle before the end of their epoch. These are principally anchors too close to the epoch boundary to have enough remaining descendants. The three-of-five requirement added no unresolved anchors in this sample.

The important remaining issue is accumulation over time. Suppose a rule allows a controlled group to gain 0.5 percentage points each epoch and then uses every accepted table as the reference for the next one. A fabricated allocation could pass that rule repeatedly and rise from almost zero to 5.5% in eleven transitions. The rule limits the speed of the increase. It does not stop the increase. This example concerns allowed allocations. It does not demonstrate that an attacker can produce the cryptographically valid chain evidence required for an accepted update.

Absolute limits per pool and recent-production qualifications could make fabrication harder at a measurable cost to availability. A tight limit on changes across the entire table would reject ordinary mainnet activity quite often. None of these measurements authenticates stake amounts. Their protection depends on the previously trusted stake and production information they compare against. Production qualifications also require independently established pool identities. Pool identity count does not establish that the pools have independent operators.

## Data and Measurement Scope

The dataset comes from the [Koios mainnet API](https://api.koios.rest/). Historical pool enumeration includes pools that subsequently retired. Of the 2,990 identities with positive stake during the main analysis, 287 were retired at collection time. All 121 collected stake totals and pool block totals reconcile exactly with the provider's epoch totals. The ordered block sequences in the 11 sampled epochs are contiguous and their issuer counts match the reported pool histories. These checks support completeness of the extraction. They are not independent verification against a historical Cardano node.

The epoch labels describe effective election stake. Alignment was checked against [db-sync's stake extraction](https://github.com/IntersectMBO/cardano-db-sync/blob/ca434ecdfbbf04ed94e424ddbdf0b32bcec403ec/cardano-db-sync/src/Cardano/DbSync/Era/Shelley/Generic/StakeDist.hs) and the [ledger's epoch snapshot transition](https://github.com/IntersectMBO/cardano-ledger/blob/cardano-ledger-shelley-1.11.0.0/eras/shelley/impl/src/Cardano/Ledger/Shelley/Rules/NewEpoch.hs). The chain was in epoch 660 at collection time. Epoch 658 was the latest available completed pool-history snapshot because the provider's finalized history lagged the latest completed epoch.

[Summary results](summary.json) preserve the measurements and policy comparisons. [Collection metadata](manifest.json) records the epoch range and completeness checks. The [replayed policy](policy_reference.json) identifies the source commit and rules. [Account-level examples](concentration_examples.json) support the observations about large changes with little change in delegator count.
