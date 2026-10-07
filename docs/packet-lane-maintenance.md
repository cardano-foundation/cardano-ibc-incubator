Funded intent execution does not schedule pruning. Operators must run history maintenance while traffic is running. An empty lane holds 32 receives because each receive stores a receipt and an acknowledgement in its 64-entry history limit. Sixteen empty lanes hold 512 unpruned receives in total. Outgoing commitments share this limit. This is a capacity calculation and does not establish a sustainable receive rate.

Poll `GET /api/packet-history/channel-0/occupancy` on the Gateway at least every 10 seconds for each active transfer channel. The response reads every lane at the same settled Cardano height. Alert on any lane with `maintenance_required: true` or a failed query. Maintenance is required from 48 entries onward. `remaining_receive_slots` is storage headroom at that height. Indexing delay and incoming traffic can consume it before the next poll. Use a shorter interval or lower operational alert threshold when traffic could fill eight receive slots between polls. A lane with no history pairs may need outgoing acknowledgements or timeouts instead of pruning.

Read the lanes that need maintenance and their candidate sequences with:

```sh
curl --fail --silent "$GATEWAY_URL/api/packet-history/channel-0/occupancy" |
  jq '.lanes[] | select(.maintenance_required) | {lane, entries, remaining_receive_slots, prune_candidates}'
```

`prune_candidates` identifies stored receipt and acknowledgement pairs. It does not establish that the source commitment is absent. For each candidate first ensure the acknowledgement has reached the source chain. Then run the authenticated Hermes operation using the source channel paired with this Cardano channel:

```sh
hermes --config "$HERMES_CONFIG" tx packet-prune   --dst-chain "$CARDANO_CHAIN_ID"   --src-chain "$SOURCE_CHAIN_ID"   --src-port transfer   --src-channel "$SOURCE_CHANNEL_ID"   --sequence "$SEQUENCE"
```

Hermes queries source commitment absence at a verified client height and signs and submits the Cardano pruning transaction. Cardano verifies that proof before deleting history. If the source commitment is still present relay its acknowledgement first. With a connection delay use `--proof-height REVISION-HEIGHT` for a matured authenticated height that meets the receive high-water mark and pruning floor. A proof rejected as too old needs a newer client update and another attempt. Do not delete indexed records to free capacity.

Submit maintenance transactions serially for a lane. Wait for inclusion and indexing and poll occupancy again before choosing the next sequence. Continue until the alert clears. If eligible history cannot be pruned quickly enough reduce incoming traffic while acknowledgements and client updates catch up. Keep the monitor running for the lifetime of the channel. A successful short burst is not evidence that maintenance can keep pace.

Both HTTP `POST /api/packet-history/prune` and gRPC `PrunePacketHistory` use the lane builder for the transfer port. The HTTP builder accepts the same sequence and authenticated counterparty proof as gRPC. It returns an unsigned transaction and requires operator signing and submission. Prefer the Hermes command above for the full proof and submission flow.
