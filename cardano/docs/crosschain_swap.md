# Cross-chain Swap

This document describes the current Cardano to Osmosis demo flow in this repository.

The swap path is:

1. Cardano -> Cosmos Entrypoint chain
2. Cosmos Entrypoint chain -> Osmosis (via Packet Forward Middleware memo)
3. Swap on Osmosis through `crosschain_swaps` + `swaprouter`
4. Forward result back toward Cardano

In Hermes config and scripts, the Cosmos Entrypoint chain is still referenced by the chain id `sidechain` for compatibility.

## Current expected usage

The supported entrypoint is:

```bash
caribic demo token-swap
```

This command assumes services are already running. It does not boot the whole stack itself.

### Prerequisites

Run these first:

```bash
caribic start --clean --with-mithril
caribic start osmosis
```

Then run:

```bash
caribic demo token-swap
```

## What `caribic demo token-swap` does

`caribic demo token-swap` performs the full setup and execution flow:

- verifies required services are healthy (`gateway`, Cardano node stack, Hermes, Mithril, Entrypoint, Osmosis, Redis)
- waits for Mithril artifacts required by Cardano-facing Hermes operations
- temporarily stops Hermes during setup steps to avoid account sequence contention, then restarts it
- ensures an open transfer channel exists between Cardano and the Entrypoint chain
- configures Hermes for Entrypoint <-> Osmosis transfer path
- runs `chains/osmosis/osmosis/scripts/setup_crosschain_swaps.sh`
- extracts the deployed `crosschain_swaps` address from setup output
- runs `swap.sh` with `CROSSCHAIN_SWAPS_ADDRESS` injected

On success, the command executes a full Cardano -> Osmosis swap demo path end to end.

## Scripts used by the demo

The demo is built on:

- `chains/osmosis/osmosis/scripts/setup_crosschain_swaps.sh`
- `swap.sh`

Both scripts use the local Hermes binary at:

`relayer/target/release/hermes`

They do not rely on a random Hermes binary from `PATH`.

## Token and amount inputs

The Cardano token used in this demo is read from:

`cardano/offchain/deployments/handler.json` -> `tokens.mock`

The transfer amount can be overridden with:

`CARIBIC_TOKEN_SWAP_AMOUNT`

If not set, each script uses its own default.

## Manual flow (if needed)

If you need to run steps manually:

1. Run `setup_crosschain_swaps.sh`
2. Read the printed `crosschain_swaps address`
3. Run `swap.sh` with `CROSSCHAIN_SWAPS_ADDRESS=<address>`

`caribic demo token-swap` already performs these steps automatically, so manual execution is mainly for debugging.

## Memo shape used for swap forwarding

The swap transfer uses PFM + IBC hooks memo routing. The outer shape is:

```json
{
  "forward": {
    "receiver": "<crosschain_swaps_address>",
    "port": "transfer",
    "channel": "<entrypoint_to_osmosis_channel>",
    "next": {
      "wasm": {
        "contract": "<crosschain_swaps_address>",
        "msg": {
          "osmosis_swap": {
            "output_denom": "uosmo",
            "slippage": { "min_output_amount": "1" },
            "receiver": "<cosmos_receiver>",
            "on_failed_delivery": "do_nothing",
            "next_memo": {
              "forward": {
                "receiver": "<cardano_receiver_pkh>",
                "port": "transfer",
                "channel": "<entrypoint_to_cardano_channel>"
              }
            }
          }
        }
      }
    }
  }
}
```
