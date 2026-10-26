# Tendermint upgrade regression tests

The harness compares Aiken with the pinned v8 and v10 IBC keepers using real SDK upgrade-store proofs. It covers revision resets, upgrades within a revision, malformed proofs, frozen or expired clients and membership or absence proofs against the bootstrap root.

The SDK commits upgrade state at `H-1`. The trusted header at `H` can have a later timestamp. `fixtures/v8-upgrade-proof.json` retains this case from a real v8 halt, including the signed header and both proofs. Verification checks the signatures, proofs and reference keeper acceptance.

Regenerate with Go `1.26.9` and Aiken `1.1.21` as the formatter:

```sh
node tests/tendermint-upgrade/generate.mjs --write
node tests/tendermint-upgrade/generate.mjs --check
python3 tests/tendermint-upgrade/verify_capture.py tests/tendermint-upgrade/fixtures/v8-upgrade-proof.json
```

`AIKEN_FORMATTER` can select a separate formatter executable. Run the generated tests with Aiken `1.1.24`:

```sh
cd cardano/onchain
aiken check --deny -m sdk_upgrade_
```

Expected differences are pinned in `cases.json`. V10 scales the trusting period when unbonding shrinks. Aiken preserves the old period like v8. Aiken also rejects expired or excessively future upgrade timestamps that both reference upgrade entrypoints accept. These differences still require independent security review.
