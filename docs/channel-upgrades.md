# Channel upgrades

This implements [issue #631](https://github.com/cardano-foundation/cardano-ibc-incubator/issues/631): an ICS-04 channel upgrade that moves a Cardano ICS-20 transfer channel to a replacement connection. The channel keeps its identifiers, ordering and version, so vouchers, escrow and denomination traces stay valid. Packets in flight settle before the switch. It requires a fresh deployment of the Cardano contracts and the probabilistic Cardano light client of this release on the counterparty.

## Scope

| Change or situation | Cardano |
| --- | --- |
| Replace the channel's connection | Supported |
| Change version or ordering | Rejected |
| Non-transfer ports | Rejected |
| ibc-go v8 counterparty | Supported, with this release's Cardano light client |
| ibc-go v10 counterparty | Unsupported, v10 removed channel upgrades |
| Proposal initiated by Cardano | Supported |
| Proposal initiated by the counterparty | Supported once Cardano proposes too (crossing hellos) |
| Height-based upgrade timeout | Rejected, Cardano uses timestamps |

The connection is the part of a channel that names its light clients. Replacing it is how a channel survives the replacement of a client that cannot be recovered or upgraded in place.

## Protocol

Cardano follows `ibc-go` v8.7.0 with these differences:

- **The deployment authority chooses Cardano's connection.** INIT requires the signature of the HostState `deployer`. TRY only answers a counterparty proposal that crosses Cardano's own, so a relayer never picks the connection. Every other step is permissionless.
- **Steps fail instead of writing error receipts.** Where `ibc-go` would answer TRY, ACK or CONFIRM with an error receipt, the Cardano transaction fails. CANCEL and TIMEOUT restore the channel and write a receipt as `ibc-go` does, and so does an INIT that replaces an unflushed proposal.
- **Cardano opens after its counterparty.** `ibc-go` v8.7.0 compares the wrong connection IDs when deciding whether a counterparty already opened, so a FLUSHCOMPLETE counterparty can still time out after Cardano opened. Cardano's OPEN requires the counterparty to be OPEN on its replacement connection, and Cardano's TIMEOUT compares the counterparty's own hop.
- **Flushing is certified per packet lane.** See below.

Every proof, including OPEN's, is verified through the channel's current connection, so the client being replaced authenticates the handover. Cardano commits the upgrade and the latest error receipt under the `ibc-go` paths `channelUpgrades/upgrades/...` and `channelUpgrades/upgradeError/...`.

Closing proofs carry the counterparty's upgrade sequence (`counterparty_upgrade_sequence` in `MsgChannelCloseConfirm` and `MsgTimeoutOnClose`). An authority cancel on one end leaves the two ends at different sequences.

## Flushing and replay protection

Transfer packets live in the channel's packet lanes, not in the channel datum. When Cardano starts flushing (TRY, or ACK on an open channel), the upgrade records the send sequencer's next sequence. New sends need an open channel, so this boundary is exact. The upgrade timeout is the transaction's upper validity bound plus the proposal's timeout period, which must be between one hour and 30 days.

While flushing, Cardano still settles acknowledgements and timeouts of its own packets. Once the counterparty's upgrade is recorded, Cardano receives only packets below the counterparty's `next_sequence_send`, which the counterparty sent before its upgrade. FLUSH certifies that lanes hold no commitments, in order and without a proof. The channel reaches FLUSHCOMPLETE once every lane is certified and the counterparty's upgrade is recorded. The Gateway certifies up to eight drained lanes per transaction.

OPEN sets the channel's receive start to the counterparty's `next_sequence_send`. Packets below it settled on the old connection and are rejected afterwards, which `ibc-go` also does.

Upgrade transactions may spend only the channel, HostState and key-locked inputs, and mint only their markers. They cannot move escrow, vouchers or other IBC state.

## Planned migration

1. Create a replacement client and open a replacement connection between the two chains with the usual handshake. Its Cardano end must support unordered channels.
2. Propose the upgrade on Cardano. The Cardano deployment authority signs INIT, so Hermes must run with the HostState deployer's key:

   ```shell
   hermes tx chan-upgrade-init --chain <cardano-chain> --channel channel-0 \
     --connection <replacement-connection> --timeout-period-ms 86400000
   ```

   The timeout period is how long the counterparty has to open once Cardano starts flushing, from one hour to 30 days.
3. Hermes completes the handshake: TRY on the counterparty, ACK on Cardano, then CONFIRM or ACK on the counterparty. While Cardano flushes, Hermes certifies its drained packet lanes. Once both ends finish flushing, it opens the counterparty first and then Cardano. Each step can also be sent by hand with `hermes tx chan-upgrade-try`, `-ack`, `-confirm`, `-open` and `hermes tx chan-upgrade-flush --chain <cardano-chain> --channel channel-0`.
4. If the handshake stalls, the authority can cancel on Cardano before it finishes flushing with `hermes tx chan-upgrade-authority-cancel --chain <cardano-chain> --channel channel-0`. After the upgrade timeout, anyone can submit TIMEOUT with a proof of the counterparty channel (`hermes tx chan-upgrade-timeout`). Either writes an error receipt, and Hermes then cancels on the counterparty.

A counterparty-initiated upgrade also needs Cardano's INIT with matching fields. Hermes then sends TRY to Cardano.

## Costs

The validators of every step need at most 7.0M memory and 3.2G CPU, excluding the verify-proof mint. TIMEOUT is the most expensive step. See `report:tx-budget-models`.
