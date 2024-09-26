### 1. Mithril Version Overview

#### 1.1 Entities Involved

| Entity         | Component                    | Description                                                                                               | Version / Reference                                                                                                                                  | Type            |
|----------------|------------------------------|-----------------------------------------------------------------------------------------------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------|-----------------|
| **Cardano**    | **Cardano Node**              | Manages the Cardano blockchain.                                                                            | [v9.1.0](https://github.com/IntersectMBO/cardano-node/releases/tag/9.1.0)                                                                           | Infrastructure  |
|                | **Aiken IBC Contracts**       | Contracts for handling IBC transactions on Cardano.                                                        | [Documentation](https://github.com/cardano-foundation/cardano-ibc-incubator/tree/draft/aiken-contract-docs/cardano/docs)                            | Core            |
|                | **Cardano Db Sync**           | Used by the Gateway to query IBC events.                                                                   | [v13.1.1.3](https://github.com/IntersectMBO/cardano-db-sync/pkgs/container/cardano-db-sync/160873989?tag=13.1.1.3)                                  | Infrastructure  |
|                | **Kupmios (Kupo + Ogmios)**   | Supports transaction building and submission.                                                              | [Kupo v2.5.0](https://hub.docker.com/layers/cardanosolutions/kupo/v2.5.0/images/sha256-0055667e640bfb1c80504d302912daa1284381256e0433a8c07e473200fc962e?context=explore), [Ogmios v6.5.0](https://github.com/CardanoSolutions/ogmios/tree/v6.5.0) | Infrastructure  |
|                | **Mithril Protocol**          | Supports IBC transaction proof generation, enhancing chain synchronization and security.                   | [Documentation](https://github.com/input-output-hk/mithril)                                                                                          | Infrastructure  |
| **Sidechain**  | **IBC Module**                | Manages IBC packet transfers.                                                                              | [ibc-go](https://github.com/cosmos/ibc-go)                                                                                                          | Core            |
|                | **Packet Forward Middleware** | Applies a commission fee of 10% on token transfers.                                                        | [v8.0.1](https://github.com/cosmos/ibc-apps/releases/tag/middleware%2Fpacket-forward-middleware%2Fv8.0.1)                                           | Core            |
|                | **Interchain Transfer Module**| Module for fungible token transfer between different blockchains via IBC.                                   | [ICS-020](https://github.com/cosmos/ibc/blob/main/spec/app/ics-020-fungible-token-transfer/README.md)                                                | Core            |
| **Relayers**   | **Customized Go-Relayer**     | Transfers messages between Cardano and the Sidechain.                                                      | Forked from [Cosmos Relayer](https://github.com/cosmos/relayer) and customized                                                                       | Core            |
|                | **Hermes Relayer**            | Facilitates message transfers between the Sidechain and Osmosis.                                           | [main](https://github.com/informalsystems/hermes)                                                                                                    | Infrastructure  |
| **Osmosis**    | **IBC Module**                | Manages IBC transactions on Osmosis.                                                                       | [ibc-go](https://github.com/cosmos/ibc-go)                                                                                                          | Core            |
|                | **CosmWasm Contracts**        | Cross-chain swap, swap router, and various pool contracts.                                                 | [v1](https://github.com/cardano-foundation/cardano-ibc-incubator/tree/v1.0.2-non-mithril-x-swap/chains/osmosis/configuration/cosmwasm/contracts)     | Core            |
| **IBC Applications** | **IBC Transfer/Swap Application** | Enables token swaps and transfers across chains.                                                         |                                                                                                                                                     | App             |
|                | **IBC Explorer**              | Provides insights and tracking for IBC transactions and chain state.                                        |                                                                                                                                                     | App             |
|                | **Subql - Multichain Indexer**| Indexes and queries IBC transactions across multiple chains.                                                |                                                                                                                                                     | App             |
| **Library**    | **ouroboros-miniprotocols-ts**| A lightweight TypeScript library for handling Ouroboros mini-protocols, useful for cross-chain communication.|                                                                                                                                                     | App             |
|                | **custom-lucid**              | Extended Lucid library for custom transaction building on Cardano.                                          |                                                                                                                                                     | Core            | 

### 1.2 Fees Involved

| Fee Type                         | Description                                                                                          |
|----------------------------------|------------------------------------------------------------------------------------------------------|
| **Swap Fee**                     | Set during the creation of a pool. Applied when swapping.                                                                   |
| **Exit Fee**                     | Applied when liquidity providers withdraw their liquidity.                                            |
| **Packet Forwarding Commission** | A default 10% fee applied on the Sidechain for packet forwarding.                                     |

### 1.3 Swap Execution Flow

| Step | Description                                                                                                       |
|------|-------------------------------------------------------------------------------------------------------------------|
| 1    | **User Initiation**: User initiates a swap through the frontend dApp with details like `TokenIn`, `TokenOut`, etc.|
| 2    | **TransferPacket Message Sent**: The dApp sends a `TransferPacket Msg` containing transfer packet, forwarding data, and swap data.|
| 3    | **Relayers and Sidechain Processing**: Go-Relayer forwards the packet to Sidechain, Sidechain deducts commission, and Hermes Relayer forwards to Osmosis.|
| 4    | **Swap on Osmosis**: Osmosis executes the swap, deducts swap fees, and prepares the return TransferPacket with the swapped tokens.|
| 5    | **Return to Cardano**: Tokens are returned to Cardano via the Sidechain, with commission deducted again, and finally delivered to the user.|

![Overview Flow](./static/cardano-ibc-swap-flow.drawio.svg)

### 1.4 Steps to Deploy Swap Contract on Osmosis

| Step                    | Description                                                                                                               |
|-------------------------|---------------------------------------------------------------------------------------------------------------------------|
| **Initial Setup**        | 1. Deploy Swap Router Contract<br>2. Deploy Cross-Chain Swap Contract and instantiate with Swap Router Address.          |
| **Subsequent Steps**     | 1. Deploy Pool Contract with `TokenIn` and `TokenOut`.<br>2. Call `set_route()` to configure swap routes.<br>3. Provide liquidity to the pool. |

![Crosschain Swap Contract Overview](./static/cardano-ibc-swap-cross-chain-swap-contract-overview.drawio.svg)


| Calculation Step                 | Formula                                                                                                          |
|----------------------------------|------------------------------------------------------------------------------------------------------------------|
| **Sidechain Commission Fee**      | `(1 - commission_fee) * x`                                                                                       |
| **Swap Execution on Osmosis**     | `(1 - commission_fee) * x * (1 - swap_fee) * rate`                                                                                   |
| **Return to Cardano**             | `(1 - commission_fee)^2 * x * (1 - swap_fee) * rate`                           |

### References

- [**Osmosis Pool Setup**](https://docs.osmosis.zone/overview/integrate/pool-setup/#weighted-pool)
- [**Packet Forwarding Middleware**](https://github.com/cosmos/ibc-apps/tree/main/middleware/packet-forward-middleware)