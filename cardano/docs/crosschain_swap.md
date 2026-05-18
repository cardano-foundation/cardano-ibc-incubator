# Cross-chain Swap

Cross-chain swap uses IBC connections to move Cardano-native assets to a target chain such as Osmosis or Injective, execute target-chain swap logic, and return the result where the route requires it.

The route must be direct: Cardano connects to the selected target chain. The retired intermediary-chain topology is not part of the maintained runtime path because it placed another consensus system in the value path.

## Quick run

For the local Osmosis demo:

```bash
caribic start --clean
caribic chain start --chain osmosis --network local
caribic setup route --from cardano --to osmosis --to-network local
caribic demo token-swap --chain osmosis --network local
```

The demo command calls [`chains/osmosis/scripts/run_direct_token_swap.sh`](../../chains/osmosis/scripts/run_direct_token_swap.sh). That script sets up the Osmosis swap contracts and submits the direct Cardano-to-Osmosis swap.

For the local Injective transfer-leg demo:

```bash
caribic start --clean
caribic chain start --chain injective --network local
caribic setup route --from cardano --to injective --to-network local
caribic demo token-swap --chain injective --network local
```

## Direct Route Requirements

Direct setup creates or reuses:

- A target-chain client on Cardano, usually Tendermint/CometBFT.
- A Cardano light client on the target chain.
- A direct Cardano-to-target connection.
- A direct transfer channel.

The target chain must compile and register the Cardano light client and must allow the Cardano client type in its IBC client parameters. If that is missing, Hermes client creation on the target chain will fail before channel setup.

For local/devnet Cosmos chains, this means the chain binary used by the local stack must be patched with the Cardano light client module before route setup.

## Osmosis Swap Setup

The local Osmosis swap still has the same application-level steps as the older demo. The difference is that every IBC hop uses the direct Cardano-to-Osmosis channel pair.

Setup includes:

- Create or reuse the direct Cardano-to-Osmosis transfer channel.
- Transfer Cardano assets directly to Osmosis to provide liquidity.
- Create an Osmosis pool for the transferred Cardano voucher and `uosmo`.
- Deploy and configure `swaprouter`.
- Deploy and configure `crosschain_swaps`.
- Submit a Cardano transfer directly to the `crosschain_swaps` contract with an IBC hooks memo.
- Return the swapped `uosmo` directly over the Osmosis-to-Cardano channel.

### Create Direct IBC Connections

Create the direct route with:

```bash
caribic setup route --from cardano --to osmosis --to-network local
```

The command creates:

- A Tendermint/CometBFT client for Osmosis on Cardano.
- A Cardano probabilistic light client on Osmosis.
- A direct connection between Cardano and Osmosis.
- A direct transfer channel.

The resulting channel pair is passed to the swap script as:

```bash
CARDANO_OSMOSIS_CHANNEL_ID=channel-0
OSMOSIS_CARDANO_CHANNEL_ID=channel-0
```

The exact channel IDs can differ between local runs.

### Transfer Liquidity to Osmosis

The pool bootstrap step sends a Cardano token directly to Osmosis:

```bash
hermes tx ft-transfer \
  --src-chain cardano-devnet \
  --dst-chain localosmosis \
  --src-port transfer \
  --src-channel "$CARDANO_OSMOSIS_CHANNEL_ID" \
  --amount 1000000 \
  --denom "$CARDANO_TOKEN_DENOM" \
  --receiver "$OSMOSIS_DEPLOYER_ADDRESS" \
  --timeout-seconds 3600
```

After the packet is relayed, Osmosis receives an IBC voucher denom such as:

```text
ibc/<hash>
```

That voucher denom is used as the pool input denom.

### Create the Osmosis Pool

The local demo creates a GAMM pool with the transferred Cardano voucher and `uosmo`:

```json
{
  "weights": "1ibc/<hash>,1uosmo",
  "initial-deposit": "1000000ibc/<hash>,1000000uosmo",
  "swap-fee": "0.01",
  "exit-fee": "0.01",
  "future-governor": "168h"
}
```

The pool is created with:

```bash
osmosisd tx gamm create-pool --pool-file "$POOL_FILE" ...
```

The resulting pool ID is used when configuring `swaprouter`.

### Configure swaprouter

The script stores and instantiates `swaprouter.wasm`, then sets the route from the Cardano voucher denom to `uosmo`:

```json
{
  "set_route": {
    "input_denom": "ibc/<hash>",
    "output_denom": "uosmo",
    "pool_route": [
      {
        "pool_id": "1",
        "token_out_denom": "uosmo"
      }
    ]
  }
}
```

### Configure crosschain_swaps

The script stores and instantiates `crosschain_swaps.wasm` with the `swaprouter` contract and the direct Osmosis-to-Cardano return channel:

```json
{
  "governor": "osmo1...",
  "swap_contract": "osmo1...",
  "channels": [
    ["cardano", "channel-0"]
  ]
}
```

The channel value is `OSMOSIS_CARDANO_CHANNEL_ID`, not a channel to an intermediary chain.

## Execute the Swap

The swap is submitted as an ICS-20 transfer from Cardano directly to the Osmosis `crosschain_swaps` contract:

```bash
hermes tx ft-transfer \
  --src-chain cardano-devnet \
  --dst-chain localosmosis \
  --src-port transfer \
  --src-channel "$CARDANO_OSMOSIS_CHANNEL_ID" \
  --amount 12345 \
  --denom "$CARDANO_TOKEN_DENOM" \
  --receiver "$CROSSCHAIN_SWAPS_ADDRESS" \
  --timeout-seconds 3600 \
  --memo "$SWAP_MEMO"
```

The memo uses IBC hooks to execute the Osmosis swap contract:

```json
{
  "wasm": {
    "contract": "osmo1crosschainswaps...",
    "msg": {
      "osmosis_swap": {
        "output_denom": "uosmo",
        "slippage": {
          "min_output_amount": "1"
        },
        "receiver": "ibc:channel-0/<cardano-receiver-public-key-hash>",
        "on_failed_delivery": "do_nothing",
        "next_memo": {}
      }
    }
  }
}
```

The `receiver` field tells the contract to return the swapped tokens over the direct Osmosis-to-Cardano channel. It has this format:

```text
ibc:<OSMOSIS_CARDANO_CHANNEL_ID>/<cardano-receiver-public-key-hash>
```

No packet-forward memo is needed for the Cardano-to-Osmosis hop because Cardano is connected directly to Osmosis.

## Operational Notes

Use `caribic setup route` before running swap demos if you want to validate the direct IBC path independently from swap contract setup. A successful route setup prints the Cardano channel id and the target-chain counterparty channel id.

The local Osmosis swap script consumes the direct channel pair produced by `caribic setup route`: Cardano sends directly to the Osmosis crosschain-swaps contract, and the contract returns over the direct Osmosis-to-Cardano channel.

With a direct channel, packet-forwarding through an intermediary is no longer required for the first hop. If a target-chain swap uses packet-forward middleware or IBC hooks internally, those modules should be configured against the direct Cardano channel or against target-local downstream channels that do not reintroduce the retired intermediary chain.

If direct setup fails, check:

- The selected target chain is running and reachable by Hermes.
- Hermes has funded keys for Cardano and the target chain.
- The target chain has the Cardano light client registered and allowed.
- The target chain exposes transfer, and any swap-specific modules required by the selected demo.
