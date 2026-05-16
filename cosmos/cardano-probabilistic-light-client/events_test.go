package probabilistic

import (
	"testing"
	"time"

	"cosmossdk.io/log"
	"cosmossdk.io/store"
	"cosmossdk.io/store/metrics"
	storetypes "cosmossdk.io/store/types"
	cmtproto "github.com/cometbft/cometbft/proto/tendermint/types"
	dbm "github.com/cosmos/cosmos-db"
	"github.com/cosmos/cosmos-sdk/runtime"
	sdk "github.com/cosmos/cosmos-sdk/types"
	clienttypes "github.com/cosmos/ibc-go/v10/modules/core/02-client/types"
	"github.com/stretchr/testify/require"
)

func TestEmitProbabilisticHeaderAcceptedEvent(t *testing.T) {
	ctx, _ := newProbabilisticTestClientStore(t, "probabilistic-events-accepted")
	clientID := "08-cardano-probabilistic-0"
	header := newVerifiedTestHeader(t)
	clientState := newProbabilisticTestClientState()
	consensusState := newProbabilisticTestConsensusState(header.AnchorBlock.Hash)

	emitProbabilisticHeaderAcceptedEvent(ctx, clientID, header, clientState, consensusState, clientState.CurrentEpoch)

	event := findEventByType(t, ctx.EventManager().Events(), EventTypeProbabilisticHeaderAccepted)
	require.Equal(t, clientID, eventAttributeValue(t, event, AttributeKeyClientID))
	require.Equal(t, header.TrustedHeight.String(), eventAttributeValue(t, event, AttributeKeyTrustedHeight))
	require.Equal(t, header.GetHeight().String(), eventAttributeValue(t, event, AttributeKeyAcceptedHeight))
	require.Equal(t, header.AnchorBlock.Hash, eventAttributeValue(t, event, AttributeKeyAcceptedBlockHash))
	require.Equal(t, "7", eventAttributeValue(t, event, AttributeKeyPreviousEpoch))
	require.Equal(t, "false", eventAttributeValue(t, event, AttributeKeyRollover))
	require.Equal(t, "1", eventAttributeValue(t, event, AttributeKeyDescendantDepth))
	require.Equal(t, "1", eventAttributeValue(t, event, AttributeKeyUniquePoolsCount))
	require.Equal(t, "10000", eventAttributeValue(t, event, AttributeKeyUniqueStakeBps))
}

func TestLightClientModuleVerifyClientMessageEmitsRejectedEvent(t *testing.T) {
	ctx, clientStore, module, clientID := newProbabilisticTestModule(t, "probabilistic-events-rejected")
	cdc := newProbabilisticTestCodec()

	clientState := newProbabilisticTestClientState()
	clientState.LatestHeight = NewHeight(0, 11)
	setClientState(clientStore, cdc, clientState)

	header := newVerifiedTestHeader(t)
	err := module.VerifyClientMessage(ctx, clientID, header)
	require.ErrorContains(t, err, "must equal latest height")

	event := findEventByType(t, ctx.EventManager().Events(), EventTypeProbabilisticHeaderRejected)
	require.Equal(t, clientID, eventAttributeValue(t, event, AttributeKeyClientID))
	require.Equal(t, header.TrustedHeight.String(), eventAttributeValue(t, event, AttributeKeyTrustedHeight))
	require.Equal(t, header.GetHeight().String(), eventAttributeValue(t, event, AttributeKeyAcceptedHeight))
	require.Contains(t, eventAttributeValue(t, event, AttributeKeyReason), "must equal latest height")
}

func TestLightClientModuleUpdateStateOnMisbehaviourEmitsFrozenEvent(t *testing.T) {
	ctx, clientStore, module, clientID := newProbabilisticTestModule(t, "probabilistic-events-frozen")
	cdc := newProbabilisticTestCodec()

	clientState := newProbabilisticTestClientState()
	setClientState(clientStore, cdc, clientState)

	module.UpdateStateOnMisbehaviour(ctx, clientID, nil)

	event := findEventByType(t, ctx.EventManager().Events(), EventTypeProbabilisticClientFrozen)
	require.Equal(t, clientID, eventAttributeValue(t, event, AttributeKeyClientID))
	require.Equal(t, FrozenHeight.String(), eventAttributeValue(t, event, AttributeKeyFrozenHeight))
	require.Equal(t, "misbehaviour", eventAttributeValue(t, event, AttributeKeyReason))
}

func newProbabilisticTestModule(t *testing.T, keyName string) (sdk.Context, storetypes.KVStore, LightClientModule, string) {
	t.Helper()

	db := dbm.NewMemDB()
	stateStore := store.NewCommitMultiStore(db, log.NewNopLogger(), metrics.NewNoOpMetrics())
	key := storetypes.NewKVStoreKey(keyName)

	stateStore.MountStoreWithDB(key, storetypes.StoreTypeIAVL, db)
	require.NoError(t, stateStore.LoadLatestVersion())

	ctx := sdk.NewContext(stateStore, cmtproto.Header{
		ChainID: "cardano-probabilistic-test",
		Height:  100,
		Time:    time.Unix(1_700_000_000, 0),
	}, false, log.NewNopLogger())

	storeProvider := clienttypes.NewStoreProvider(runtime.NewKVStoreService(key))
	clientID := "08-cardano-probabilistic-0"
	return ctx, storeProvider.ClientStore(ctx, clientID), NewLightClientModule(newProbabilisticTestCodec(), storeProvider), clientID
}

func findEventByType(t *testing.T, events sdk.Events, eventType string) sdk.Event {
	t.Helper()

	for _, event := range events {
		if event.Type == eventType {
			return event
		}
	}

	t.Fatalf("event %s not found", eventType)
	return sdk.Event{}
}

func eventAttributeValue(t *testing.T, event sdk.Event, key string) string {
	t.Helper()

	for _, attribute := range event.Attributes {
		if string(attribute.Key) == key {
			return string(attribute.Value)
		}
	}

	t.Fatalf("attribute %s not found on event %s", key, event.Type)
	return ""
}
