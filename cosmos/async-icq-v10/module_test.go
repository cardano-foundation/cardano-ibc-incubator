package asyncicq

import (
	"encoding/base64"
	"encoding/hex"
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

const testQueryPath = "/example.v1.Query/Item"

const (
	vesselOracleQueryPath = "/vesseloracle.vesseloracle.Query/ConsolidatedDataReport"
	vesselOraclePacketHex = "7b2264617461223a22436b6f4b44776f484f5455794e544d7a4f4243412b2b2b77426849334c335a6c63334e6c6247397959574e735a5335325a584e7a5a577876636d466a624755755558566c636e6b765132397563323973615752686447566b5247463059564a6c6347397964413d3d227d"
	vesselOracleValueHex  = "0a3d0a07393532353333381080fbefb006180c2001289097f0b00630f89ef0b006387840f001485f520541524255455a0e636f736d6f733163726561746f72"
	vesselOracleAckHex    = "7b22726573756c74223a2265794a6b59585268496a6f695132744e4e6c4233627a6c445a324d31546c524a4d55313654545246535551334e7a6442523064426432644255326c526243394464304a7152445275646b4e33516d706f4e46465151554a54526a6c54516c564755314673566b5a585a7a5671596a4e4f6447497a5458685a4d30707357566853646d4e725a33456966513d3d227d"
)

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
			testQueryPath: func(ctx sdk.Context, req *abci.RequestQuery) (*abci.ResponseQuery, error) {
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
	}, []string{testQueryPath})

	ack := module.OnRecvPacket(ctx, Version, channeltypes.Packet{
		Data: mustEncodeTestPacket(t, []abci.RequestQuery{{
			Data:   []byte("payload"),
			Path:   testQueryPath,
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

func TestVesselOracleWireCompatibility(t *testing.T) {
	packetData, err := hex.DecodeString(vesselOraclePacketHex)
	require.NoError(t, err)
	responseValue, err := hex.DecodeString(vesselOracleValueHex)
	require.NoError(t, err)

	ctx := newAsyncIcqTestContext(t, 42)
	module := NewIBCModule(stubQueryRouter{
		handlers: map[string]baseapp.GRPCQueryHandler{
			vesselOracleQueryPath: func(_ sdk.Context, req *abci.RequestQuery) (*abci.ResponseQuery, error) {
				require.Equal(t, vesselOracleQueryPath, req.Path)
				return &abci.ResponseQuery{Value: responseValue, Height: 999}, nil
			},
		},
	}, []string{vesselOracleQueryPath})

	ack := module.OnRecvPacket(ctx, Version, channeltypes.Packet{Data: packetData}, nil)
	require.Equal(t, vesselOracleAckHex, hex.EncodeToString(ack.Acknowledgement()))
}

func TestOnRecvPacketRejectsProofRequests(t *testing.T) {
	ctx := newAsyncIcqTestContext(t, 55)
	module := NewIBCModule(stubQueryRouter{handlers: map[string]baseapp.GRPCQueryHandler{}}, []string{testQueryPath})

	ack := module.OnRecvPacket(ctx, Version, channeltypes.Packet{
		Data: mustEncodeTestPacket(t, []abci.RequestQuery{{
			Data:   []byte("payload"),
			Path:   testQueryPath,
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
		ChainID: "async-icq-host-test-0",
		Height:  55,
	}, false, log.NewNopLogger())

	module := NewIBCModule(stubQueryRouter{
		handlers: map[string]baseapp.GRPCQueryHandler{
			testQueryPath: func(ctx sdk.Context, _ *abci.RequestQuery) (*abci.ResponseQuery, error) {
				// A sloppy query handler must not be able to persist state or leak
				// events through the generic async-ICQ host.
				ctx.KVStore(queryKey).Set([]byte("written"), []byte("value"))
				ctx.EventManager().EmitEvent(sdk.NewEvent("async-icq-query-side-effect"))
				return &abci.ResponseQuery{Code: 0}, nil
			},
		},
	}, []string{testQueryPath})

	ack := module.OnRecvPacket(ctx, Version, channeltypes.Packet{
		Data: mustEncodeTestPacket(t, []abci.RequestQuery{{
			Path:   testQueryPath,
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

func TestValidateHandshakeDefaultsVersionAndRejectsInvalidParameters(t *testing.T) {
	version, err := validateHandshake(channeltypes.UNORDERED, PortID, "")
	require.NoError(t, err)
	require.Equal(t, Version, version)

	_, err = validateHandshake(channeltypes.UNORDERED, "transfer", Version)
	require.Error(t, err)

	_, err = validateHandshake(channeltypes.ORDERED, PortID, Version)
	require.Error(t, err)

	_, err = validateHandshake(channeltypes.UNORDERED, PortID, "unsupported")
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
		ChainID: "async-icq-host-test-0",
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
