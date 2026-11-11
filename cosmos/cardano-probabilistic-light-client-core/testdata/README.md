# Cardano block fixtures

`babbage_block.hex` and `conway_block.hex` are real Cardano mainnet blocks copied from the Apache-2.0-licensed [gouroboros testdata](https://github.com/blinklabs-io/gouroboros/tree/11659ae4676150c105d83ca249e3c9de2d5669b2/internal/testdata).

- Babbage: block `db19fcfaba30607e363113b0a13616e6a9da5aa48b86ec2c033786f0a2e13f7d`, slot 76204984.
- Conway: block `27807a70215e3e018eec9be8c619c692e06a78ebcb63daf90d7abe823f3bbf47`, slot 159835207.

The tests use the corresponding mainnet epoch nonces to exercise complete KES, operational-certificate, VRF, and block-body verification.

`babbage_host_state_tx_validity_block.hex` is a deterministic, cryptographically signed synthetic Babbage block. Transaction zero has a HostState-shaped normal output and collateral return and is marked phase-2 invalid, while transaction one is a valid HostState control.

The fixture uses block number and slot `1`, an epoch nonce of 32 `0x55` bytes, `100` slots per KES period, and deterministic VRF, KES, and cold-key seeds filled with `0x66`, `0x77`, and `0x88` respectively. It was generated with gouroboros v0.196.0 signing utilities and is decoded and authenticated by the repository's pinned v0.205.4 verifier in the tests. The invalid and valid transaction hashes are `3e9ffe7e260c65730f2b1f9795faa55d18b104f432781806b85f19bc299eca8b` and `fa257a312429d9d354114f1a5932f137445acd48aac6045e66ffd3c4d6328207`.

The `native-boundary-*.json.gz` fixtures contain deterministic signed synthetic Praos chains with authenticated complete bodies. The `gateway-boundary-*.pb.gz` files contain the actual protobuf headers constructed by Gateway from those chains. Gzip reduces repository fixture size only. The submitted witnesses use ordinary uncompressed protobuf bytes. Regenerate the native fixtures with `UPDATE_NATIVE_BOUNDARY_FIXTURE=1 go test ./state -run TestNativeBoundaryFixture` in the core module. Then regenerate the Gateway headers by running its stability-anchor contract test with the same environment variable. Both SDK modules consume these exact Gateway bytes.

`native-recovery.json.gz` contains the signed Cardano source history for
`caribic test --light-client challenge-recovery --network v8-classic`. It has a
trusted checkpoint at height 966 and ordinary updates through height 1125.
The histories cross epochs 7, 8 and 9. A settled fork diverges at height 980.
A separate control differs only in the temporary tail after the height 1001
anchor. Complete signed bodies include HostState and packet-lane continuations
with five ICS-20 commitments and the corresponding source escrow outputs.
The source uses an accelerated slot clock. Host deadlines still use real time.

Regenerate it in the v8 module with
`UPDATE_NATIVE_RECOVERY_FIXTURE=1 go test . -run '^TestAcceptanceSourceContinuity$' -count=1 -timeout=10m`.
That test also runs in the normal Go suite and checks channel and packet proofs
against the signed fixture's roots. Run
`caribic test --light-client challenge-recovery --network v8-classic` to check the
live host with the regenerated history.
The v8 driver supplies packet transaction bodies to `TestExportAcceptanceHistory`
in the core module. That generator signs every native header and derives the
rollover nonces from the preceding signed history. The driver checks the proofs
against their roots and runs the resulting evidence through the real v8 host.

`native-heartbeat-free.json.gz` uses one-second slots and 100,000-slot epochs
with the normal 48-hour trusting period. The only transaction updates a packet
lane at height 1125. It adds a transfer commitment and records a receipt and ACK.
HostState is never spent. `gateway-heartbeat-free.pb.gz` is the ordinary
observation built by Gateway at the following empty block.

`TestRouteContinuesWithoutHostStateHeartbeats` starts with an established v8
route and sends packets before the idle interval. Rootless checkpoints cross two
epochs and keep the client active for more than 48 hours. The test then consumes
the exact Gateway header and verifies receipt, acknowledgement and timeout
processing through the IBC and ICS-20 keepers at the fresh height. It checks the
voucher balance and rejects timeout use of the old proof height. This is a signed
synthetic Cardano history with a virtual uninterrupted destination clock. It does
not admit the source transaction on a live Cardano ledger or run a live relayer.

To regenerate it, first run this in the v8 module:

```sh
UPDATE_HEARTBEAT_FREE_FIXTURE=1 go test . -run '^TestExportHeartbeatFreeHistory$' -count=1
```

Then run this in Gateway with its usual built workspace dependencies:

```sh
UPDATE_HEARTBEAT_FREE_FIXTURE=1 npm test -- --runInBand --coverage=false --runTestsByPath src/query/test/query.service.stability-anchor-contract.spec.ts --testNamePattern 'fresh ordinary observation after idle epochs'
```

Finally run `go test . -run '^TestRouteContinuesWithoutHostStateHeartbeats$' -count=1`
in the v8 module. Normal tests read both saved fixtures without regenerating them.

`preview-block-4846910.cbor.gz` is Preview block `4,846,910` at slot `127751193` in epoch `1478`. Its hash is `ecea5dca941ec52645d41bc8f6a161793511c6323c50e32bf24b236c50117684`. The raw block came from a fully synchronized Preview node through Yaci Store. Its height and hash were also checked against Blockfrost. It contains nested CBOR that exceeds the fallback decoder's former limit of 32. The test uses epoch nonce `25e7ec25915768e9f511635286ab9b7bfc4b66c0ca64cd674a10a8e5d54b7ee2` to check native verification and rejects a changed body under the same signed header.
