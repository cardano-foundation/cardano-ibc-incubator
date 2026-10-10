A stake table could previously introduce a pool identity and its VRF key while claiming that the pool registered long ago. The client now keeps those facts in `latest_checkpoint_pool_registry`. Each stake row must match the registry's effective snapshot. The header's issuer key determines its pool identity and the header's VRF key must match the registered hash. Only stake allocation remains subject to the epoch challenge.

The registry contains current registrations, pending VRF changes and retirements. It also keeps the `mark` and `effective` registration snapshots. These contain identities, keys and authenticated first registration slots. They contain no balances or delegation records. Retired records remain available so re-registration preserves the first registration slot.

For every bridge block and anchor the client authenticates the complete body against its verified header. It reads pool certificates in transaction order and certificate order. It checks transaction-body signatures from the pool operator and registration owners. Certificates in transactions marked invalid do not apply. Settlement descendants verify the anchor but their certificates do not advance its saved registry. Later updates process their complete bodies from that anchor. Missing bodies or registration state reject the update.

At rollover the client takes a new `mark` snapshot before applying pending registrations and retirements. The old `mark` becomes `effective`. A new pool registered in epoch `e` enters the effective snapshot in `e + 2`. An existing pool's replacement VRF key becomes ledger-current in `e + 1` and effective in `e + 3`. A retirement due in epoch `r` removes the pool from the effective snapshot in `r + 2`. Re-registration cancels a scheduled retirement. This follows the ordering of [`SNAP`, pending pool parameters and `POOLREAP` in Cardano's epoch rule](https://github.com/IntersectMBO/cardano-ledger/blob/cardano-ledger-shelley-1.11.0.0/eras/shelley/impl/src/Cardano/Ledger/Shelley/Rules/Epoch.hs) and the [pool certificate rule](https://github.com/IntersectMBO/cardano-ledger/blob/cardano-ledger-shelley-1.11.0.0/eras/shelley/impl/src/Cardano/Ledger/Shelley/Rules/Pool.hs).

Each retained consensus state stores its own `pool_registry`. Rootless checkpoints and saved challenge checkpoints also retain the matching registry. Recovery copies the substitute's registry and checks agreement with its consensus state when their heights match. An invalid identity, key or age is rejected immediately. It cannot become trusted through the challenge deadline and a mismatch alone does not prove chain misbehaviour.

Bootstrap requires an authenticated or explicitly trusted registry at the initial block. Gateway requires `CARDANO_POOL_REGISTRY_CHECKPOINT_FILE`. This JSON file must identify the exact chain, settled block height, slot, hash and epoch used for client creation. Build its current records and frozen snapshots from native ledger state at that point. Establish first registration slots from authenticated certificate history or an explicitly trusted source. Use slot `0` only for a known genesis registration. A current pool table cannot reconstruct pending changes, frozen snapshots or registration history. Gateway does not infer this file from the candidate table.

The same file must now contain `production` at that exact chain point. Each pool record has `completed_epochs_bitmap` and `produced_current_epoch`. Bit `0` records production in the immediately preceding completed epoch and bit `4` records production five epochs ago. The current flag records production through the checkpoint's anchor. Build these from authenticated block history or an explicitly trusted source. Do not infer them from registration age, epoch table rows or relayer-supplied production counts. Omitted pools grant no recent-production qualification. Omit a record when both its bitmap and current flag are empty.

The file uses version `1`. All unsigned integers except `version` are decimal strings. Hashes are lowercase hex. Each binding has `pool_id`, `vrf_key_hash` and `first_registration_slot`. Each pool record includes `registration`, `registered`, `pending_vrf_key_hash`, `pending_effective_epoch` and `retirement_epoch`. An empty pending hash and epoch `"0"` mean no pending change. Retirement epoch `"0"` means none. `mark` and `effective` are arrays of bindings. For example this is the shape of an explicitly trusted genesis-pool checkpoint. Replace the example identifiers and hashes with independently established values.

```json
{
  "version": 1,
  "chain_id": "cardano-devnet",
  "height": "123",
  "slot": "456",
  "block_hash": "0000000000000000000000000000000000000000000000000000000000000000",
  "registry": {
    "epoch": "7",
    "pools": [{
      "registration": {
        "pool_id": "pool1...",
        "vrf_key_hash": "1111111111111111111111111111111111111111111111111111111111111111",
        "first_registration_slot": "0"
      },
      "registered": true,
      "pending_vrf_key_hash": "",
      "pending_effective_epoch": "0",
      "retirement_epoch": "0"
    }],
    "mark": [{
      "pool_id": "pool1...",
      "vrf_key_hash": "1111111111111111111111111111111111111111111111111111111111111111",
      "first_registration_slot": "0"
    }],
    "effective": [{
      "pool_id": "pool1...",
      "vrf_key_hash": "1111111111111111111111111111111111111111111111111111111111111111",
      "first_registration_slot": "0"
    }]
  },
  "production": {
    "epoch": "7",
    "pools": [{
      "pool_id": "pool1...",
      "completed_epochs_bitmap": "1",
      "produced_current_epoch": true
    }]
  }
}
```

This remains reapplication under an explicit consensus assumption that accepted block bodies are ledger-valid. The client checks body commitments and the certificate signatures described above. It does not independently run every transaction, script, fee, deposit or protocol-parameter rule. In particular the native maximum retirement horizon still relies on that assumption. Protocol changes that alter snapshot or certificate rules need a corresponding client update. Authentic registration history does not authenticate stake amounts. An attacker controlling eligible historical pool keys can still submit false stake allocation and that allocation still needs the existing challenge process.
