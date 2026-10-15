package probabilistic

import (
	"sync"
	"testing"

	storetypes "cosmossdk.io/store/types"
	"github.com/cardano-foundation/cardano-ibc-incubator/cosmos/cardano-probabilistic-light-client-core/mithril"
	"github.com/cardano-foundation/cardano-ibc-incubator/cosmos/cardano-probabilistic-light-client-core/mithril/mithriltest"
	state "github.com/cardano-foundation/cardano-ibc-incubator/cosmos/cardano-probabilistic-light-client-core/state"
	"github.com/cosmos/cosmos-sdk/codec"
	sdk "github.com/cosmos/cosmos-sdk/types"
	"github.com/stretchr/testify/require"
)

var (
	bootstrapNetworkOnce sync.Once
	bootstrapNetwork     *mithriltest.Network
)

// certifyBootstrap anchors a trusted client to a local Mithril network and
// returns the certificate that completes its bootstrap.
func certifyBootstrap(t testing.TB, client *ClientState) []byte {
	t.Helper()
	bootstrapNetworkOnce.Do(func() {
		var err error
		bootstrapNetwork, err = mithriltest.NewNetwork(100, 200, 300)
		require.NoError(t, err)
	})
	entries, err := state.BootstrapStakeTable(toCoreClientState(client))
	require.NoError(t, err)
	root, err := mithril.StakeDistributionRoot(entries)
	require.NoError(t, err)
	anchor, certificate, err := bootstrapNetwork.Bootstrap(client.CurrentEpoch, root)
	require.NoError(t, err)
	client.MithrilEpoch = anchor.Epoch
	client.MithrilAggregateVerificationKey = anchor.AggregateVerificationKey
	client.MithrilProtocolParametersHash = anchor.ProtocolParametersHash
	return []byte(certificate)
}

func initializeTrusted(t testing.TB, ctx sdk.Context, cdc codec.BinaryCodec, store storetypes.KVStore, client *ClientState, consensus *ConsensusState) (*ClientState, *ConsensusState, error) {
	t.Helper()
	return InitializeFromTrustedCheckpoint(ctx, cdc, store, client, consensus, certifyBootstrap(t, client))
}

func buildTrustedBootstrap(t testing.TB, store storetypes.KVStore, client *ClientState, consensus *ConsensusState) (*ClientState, *ConsensusState, []*ProbabilisticHeader, error) {
	t.Helper()
	return BuildBootstrap(store, client, consensus, certifyBootstrap(t, client))
}
