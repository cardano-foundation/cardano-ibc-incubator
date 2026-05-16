# Cross-chain Swap

Cross-chain swap support is paused until direct Cardano-to-target IBC routes are implemented.

The retired flow used an intermediary packet-forwarding chain. That topology is no longer part of the maintained runtime path because it made the intermediary a real production chain in the value path, with its own consensus, uptime, state-history, relayer, liveness, and security assumptions.

A replacement swap flow should use direct Cardano-to-Osmosis or Cardano-to-target clients, connections, and channels. Target chains must register the Cardano light client and enable the modules needed by the swap design, such as transfer, packet forwarding, IBC hooks, or ICQ where applicable.

Until that direct topology exists, the local swap planner and `caribic demo token-swap` fail closed.
