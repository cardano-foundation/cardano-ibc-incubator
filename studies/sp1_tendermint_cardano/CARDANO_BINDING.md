# Cardano statement binding

The succinct proof must not merely say that some Tendermint header was valid.
It must be tied to the exact client input consumed by the Cardano transaction
and the exact client output created by it.

For an update, the proved public output must contain the client chain ID, trust
level, trusting period, unbonding period, trusted height, trusted consensus
state, new height, new consensus state, and proof time. The
Aiken validator must compare those values with the consumed `ClientDatum`, the
trusted consensus state retained at that height, the transaction validity
interval, and the new `ClientDatum`. Eureka's released guest uses a fixed
15-second maximum clock drift instead of exposing that field. Aiken must
therefore apply the Cardano client's own maximum-clock-drift check to the proved
new timestamp as well. It must still enforce that the client is active, the new
height is above the current latest height, the expected
consensus history and processed metadata are written, and the same update is
committed to HostState.

The SP1 program proves the expensive ICS-07 work: the Tendermint header hash,
validator-set hashes, canonical vote bytes, Ed25519 signatures, voting-power
thresholds, trusted overlap for a skipped-height update, trusting period, and
clock drift. The Aiken validator continues to own the Cardano state transition.

The prototype outer circuit exposes the same two values that the SP1 Groth16
verifier already authenticates: the SP1 update-client program key and the
masked SHA-256 digest of Eureka's 768-byte `UpdateClientOutput`. It constrains
the SP1 exit code to zero and fixes SP1's recursion verification-key root.

The Aiken validator must pin the expected program key, receive the exact
`UpdateClientOutput` bytes, recompute SP1's masked digest, and use those two
field values as the BLS12-381 Groth16 public inputs. It must then decode or
reconstruct that canonical ABI output and compare every relevant field with
the Cardano transaction. The relayer cannot provide an independent decoded
statement without this byte-for-byte binding.

This binding intentionally makes an in-flight proof stale when another Cardano
transaction advances the same client. That is already the normal UTxO behavior
and avoids accepting a proof made for a different client state.

Misbehaviour needs a separate program key and statement. It must bind both
verified headers, both trusted heights and consensus states, and the exact
frozen client output. Membership and combined update-plus-membership proofs are
also separate programs and are outside the first prototype.
