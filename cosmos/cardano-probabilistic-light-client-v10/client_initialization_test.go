package probabilistic

import (
	"bytes"
	"encoding/json"
	"os"
	"testing"

	storetypes "cosmossdk.io/store/types"
	state "github.com/cardano-foundation/cardano-ibc-incubator/cosmos/cardano-probabilistic-light-client-core/state"
	codectypes "github.com/cosmos/cosmos-sdk/codec/types"
	sdk "github.com/cosmos/cosmos-sdk/types"
	clienttypes "github.com/cosmos/ibc-go/v10/modules/core/02-client/types"
	"github.com/stretchr/testify/require"
	"google.golang.org/protobuf/encoding/protowire"
)

// This consumes the actual Gateway protobuf replies, including its native Go
// preparation process, instead of creating a second Go-only initialization plan.
func TestGatewayClientInitialization(t *testing.T) {
	path := os.Getenv("CLIENT_INITIALIZATION_FIXTURE")
	if path == "" {
		t.Skip("Gateway integration supplies CLIENT_INITIALIZATION_FIXTURE")
	}
	raw, err := os.ReadFile(path)
	require.NoError(t, err)
	var responses [][]byte
	require.NoError(t, json.Unmarshal(raw, &responses))
	require.Greater(t, len(responses), 1)
	decode := func(raw []byte) map[protowire.Number]*codectypes.Any {
		values := map[protowire.Number]*codectypes.Any{}
		for len(raw) > 0 {
			number, kind, n := protowire.ConsumeTag(raw)
			require.Greater(t, n, 0)
			require.Equal(t, protowire.BytesType, kind)
			value, n2 := protowire.ConsumeBytes(raw[n:])
			require.Greater(t, n2, 0)
			var envelope codectypes.Any
			require.NoError(t, envelope.Unmarshal(value))
			values[number] = &envelope
			raw = raw[n+n2:]
		}
		return values
	}
	initial := decode(responses[0])
	var client ClientState
	var consensus ConsensusState
	require.NoError(t, client.Unmarshal(initial[1].Value))
	require.NoError(t, consensus.Unmarshal(initial[2].Value))
	require.Equal(t, state.StorageVersion, client.StorageVersion)
	app, ctx, _ := newBoundaryTestApp(t, consensus.GetTime())
	signer := sdk.AccAddress(bytes.Repeat([]byte{9}, 20)).String()
	create, err := clienttypes.NewMsgCreateClient(&client, &consensus, signer)
	require.NoError(t, err)
	require.NoError(t, create.ValidateBasic())
	_, err = app.MsgServiceRouter().Handler(create)(ctx, create)
	require.NoError(t, err)
	id := ModuleName + "-0"
	private := app.IBCKeeper.ClientKeeper.ClientStore(ctx, id)
	installed, found := getClientState(private, app.AppCodec())
	require.True(t, found)
	require.True(t, installed.BootstrapPending)
	require.NotEqual(t, make([]byte, 32), installed.StorageNamespace)
	for index, response := range responses[1:] {
		reply := decode(response)
		var header ProbabilisticHeader
		require.NoError(t, header.Unmarshal(reply[3].Value))
		require.Equal(t, uint32(index+1), header.ObservationChunk.Sequence)
		update, err := clienttypes.NewMsgUpdateClient(id, &header, signer)
		require.NoError(t, err)
		require.NoError(t, update.ValidateBasic())
		ctx = ctx.WithGasMeter(storetypes.NewGasMeter(state.MaxOperationGas))
		_, err = app.MsgServiceRouter().Handler(update)(ctx, update)
		require.NoError(t, err)
		installed, found = getClientState(private, app.AppCodec())
		require.True(t, found)
		require.LessOrEqual(t, installed.Size(), state.MaxClientBytes)
	}
	require.False(t, installed.BootstrapPending)
	// Completion verified the Mithril certificate of the initial stake table.
	require.Equal(t, installed.CurrentEpoch, installed.MithrilEpoch)
	saved, found := GetConsensusState(private, app.AppCodec(), installed.LatestHeight)
	require.True(t, found)
	require.LessOrEqual(t, saved.Size(), state.MaxConsensusBytes)
	require.Equal(t, consensus.CheckpointReference, saved.CheckpointReference)
}
