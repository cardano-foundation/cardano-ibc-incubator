# Cardano Probabilistic Finality Timing Study

This directory contains a reproducible Blockfrost-backed study for measuring how long the `08-cardano-probabilistic` light-client unique-stake heuristic takes to cross configured thresholds on Cardano mainnet.

The primary question is:

> For each candidate anchor block, how many same-epoch descendant blocks and how much wall-clock time are needed before unique eligible descendant-producing pools represent at least 50% of that anchor epoch's active stake?

## Data Source

The fetch phase uses Blockfrost mainnet endpoints for:

- latest block and epoch metadata
- epoch block hashes and per-block details
- epoch total active stake from epoch metadata
- producing pool active stake from pool history
- earliest pool update and transaction detail for first-registration slots

Planning references:

- Blockfrost overview: <https://blockfrost.dev/>
- Blockfrost API documentation collection: <https://www.postman.com/blockfrost-io/my-workspace/collection/gc3tehz/blockfrost-io-api-documentation>
- Blockfrost pool history and epoch endpoints from the API documentation collection.

The analysis phase reads only cached JSON and normalized tables. After `fetch` has completed, `analyze --offline` does not require network access.

## Usage

Set a Blockfrost mainnet project id:

```bash
export BLOCKFROST_PROJECT_ID_MAINNET=mainnet...
```

Fetch the most recent completed 10-day window:

```bash
python3 studies/cardano_probabilistic_finality/finality_study.py fetch \
  --cache-dir studies/cardano_probabilistic_finality/cache \
  --days 10
```

For a one-epoch Blockfrost smoke test:

```bash
python3 studies/cardano_probabilistic_finality/finality_study.py run \
  --cache-dir studies/cardano_probabilistic_finality/cache \
  --output-dir studies/cardano_probabilistic_finality/out \
  --days 7 \
  --epoch-limit 1 \
  --block-limit 500
```

Generate normalized CSVs and the report from cached data:

```bash
python3 studies/cardano_probabilistic_finality/finality_study.py analyze \
  --cache-dir studies/cardano_probabilistic_finality/cache \
  --output-dir studies/cardano_probabilistic_finality/out \
  --offline
```

Or run both phases:

```bash
python3 studies/cardano_probabilistic_finality/finality_study.py run \
  --cache-dir studies/cardano_probabilistic_finality/cache \
  --output-dir studies/cardano_probabilistic_finality/out \
  --days 10
```

## Outputs

The analysis writes:

- `report.md`
- `blocks.csv`
- `epoch_pool_stake.csv`
- `pool_registration.csv`
- `anchor_results.csv`
- `epoch_summary.csv`
- `threshold_summary.csv`
- `data_quality.csv`

`anchor_results.csv` includes exact eligibility rows and an `unfiltered` sensitivity mode. Exact eligibility follows the client rule: a pool only contributes if it has active stake in the anchor epoch and its first registration slot is before the configured cutoff. Missing registration data is not approximated away.

## Tests

Run the synthetic tests with:

```bash
python3 -m unittest discover -s studies/cardano_probabilistic_finality/tests
```

The tests cover exact 50% crossing, duplicate descendant producers, same-epoch enforcement, and missing or late pool registration.
