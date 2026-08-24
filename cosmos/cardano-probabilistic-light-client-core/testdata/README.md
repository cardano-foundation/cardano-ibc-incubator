# Cardano block fixtures

`babbage_block.hex` and `conway_block.hex` are real Cardano mainnet blocks copied from the Apache-2.0-licensed [gouroboros testdata](https://github.com/blinklabs-io/gouroboros/tree/11659ae4676150c105d83ca249e3c9de2d5669b2/internal/testdata).

- Babbage: block `db19fcfaba30607e363113b0a13616e6a9da5aa48b86ec2c033786f0a2e13f7d`, slot 76204984.
- Conway: block `27807a70215e3e018eec9be8c619c692e06a78ebcb63daf90d7abe823f3bbf47`, slot 159835207.

The tests use the corresponding mainnet epoch nonces to exercise complete KES, operational-certificate, VRF, and block-body verification.

`babbage_host_state_tx_validity_block.hex` is a deterministic, cryptographically signed synthetic Babbage block. Transaction zero has a HostState-shaped normal output and collateral return and is marked phase-2 invalid, while transaction one is a valid HostState control.

The fixture uses block number and slot `1`, an epoch nonce of 32 `0x55` bytes, `100` slots per KES period, and deterministic VRF, KES, and cold-key seeds filled with `0x66`, `0x77`, and `0x88` respectively. It was generated with gouroboros v0.196.0 signing utilities and is decoded and authenticated by the repository's pinned v0.89.1 verifier in the tests. The invalid and valid transaction hashes are `3e9ffe7e260c65730f2b1f9795faa55d18b104f432781806b85f19bc299eca8b` and `fa257a312429d9d354114f1a5932f137445acd48aac6045e66ffd3c4d6328207`.
