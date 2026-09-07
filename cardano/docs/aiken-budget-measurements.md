# Aiken budget measurements

Issue #724 changed measurement setup, not production validators. The four
Tendermint capacity fixtures now prepare their arguments as `const`, including
CBOR decoding and Merkle witness construction. CI builds and measures with
`--trace-level silent`, matching production builds. Diagnostic and fuzz tests
keep their traces.

## Initial comparison

Measured with Aiken `v1.1.21+42babe5` against `bfc77fc69`. These are individual
test-program costs, not complete transaction evaluations.

| Fixture | Memory before | Memory corrected | CPU before | CPU corrected |
| --- | ---: | ---: | ---: | ---: |
| HostState, minimum history | 23,724,736 | 4,878,005 | 7,286,872,434 | 1,556,133,333 |
| 45 validators, adjacent all signed | 49,487,664 | 23,050,597 | 16,767,702,122 | 9,461,833,776 |
| 45 validators, adjacent mixed signatures | 49,262,528 | 22,840,510 | 16,643,502,561 | 9,343,126,537 |
| 45 validators, non-adjacent mixed signatures | 58,378,251 | 31,934,001 | 21,441,028,932 | 14,131,772,184 |

The adjacent all-signed client still exceeds the configured 16.5M transaction
memory limit on its own. None of these corrections establishes that a
45-validator update fits. Transaction size and network execution limits are
unchanged.

Other transaction-budget scenarios still sum representative component tests,
some of which construct fixtures during execution. They remain regression
estimates, not node-evaluated costs or evidence that a transaction is admissible.
The HostState capacity fixture is also a separate synthetic transition, not the
same transaction as the Injective client fixture.

## Compiled production entry points

Evaluating each compiled script with the same prepared arguments gives:

| Fixture | Memory | CPU |
| --- | ---: | ---: |
| HostState, minimum history | 5,280,298 | 1,661,319,951 |
| 45 validators, adjacent all signed | 24,580,418 | 9,930,685,300 |
| 45 validators, adjacent mixed signatures | 24,370,331 | 9,811,978,061 |
| 45 validators, non-adjacent mixed signatures | 33,463,822 | 14,600,623,708 |

The compiled entry point adds about 1.53M memory units to each client test and
0.40M to HostState. Preparing fixtures fixes the large overcount, but calling a
typed validator handler still omits its production argument decoding and
dispatch. The calibration reports both costs rather than assuming equality.

The evaluator uses the pinned `uplc` `1.1.21` library's default Plutus V3 cost
model. Its diagnostic budget allows oversized scripts to finish and is not a
network limit. These are isolated script evaluations, not node evaluations of
complete transactions.

## Reproduce the corrected test costs

From `cardano/onchain`:

```sh
aiken check --deny --trace-level silent --plain-numbers \
  -m 'spending_client_capacity.{update_client_capacity}' \
  -m 'host_state_stt.{host_update_client_capacity_minimum_history_succeeds}' \
  > capacity-check.json
```

To reproduce the previous measurements, run the same selectors at `bfc77fc69`
without `--trace-level silent`. The `Cardano Tx Budgets` CI job contains the
complete selector list and network limits for the full regression check.

This follows Aiken's guidance on [constant benchmark fixtures](https://aiken-lang.org/optimizing-programs#use-const)
and [trace settings](https://aiken-lang.org/language-tour/troubleshooting#traces).

For the production-script comparison, run `aiken build --deny --trace-level silent`
from `cardano/onchain`, then run from the repository root:

```sh
node scripts/ci/calibrate-aiken-budgets.mjs \
  --aiken-report cardano/onchain/capacity-check.json > calibration.json
```

This requires Rust/Cargo and Aiken `1.1.21`. Fixture-export tests run separately
with traces enabled, their costs are discarded. CI also runs this comparison
and uploads both reports as the `aiken-budget-measurements` artifact.
