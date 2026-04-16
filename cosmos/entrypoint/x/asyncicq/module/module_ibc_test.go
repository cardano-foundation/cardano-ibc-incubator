package asyncicq

import (
	"encoding/base64"
	"encoding/json"
	"testing"

	"cosmossdk.io/log"
	"cosmossdk.io/store"
	"cosmossdk.io/store/metrics"
	storetypes "cosmossdk.io/store/types"
	abci "github.com/cometbft/cometbft/abci/types"
	cmtproto "github.com/cometbft/cometbft/proto/tendermint/types"
	dbm "github.com/cosmos/cosmos-db"
	"github.com/cosmos/cosmos-sdk/baseapp"
	sdk "github.com/cosmos/cosmos-sdk/types"
	"github.com/cosmos/gogoproto/proto"
	channeltypes "github.com/cosmos/ibc-go/v10/modules/core/04-channel/types"
	"github.com/stretchr/testify/require"
)

const testConsolidatedDataReportQueryPath = "/vesseloracle.vesseloracle.Query/ConsolidatedDataReport"

type stubQueryRouter struct {
	handlers map[string]baseapp.GRPCQueryHandler
}

func (r stubQueryRouter) Route(path string) baseapp.GRPCQueryHandler {
	return r.handlers[path]
}

func TestOnRecvPacketExecutesAllowedQuery(t *testing.T) {
	ctx := newAsyncIcqTestContext(t, 55)
	module := NewIBCModule(stubQueryRouter{
		handlers: map[string]baseapp.GRPCQueryHandler{
			testConsolidatedDataReportQueryPath: func(ctx sdk.Context, req *abci.RequestQuery) (*abci.ResponseQuery, error) {
				require.Equal(t, []byte("payload"), req.Data)
				return &abci.ResponseQuery{
					Code:      0,
					Log:       "",
					Info:      "",
					Index:     7,
					Key:       []byte("query-key"),
					Value:     []byte("query-value"),
					Height:    999,
					Codespace: "",
				}, nil
			},
		},
	}, []string{testConsolidatedDataReportQueryPath})

	ack := module.OnRecvPacket(ctx, Version, channeltypes.Packet{
		Data: mustEncodeTestPacket(t, []abci.RequestQuery{{
			Data:   []byte("payload"),
			Path:   testConsolidatedDataReportQueryPath,
			Height: 0,
			Prove:  false,
		}}),
	}, nil)

	responses := decodeAcknowledgementResponses(t, ack.Acknowledgement())
	require.Len(t, responses, 1)
	require.Equal(t, uint32(0), responses[0].Code)
	require.Equal(t, int64(7), responses[0].Index)
	require.Equal(t, []byte("query-key"), responses[0].Key)
	require.Equal(t, []byte("query-value"), responses[0].Value)
	require.Equal(t, int64(55), responses[0].Height)
}

func TestOnRecvPacketRejectsProofRequests(t *testing.T) {
	ctx := newAsyncIcqTestContext(t, 55)
	module := NewIBCModule(stubQueryRouter{handlers: map[string]baseapp.GRPCQueryHandler{}}, []string{testConsolidatedDataReportQueryPath})

	ack := module.OnRecvPacket(ctx, Version, channeltypes.Packet{
		Data: mustEncodeTestPacket(t, []abci.RequestQuery{{
			Data:   []byte("payload"),
			Path:   testConsolidatedDataReportQueryPath,
			Height: 0,
			Prove:  true,
		}}),
	}, nil)

	var outer map[string]string
	require.NoError(t, json.Unmarshal(ack.Acknowledgement(), &outer))
	require.NotEmpty(t, outer["error"])
}

func TestOnRecvPacketDoesNotPersistQuerySideEffects(t *testing.T) {
	db := dbm.NewMemDB()
	stateStore := store.NewCommitMultiStore(db, log.NewNopLogger(), metrics.NewNoOpMetrics())
	queryKey := storetypes.NewKVStoreKey("async-icq-query-side-effects")

	stateStore.MountStoreWithDB(queryKey, storetypes.StoreTypeIAVL, db)
	require.NoError(t, stateStore.LoadLatestVersion())

	ctx := sdk.NewContext(stateStore, cmtproto.Header{
		ChainID: "entrypoint-test",
		Height:  55,
	}, false, log.NewNopLogger())

	module := NewIBCModule(stubQueryRouter{
		handlers: map[string]baseapp.GRPCQueryHandler{
			testConsolidatedDataReportQueryPath: func(ctx sdk.Context, _ *abci.RequestQuery) (*abci.ResponseQuery, error) {
				// A sloppy query handler must not be able to persist state or leak
				// events through the generic async-ICQ host.
				ctx.KVStore(queryKey).Set([]byte("written"), []byte("value"))
				ctx.EventManager().EmitEvent(sdk.NewEvent("async-icq-query-side-effect"))
				return &abci.ResponseQuery{Code: 0}, nil
			},
		},
	}, []string{testConsolidatedDataReportQueryPath})

	ack := module.OnRecvPacket(ctx, Version, channeltypes.Packet{
		Data: mustEncodeTestPacket(t, []abci.RequestQuery{{
			Path:   testConsolidatedDataReportQueryPath,
			Height: 0,
			Prove:  false,
		}}),
	}, nil)

	responses := decodeAcknowledgementResponses(t, ack.Acknowledgement())
	require.Len(t, responses, 1)
	require.Equal(t, uint32(0), responses[0].Code)
	require.Nil(t, ctx.KVStore(queryKey).Get([]byte("written")))
	require.Empty(t, ctx.EventManager().Events())
}

func TestValidateHandshakeDefaultsVersionAndRejectsWrongPort(t *testing.T) {
	version, err := validateHandshake(channeltypes.UNORDERED, PortID, "")
	require.NoError(t, err)
	require.Equal(t, Version, version)

	_, err = validateHandshake(channeltypes.UNORDERED, "transfer", Version)
	require.Error(t, err)
}

func newAsyncIcqTestContext(t *testing.T, height int64) sdk.Context {
	t.Helper()

	db := dbm.NewMemDB()
	stateStore := store.NewCommitMultiStore(db, log.NewNopLogger(), metrics.NewNoOpMetrics())
	key := storetypes.NewKVStoreKey("async-icq-test")

	stateStore.MountStoreWithDB(key, storetypes.StoreTypeIAVL, db)
	require.NoError(t, stateStore.LoadLatestVersion())

	return sdk.NewContext(stateStore, cmtproto.Header{
		ChainID: "entrypoint-test",
		Height:  height,
	}, false, log.NewNopLogger())
}

func mustEncodeTestPacket(t *testing.T, requests []abci.RequestQuery) []byte {
	t.Helper()

	queryBytes, err := proto.Marshal(&cosmosQuery{Requests: requests})
	require.NoError(t, err)

	packetBytes, err := json.Marshal(interchainQueryPacketData{
		Data: base64.StdEncoding.EncodeToString(queryBytes),
	})
	require.NoError(t, err)
	return packetBytes
}

func decodeAcknowledgementResponses(t *testing.T, ackBytes []byte) []abci.ResponseQuery {
	t.Helper()

	var outer map[string]string
	require.NoError(t, json.Unmarshal(ackBytes, &outer))
	require.NotEmpty(t, outer["result"])

	resultBytes, err := base64.StdEncoding.DecodeString(outer["result"])
	require.NoError(t, err)

	var inner interchainQueryPacketAck
	require.NoError(t, json.Unmarshal(resultBytes, &inner))

	responseBytes, err := base64.StdEncoding.DecodeString(inner.Data)
	require.NoError(t, err)

	var response cosmosResponse
	require.NoError(t, proto.Unmarshal(responseBytes, &response))
	return response.Responses
}
