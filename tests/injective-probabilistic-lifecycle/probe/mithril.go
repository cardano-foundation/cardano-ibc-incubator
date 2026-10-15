package main

import (
	lc "github.com/InjectiveLabs/injective-core/injective-chain/modules/cardano-probabilistic-light-client"
	"github.com/cardano-foundation/cardano-ibc-incubator/cosmos/cardano-probabilistic-light-client-core/mithril"
	"github.com/cardano-foundation/cardano-ibc-incubator/cosmos/cardano-probabilistic-light-client-core/mithril/mithriltest"
)

// The synthetic Cardano history has no Mithril network, so a local one
// certifies the bootstrap stake tables.
var localMithril = func() *mithriltest.Network {
	network, err := mithriltest.NewNetwork(100, 200, 300)
	must(err)
	return network
}()

// certifyBootstrap anchors a trusted client to the local Mithril network and
// returns the certificate that completes its bootstrap.
func certifyBootstrap(client *lc.ClientState) []byte {
	var table []mithril.StakeEntry
	for _, context := range client.EpochContexts {
		if context != nil && context.Epoch == client.CurrentEpoch {
			for _, entry := range context.StakeDistribution {
				table = append(table, mithril.StakeEntry{PoolID: entry.PoolId, Stake: entry.Stake})
			}
		}
	}
	root, err := mithril.StakeDistributionRoot(table)
	must(err)
	anchor, certificate, err := localMithril.Bootstrap(client.CurrentEpoch, root)
	must(err)
	client.MithrilEpoch = anchor.Epoch
	client.MithrilAggregateVerificationKey = anchor.AggregateVerificationKey
	client.MithrilProtocolParametersHash = anchor.ProtocolParametersHash
	return []byte(certificate)
}
