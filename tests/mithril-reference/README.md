# Mithril reference vectors

This harness signs and aggregates STM certificates with the mithril-stm and
fixed crates that the Mithril mainnet aggregator 0.9.22 (`3f6cb73`) builds
with. The light client's Mithril verifier tests consume its output.

```sh
cargo run --release --manifest-path tests/mithril-reference/Cargo.toml \
  | gzip -9 > cosmos/cardano-probabilistic-light-client-core/testdata/mithril/stm-reference-vectors.json.gz
```

The output holds U8F24 conversions of phi_f values, including half points
between encodings, and certificates for several parameter sets and stake
distributions. For each certificate it has every signer's winning indices
and the aggregate signature. The signers use a fixed seed, so the output is
reproducible.
