package probabilistic

import (
	"testing"
	"time"

	storetypes "cosmossdk.io/store/types"
	"github.com/cosmos/cosmos-sdk/runtime"
	"github.com/cosmos/cosmos-sdk/testutil"
	clientkeeper "github.com/cosmos/ibc-go/v10/modules/core/02-client/keeper"
	clienttypes "github.com/cosmos/ibc-go/v10/modules/core/02-client/types"
	connectionkeeper "github.com/cosmos/ibc-go/v10/modules/core/03-connection/keeper"
	connectiontypes "github.com/cosmos/ibc-go/v10/modules/core/03-connection/types"
	channelkeeper "github.com/cosmos/ibc-go/v10/modules/core/04-channel/keeper"
	channeltypes "github.com/cosmos/ibc-go/v10/modules/core/04-channel/types"
	commitmenttypes "github.com/cosmos/ibc-go/v10/modules/core/23-commitment/types"
	"github.com/stretchr/testify/require"
)

func TestOrderedTimeoutWithCardanoNextSequenceRecv(t *testing.T) {
	fixture := loadNextSequenceRecvFixture(t)
	var vector nextSequenceRecvVector
	for _, candidate := range fixture.Vectors {
		if candidate.Sequence == "1" {
			vector = candidate
		}
	}
	require.Equal(t, "1", vector.Sequence)
	proof := nextSequenceRecvProof(t, fixture, vector)

	for name, claimedSequence := range map[string]uint64{"wrong sequence": 0, "unreceived packet": 1} {
		t.Run(name, func(t *testing.T) {
			key := storetypes.NewKVStoreKey("ibc")
			testContext := testutil.DefaultContextWithDB(t, key, storetypes.NewTransientStoreKey("transient"))
			t.Cleanup(func() { require.NoError(t, testContext.DB.Close()) })
			ctx := testContext.Ctx.WithChainID("cosmos-1").WithBlockHeight(100).WithBlockTime(time.Unix(1_700_000_000, 0))
			cdc := newProbabilisticTestCodec()
			storeService := runtime.NewKVStoreService(key)

			clients := clientkeeper.NewKeeper(cdc, storeService, nil, nil)
			clients.SetParams(ctx, clienttypes.Params{AllowedClients: []string{ModuleName}})
			clients.AddRoute(ModuleName, NewLightClientModule(cdc, clients.GetStoreProvider()))
			clientID := ModuleName + "-0"
			client := newProbabilisticTestClientState()
			consensus := newProbabilisticTestConsensusState("authenticated-cardano-block")
			consensus.IbcStateRoot = nextSequenceRecvHex(t, vector.Root)
			require.NoError(t, client.Initialize(ctx, cdc, clients.ClientStore(ctx, clientID), consensus))

			connections := connectionkeeper.NewKeeper(cdc, storeService, nil, clients)
			connections.SetParams(ctx, connectiontypes.DefaultParams())
			connections.SetConnection(ctx, "connection-0", connectiontypes.ConnectionEnd{
				State: connectiontypes.OPEN, ClientId: clientID,
				Versions: connectiontypes.GetCompatibleVersions(),
				Counterparty: connectiontypes.Counterparty{
					ClientId: "07-tendermint-0", ConnectionId: "connection-1",
					Prefix: commitmenttypes.NewMerklePrefix([]byte("ibc")),
				},
			})
			channels := channelkeeper.NewKeeper(cdc, storeService, clients, connections)
			channels.SetChannel(ctx, "mock", "channel-1", channeltypes.Channel{
				State: channeltypes.OPEN, Ordering: channeltypes.ORDERED,
				Counterparty:   channeltypes.Counterparty{PortId: "mock", ChannelId: "channel-0"},
				ConnectionHops: []string{"connection-0"}, Version: "mock-1",
			})
			height := clienttypes.NewHeight(0, 10)
			packet := channeltypes.NewPacket([]byte("ordered payload"), 1, "mock", "channel-1", "mock", "channel-0", height, 0)
			commitment := channeltypes.CommitPacket(packet)
			channels.SetPacketCommitment(ctx, packet.SourcePort, packet.SourceChannel, packet.Sequence, commitment)

			version, err := channels.TimeoutPacket(ctx, packet, proof, height, claimedSequence)
			channel, found := channels.GetChannel(ctx, packet.SourcePort, packet.SourceChannel)
			require.True(t, found)
			if claimedSequence == 0 {
				require.ErrorContains(t, err, "value mismatch")
				require.Equal(t, channeltypes.OPEN, channel.State)
				require.Equal(t, commitment, channels.GetPacketCommitment(ctx, packet.SourcePort, packet.SourceChannel, packet.Sequence))
			} else {
				require.NoError(t, err)
				require.Equal(t, "mock-1", version)
				require.Equal(t, channeltypes.CLOSED, channel.State)
				require.Empty(t, channels.GetPacketCommitment(ctx, packet.SourcePort, packet.SourceChannel, packet.Sequence))
			}
		})
	}
}
