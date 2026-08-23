# Cardano block fixtures

`babbage_block.hex` and `conway_block.hex` are real Cardano mainnet blocks copied from the Apache-2.0-licensed [gouroboros testdata](https://github.com/blinklabs-io/gouroboros/tree/11659ae4676150c105d83ca249e3c9de2d5669b2/internal/testdata).

- Babbage: block `db19fcfaba30607e363113b0a13616e6a9da5aa48b86ec2c033786f0a2e13f7d`, slot 76204984.
- Conway: block `27807a70215e3e018eec9be8c619c692e06a78ebcb63daf90d7abe823f3bbf47`, slot 159835207.

The tests use the corresponding mainnet epoch nonces to exercise complete KES, operational-certificate, VRF, and block-body verification.
