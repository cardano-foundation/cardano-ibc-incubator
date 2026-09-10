# Tendermint connection delays

Client creation and updates record the transaction's finite upper validity bound
as `processed_time`, in nanoseconds. `processed_height` is derived from that same
timestamp using `max_expected_time_per_block`. A proof transaction uses its lower
validity bound for the current time and derived height.

For a nonzero delay `D`, the time check requires:

```text
proof.valid_from >= client_update.valid_to + D
```

The ledger guarantees that each transaction is included within its validity
interval. This check therefore guarantees at least `D` between the update's
inclusion and the proof's inclusion. A lower-bound processing timestamp could
predate inclusion and shorten or eliminate that wait. Limiting interval width
alone would only bound the shortfall.

The block-delay check also starts from the upper-bound-derived processing height.
Its rounding can require waiting beyond the time-delay boundary. A zero time or
block delay skips that component's wait, so zero-delay connections remain usable
before the update's upper bound has been reached. Negative delays are rejected.

The upper bound can make a nonzero delay conservative by the remaining lifetime
of the update transaction. Gateway currently uses a two-minute transaction TTL.
It normalizes both bounds to the slot start times that Lucid encodes and the
validator sees; storing an end-of-slot millisecond timestamp would make the datum
disagree with the validator. Header clock-drift verification and history pruning
continue to use the lower bound, while client/trusted-state expiry checks use the
upper bound.

## Deployment and existing state

This change alters validator code and requires a coordinated validator and Gateway
deployment. The datum wire format is unchanged, but its processing metadata now
has a different time anchor. A Gateway update alone cannot fix deployed validators.

Ordinary updates preserve retained historical processing metadata, and recovery
preserves the substitute state's processing metadata. They cannot infer the true
inclusion time of a state previously recorded with a lower-bound anchor. Deploy
with fresh clients and connections. Any separate migration that imports old
consensus states must discard or conservatively re-anchor their metadata before
enabling nonzero-delay proof verification; importing old metadata unchanged would
preserve the vulnerability for those heights.

## Regression coverage

`cardano/onchain/validators/client_delay.test.ak` exercises client creation and
the update state transition followed by real ICS-23 membership and non-membership
verification. It covers backdated metadata, immediate proof rejection, the delay
boundary, block-delay rounding, zero delays, and the finite upper bound required
at creation. `spending_client_capacity.test.ak` separately exercises the signed
UpdateClient validator, including rejection of lower-bound processing metadata
and a missing upper bound.

Gateway tests cover slot normalization, initial and updated encoded metadata,
passing the creation bound through to the builder, and retaining history according
to the lower bound. These are local validator/service tests, not a live-network
transaction reproduction.
