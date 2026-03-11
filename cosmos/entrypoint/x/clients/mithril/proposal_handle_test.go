package mithril

import (
	"bytes"
	"encoding/hex"
	"testing"
	"time"

	"cosmossdk.io/log"
	store "cosmossdk.io/store"
	"cosmossdk.io/store/metrics"
	storetypes "cosmossdk.io/store/types"
	cmtproto "github.com/cometbft/cometbft/proto/tendermint/types"
	dbm "github.com/cosmos/cosmos-db"
	"github.com/cosmos/cosmos-sdk/codec"
	codectypes "github.com/cosmos/cosmos-sdk/codec/types"
	sdk "github.com/cosmos/cosmos-sdk/types"
	clienttypes "github.com/cosmos/ibc-go/v10/modules/core/02-client/types"
	"github.com/stretchr/testify/require"
)

func TestCheckSubstituteAndUpdateState(t *testing.T) {
	cdc := newTestCodec()
	ctx, subjectStore := newTestClientStore(t, "subject")
	_, substituteStore := newTestClientStore(t, "substitute")

	subjectState := newTestClientState(10, 4, "cardano-old", 24*time.Hour)
	frozenHeight := FrozenHeight
	subjectState.FrozenHeight = &frozenHeight
	setClientState(subjectStore, cdc, subjectState)

	substituteState := newTestClientState(20, 6, "cardano-new", 48*time.Hour)
	setClientState(substituteStore, cdc, substituteState)

	consensusState := newTestConsensusState(0x11)
	setConsensusState(substituteStore, cdc, consensusState, substituteState.LatestHeight)
	setConsensusMetadataWithValues(substituteStore, substituteState.LatestHeight, NewHeight(0, 50), 123456789)

	err := subjectState.CheckSubstituteAndUpdateState(ctx, cdc, subjectStore, substituteStore, substituteState)
	require.NoError(t, err)

	recoveredClient, found := getClientState(subjectStore, cdc)
	require.True(t, found)
	require.Equal(t, substituteState.LatestHeight.String(), recoveredClient.LatestHeight.String())
	require.EqualValues(t, substituteState.CurrentEpoch, recoveredClient.CurrentEpoch)
	require.Equal(t, substituteState.ChainId, recoveredClient.ChainId)
	require.Equal(t, substituteState.TrustingPeriod, recoveredClient.TrustingPeriod)
	require.NotNil(t, recoveredClient.FrozenHeight)
	require.True(t, recoveredClient.FrozenHeight.IsZero())

	recoveredConsensus, found := GetConsensusState(subjectStore, cdc, substituteState.LatestHeight)
	require.True(t, found)
	require.Equal(t, consensusState.LatestCertHashTxSnapshot, recoveredConsensus.LatestCertHashTxSnapshot)
	require.Equal(t, consensusState.FirstCertHashLatestEpoch.Hash, recoveredConsensus.FirstCertHashLatestEpoch.Hash)

	processedHeight, found := GetProcessedHeight(subjectStore, substituteState.LatestHeight)
	require.True(t, found)
	require.Equal(t, NewHeight(0, 50).String(), processedHeight.String())

	processedTime, found := GetProcessedTime(subjectStore, substituteState.LatestHeight)
	require.True(t, found)
	require.EqualValues(t, 123456789, processedTime)

	recoveredFirstCert := getFcInEpoch(subjectStore, substituteState.CurrentEpoch)
	require.Equal(t, consensusState.FirstCertHashLatestEpoch.Hash, recoveredFirstCert.Hash)

	recoveredLatestTs := getLcTsInEpoch(subjectStore, substituteState.CurrentEpoch)
	require.Equal(t, consensusState.LatestCertHashTxSnapshot, recoveredLatestTs.Hash)

	recoveredMSDCert := getMSDCertificateWithHash(subjectStore, consensusState.FirstCertHashLatestEpoch.Hash)
	require.Equal(t, consensusState.FirstCertHashLatestEpoch.Hash, recoveredMSDCert.Hash)
}

func TestCheckSubstituteAndUpdateStateRejectsMismatchedRecoveryParameters(t *testing.T) {
	cdc := newTestCodec()
	ctx, subjectStore := newTestClientStore(t, "subject")
	_, substituteStore := newTestClientStore(t, "substitute")

	subjectState := newTestClientState(10, 4, "cardano-a", 24*time.Hour)
	substituteState := newTestClientState(20, 6, "cardano-b", 48*time.Hour)
	substituteState.HostStateNftTokenName = []byte("different-host-state")

	err := subjectState.CheckSubstituteAndUpdateState(ctx, cdc, subjectStore, substituteStore, substituteState)
	require.ErrorIs(t, err, clienttypes.ErrInvalidSubstitute)
	require.ErrorContains(t, err, "subject client state does not match substitute client state")
}

func TestLightClientModuleVerifyUpgradeAndUpdateStateReturnsUnsupported(t *testing.T) {
	lightClientModule := LightClientModule{}

	err := lightClientModule.VerifyUpgradeAndUpdateState(sdk.Context{}, "08-cardano-0", nil, nil, nil, nil)
	require.ErrorIs(t, err, clienttypes.ErrInvalidUpgradeClient)
	require.ErrorContains(t, err, "cannot upgrade mithril client")
}

func TestClientStateGetLatestHeightReturnsCoreHeight(t *testing.T) {
	clientState := newTestClientState(10, 4, "cardano-test", 24*time.Hour)

	height := clientState.GetLatestHeight()
	coreHeight, ok := height.(clienttypes.Height)
	require.True(t, ok)
	require.Equal(t, clienttypes.NewHeight(0, 10), coreHeight)

	clientState.LatestHeight = nil
	zeroHeight, ok := clientState.GetLatestHeight().(clienttypes.Height)
	require.True(t, ok)
	require.True(t, zeroHeight.IsZero())
}

func newTestCodec() codec.BinaryCodec {
	registry := codectypes.NewInterfaceRegistry()
	RegisterInterfaces(registry)
	return codec.NewProtoCodec(registry)
}

func newTestClientStore(t *testing.T, keyName string) (sdk.Context, storetypes.KVStore) {
	t.Helper()

	db := dbm.NewMemDB()
	stateStore := store.NewCommitMultiStore(db, log.NewNopLogger(), metrics.NewNoOpMetrics())
	key := storetypes.NewKVStoreKey(keyName)

	stateStore.MountStoreWithDB(key, storetypes.StoreTypeIAVL, db)
	require.NoError(t, stateStore.LoadLatestVersion())

	ctx := sdk.NewContext(stateStore, cmtproto.Header{
		ChainID: "entrypoint-test",
		Height:  100,
		Time:    time.Unix(1_700_000_000, 0),
	}, false, log.NewNopLogger())

	return ctx, stateStore.GetKVStore(key)
}

func newTestClientState(latestHeight, currentEpoch uint64, chainID string, trustingPeriod time.Duration) *ClientState {
	zeroHeight := ZeroHeight()

	return &ClientState{
		ChainId:        chainID,
		LatestHeight:   &Height{RevisionHeight: latestHeight},
		FrozenHeight:   &zeroHeight,
		CurrentEpoch:   currentEpoch,
		TrustingPeriod: trustingPeriod,
		ProtocolParameters: &MithrilProtocolParameters{
			K: 1,
			M: 1,
			PhiF: Fraction{
				Numerator:   1,
				Denominator: 1,
			},
		},
		UpgradePath:           []string{"upgrade", "upgradedIBCState"},
		HostStateNftPolicyId:  bytes.Repeat([]byte{0x01}, 28),
		HostStateNftTokenName: []byte("host-state"),
	}
}

func newTestConsensusState(seed byte) *ConsensusState {
	return &ConsensusState{
		Timestamp: uint64(time.Unix(1_700_000_000, 0).UnixNano()),
		FirstCertHashLatestEpoch: &MithrilCertificate{
			Hash: testHashHex(seed),
		},
		LatestCertHashTxSnapshot: testHashHex(seed + 1),
		IbcStateRoot:             bytes.Repeat([]byte{seed}, 32),
	}
}

func testHashHex(seed byte) string {
	return hex.EncodeToString(bytes.Repeat([]byte{seed}, 32))
}
