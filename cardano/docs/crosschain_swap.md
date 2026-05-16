# Cross-chain Swap

Cross-chain swap uses IBC connections to move Cardano-native assets to a target chain such as Osmosis or Injective, execute target-chain swap logic, and return the result where the route requires it.

The route must be direct: Cardano connects to the selected target chain. The retired intermediary-chain topology is not part of the maintained runtime path because it placed another consensus system in the value path.

## Quick run

```bash
caribic start --clean
caribic chain start --chain osmosis --network local
caribic setup route --from cardano --to osmosis --to-network local
```

For Injective:

```bash
caribic start --clean
caribic chain start --chain injective --network local
caribic setup route --from cardano --to injective --to-network local
```

## Direct Route Requirements

Direct setup creates or reuses:

- A target-chain client on Cardano, usually Tendermint/CometBFT.
- A Cardano light client on the target chain.
- A direct Cardano-to-target connection.
- A direct transfer channel.

The target chain must compile and register the Cardano light client and must allow the Cardano client type in its IBC client parameters. If that is missing, Hermes client creation on the target chain will fail before channel setup.

## Swap Setup

Setup still involves the same application-level concerns:

- Transfer Cardano assets directly to the target chain to provide liquidity.
- Create target-chain pools for the transferred Cardano voucher and desired output token.
- Configure swap contracts or modules on the target chain.
- Configure any return route or memo needed by the target-chain swap design.

With a direct channel, packet-forwarding through an intermediary is no longer required for the first hop. If a target-chain swap uses packet-forward middleware or IBC hooks internally, those modules should be configured against the direct Cardano channel or against target-local downstream channels that do not reintroduce the retired intermediary chain.

## Operational Notes

Use `caribic setup route` before running swap demos if you want to validate the direct IBC path independently from swap contract setup. A successful route setup prints the Cardano channel id and the target-chain counterparty channel id.

The old swap execution script encoded the retired intermediary channel ids in its memo and contract setup. That script should be ported to consume the direct channel pair produced by `caribic setup route`.

If direct setup fails, check:

- The selected target chain is running and reachable by Hermes.
- Hermes has funded keys for Cardano and the target chain.
- The target chain has the Cardano light client registered and allowed.
- The target chain exposes transfer, and any swap-specific modules required by the selected demo.
