# Eureka SP1 Tendermint guest runner

This runner executes the unchanged IBC Eureka SP1 ICS-07 update-client guest against two inputs: the frozen 45-validator Injective fixture already in this repository and a deterministic, valid 200-validator Tendermint update generated with distinct Ed25519 keys and signatures. It executes the guest directly to report its instruction count and also creates an SP1 mock proof to confirm that the mock prover commits the same public values.

Run `./run.sh` from this directory. The script downloads the pinned guest ELF, verifies its SHA-256, and runs both cases. The first Rust build is large because it compiles SP1.

The pinned upstream component is [`cosmos/ibc-contracts` release `sp1-programs-v2.0.0`](https://github.com/cosmos/ibc-contracts/releases/tag/sp1-programs-v2.0.0), commit `ef25a661a8be156d4908956e1055ca40cd67adb7`. It uses SP1 6.1.0. The update-client ELF is downloaded from the [official release asset](https://github.com/cosmos/ibc-contracts/releases/download/sp1-programs-v2.0.0/sp1-ics07-tendermint-update-client) and must have SHA-256 `6a6a40df2b1339455de7b238fdf3e914f4c2f99e85b8fc4abb65fb1664f42270`. The upstream code and artifact are Apache-2.0 licensed.

The guest accepts four private inputs in order: the Solidity ABI-encoded client state, the Solidity ABI-encoded trusted consensus state, the standard protobuf ICS-07 header, and a little-endian `u128` verification time. It commits a 768-byte Solidity ABI `UpdateClientOutput` containing the input client and trusted consensus states, the new consensus state, time, trusted height, and new height.

This establishes that Eureka's existing guest can execute valid 45- and 200-validator updates without a guest change. It does not generate a production Groth16 proof and does not establish that Cardano can verify SP1's BN254-wrapped Ethereum proof. That is a separate verifier experiment.
