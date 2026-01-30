# Cross-chain Swap

Cross-chain swap is a feature allows us to leverage IBC connections to swap assets on the exchanges of other networks. In this project, we attempt to swap native assets of Cardano on the DEX of Osmosis through an IBC connection with a packet-forwarding chain we operate (a Cosmos chain dedicated to bridging).

To support this, the packet-forwarding chain must implement [Packet Forward Middleware](https://github.com/cosmos/ibc-apps/tree/main/middleware/packet-forward-middleware). This middleware allows messages from Cardano relay to Osmosis without requiring a direct connection between Cardano and Osmosis.

Setting up and executing cross-chain swap is a bit complicated, so we written scripts [setup_crosschain_swaps.sh](https://github.com/cardano-foundation/cardano-ibc-incubator/blob/main/chains/osmosis/scripts/setup_crosschain_swaps.sh) and [swap.sh](https://github.com/cardano-foundation/cardano-ibc-incubator/blob/main/swap.sh) to automate these processes. This document is based on steps on these scripts, you can refer them for more detail.

## Setup

Setup cross-chain swap involves these steps: 
- Create IBC connections `Cardano<=>PacketForwardingChain`, `PacketForwardingChain<=>Osmosis`.
- Transfer tokens from Cardano to Osmosis to provide liquidity.
- Create swap pools in Osmosis with pairs of transferred tokens and desired tokens.
- Config the `swap_router` and `crosschain_swap` contract on Osmosis.

### Create IBC connections

This step includes creating channels on the transfer port among chains, allowing us to transfer and swap tokens on these channels. To create connection between Cardano and the packet-forwarding chain, we use custom `go-relayer` that supports Cardano. Connection between the packet-forwarding chain and Osmosis is just a standard Cosmos IBC connection, so we can use any existing relayer like `hermes` or `go-relayer`.

### Transfer tokens from Cardano to Osmosis

After we establish connections, we can transfer assets from Cardano to Osmosis. The transfer message is like a normal one except that an extra field memo is set on FungiblePacketData. This field allows the packet-forwarding chain's PFM (Packet Forward Middleware) to relay the transfer message to Osmosis.

```
{
  "forward": {
    "receiver": "osmo1receiver",
    "port": "transfer",
    "channel": "sidechain-to-osmosis-channel-id"
  }
}
```

### Create swap pool

With Cardano token transferred to Osmosis, we can use it as liquidity to create swap pool on Osmosis. Pool is created by using Osmosis `GAMM` module with a desired token pair.

Config file for pool:
```
{
 "weights": "1ibc/transferred-cardano-token,5uosmo",
 "initial-deposit": "1000000ibc/transferred-cardano-token,1000000uosmo",
 "swap-fee": "0.01",
 "exit-fee": "0.01",
 "future-governor": ""
}
```

Command to create pool with `osmosisd`:
```
osmosisd tx gamm create-pool [config-file] --from --chain-id
```

### Config contracts

There are 2 versions of cross-chain swap on Osmosis. Since V2 requires chains to have direct connections to Osmosis, we use V1 so that we can manually set the swap routes and destinations of swaps.

With cross-chain swap V1, there are 2 contracts we must deploy and configure: swaprouter and crosschain_swaps. Configuring them involves many operations, so you can refer to [this link](https://github.com/cardano-foundation/cardano-ibc-incubator/blob/main/chains/osmosis/scripts/setup_crosschain_swaps.sh) for more detail. After configuring, we should save the address of the `crosschain_swaps` contract because we need to call it when executing swap messages.

## Execute cross-chain swap

Similar to the transfer message to provide liquidity mentioned earlier, cross-chain swap messages have additional information in `memo` field. Besides the forward to Osmosis part, the memo also contains details about triggering [IBC Hook](https://github.com/cosmos/ibc-apps/blob/main/modules/ibc-hooks/README.md) to the crosschain_swaps contract and another forward part to transfer the swapped token back from the sidechain to Cardano. Here is a sample memo for a cross-chain swap message:

```
{
  "forward": {
    "receiver": "crosschain_swaps address",
    "port": "transfer",
    "channel": "sidechain_to_osmosis_channel_id",
    "next": {
      "wasm": {
        "contract": "crosschain_swaps address",
        "msg": {
          "osmosis_swap": {
            "output_denom": "uosmo",
            "slippage": {
              "min_output_amount": "1"
            },
            "receiver": "cosmos1receiver",
            "on_failed_delivery": "do_nothing",
            "next_memo": {
              "forward": {
                "receiver": "cardano receiver public key hash",
                "port": "transfer",
                "channel": "sidechain_to_cardano_channel_id"
              }
            }
          }
        }
      }
    }
  }
}
```

With this memo, we can send a transfer message to Cardano and the swap operations are automatically unwrapped and relayed by sidechain and relayers.
