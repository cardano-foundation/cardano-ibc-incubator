# Root-authoritative packet state

Cardano IBC commits its ICS-24 state in `HostState.ibc_state_root`. Packet
commitments, receipts, and acknowledgement commitments are authoritative in
that Merkle tree; they are not duplicated in the live channel datum. A channel
UTxO therefore contains only the channel end and its three sequence counters,
so packet history cannot make the datum grow or expire after a fixed number of
transfers.

Each packet transaction carries the Merkle witnesses for one typed transition.
Send proves that its commitment leaf is absent and inserts the packet
commitment. Receive proves that the acknowledgement leaf, and for an unordered
channel the receipt leaf, are absent before inserting the receipt marker and
the acknowledgement produced by the authenticated application callback.
Acknowledge and timeout prove that the exact packet commitment exists before
deleting it. The HostState validator applies these changes to the input root
and accepts the transaction only when the result equals the output root.

The Gateway keeps the Merkle leaves off chain so it can construct update
witnesses, answer packet queries, and generate counterparty proofs. Its
persisted checkpoint and update journal are verified by recomputing every root
up to the root found in the on-chain HostState; corrupted or invented off-chain
state therefore fails closed. An unavailable proof store can stop transaction
construction or queries, but it cannot forge packet state, and another indexer
can serve the same data when it has a verified checkpoint and journal.

This change removes unbounded packet history from the live UTxO, not from the
logical IBC history. Receipt and acknowledgement leaves remain in the Merkle
store until a separately authenticated cleanup protocol makes old packets
permanently ineligible for replay. The channel datum encoding and validator
hashes change, so deployments using the previous datum shape must be redeployed
or explicitly migrated rather than mixing old and new channel UTxOs.

The existing sparse tree derives its path from the first 64 bits of the key
hash and fails closed if two keys collide. That is not an immediate practical
replacement for the former 64-entry datum limit, but a wider or collision-safe
path scheme is still required before treating the logical tree as literally
unbounded at very high scale.
