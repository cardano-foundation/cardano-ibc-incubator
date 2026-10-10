`praos_nonce_node.json.gz` contains 91 contiguous Conway blocks and 82 native
protocol-state observations from `cardano-node 9.1.0` at commit
`176f99e51155cb3eaa0711db1c3c969d67438958`. The observations came from
`cardano-cli conway query protocol-state` while the node was forging on an
isolated single-pool network. They were matched to the node-to-client block
stream by `lastSlot`. The first observation is the trusted starting checkpoint.
The fixture contains public headers and bodies. It contains no signing keys.

The network starts in Conway with `securityParam = 2`, `activeSlotsCoeff = 1/4`,
`epochLength = 120`, `slotLength = 0.2`, `slotsPerKESPeriod = 100000`, and
`maxKESEvolutions = 60`. Conway uses the randomness window `4*k/f = 32` slots.
The capture covers slots 803 through 1159 in epochs 6 through 9. It includes
blocks before and after the candidate cutoff and three epoch transitions.
The client tests also resume from saved points with different update sizes and
temporary settlement descendants. Exact cutoff equality and overflow are
covered separately in `state/nonce_test.go`.

To capture a new fixture from a running network with these parameters, run this
from `cosmos/cardano-probabilistic-light-client-core` while it is producing blocks:

```sh
go run ../../scripts/ci/capture-praos-nonce-reference.go --socket /path/to/node.socket
```

The capture utility has flags for the network parameters and output path.
Use the protocol's configured randomness window for the era being captured.
Babbage uses `3*k/f` and Conway uses `4*k/f` in the reference implementation.
It is not safe to reuse one value across a transition that changes this rule.
