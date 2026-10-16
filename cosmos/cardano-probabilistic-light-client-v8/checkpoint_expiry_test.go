package probabilistic

import (
	"encoding/json"
	"testing"
	"time"

	sdk "github.com/cosmos/cosmos-sdk/types"
	clienttypes "github.com/cosmos/ibc-go/v8/modules/core/02-client/types"
	commitmenttypes "github.com/cosmos/ibc-go/v8/modules/core/23-commitment/types"
	"github.com/cosmos/ibc-go/v8/modules/core/exported"
	"github.com/stretchr/testify/require"
)

// Use signed Praos history through the SDK keeper so its client status gate
// cannot hide a failure to refresh expiry in the shared state machine.
func TestAppCheckpointProgressRefreshesExpiry(t *testing.T) {
	var fixture capacityFixture
	require.NoError(t, json.Unmarshal(readBoundaryGzip(t, "native-boundary-control.json.gz"), &fixture))
	fixture.Client.TrustingPeriod = 12 * time.Hour
	initialTime := time.Unix(0, int64(fixture.Consensus.Timestamp))
	app, ctx, store := newBoundaryTestApp(t, initialTime)
	cdc := app.AppCodec()
	require.NoError(t, fixture.Client.Initialize(ctx, cdc, store, fixture.Consensus))
	client, found := getClientState(store, cdc)
	require.True(t, found)
	rootHeight := client.LatestHeight
	rootBefore, found := GetConsensusState(store, cdc, rootHeight)
	require.True(t, found)
	processedTime, found := GetProcessedTime(store, rootHeight)
	require.True(t, found)
	processedHeight, found := GetProcessedHeight(store, rootHeight)
	require.True(t, found)
	signer := sdk.AccAddress(make([]byte, 20)).String()
	submit := func(header *ProbabilisticHeader) error {
		msg, err := clienttypes.NewMsgUpdateClient(ModuleName+"-0", header, signer)
		require.NoError(t, err)
		_, err = app.MsgServiceRouter().Handler(msg)(ctx, msg)
		return err
	}

	for _, anchor := range []uint64{967, 970, 975} {
		header := boundaryCheckpointAt(t, fixture.Header, client.LatestCheckpointHeight.RevisionHeight, anchor)
		header.NewEpochContext = nil
		header.DescendantBlocks = header.DescendantBlocks[:24]
		now := time.Unix(0, int64(header.DescendantBlocks[23].Timestamp))
		if anchor == 975 {
			// The original root has expired but the preceding checkpoint has not.
			now = initialTime.Add(client.TrustingPeriod + time.Second)
			require.True(t, client.IsExpired(rootBefore.Timestamp, now))
		}
		ctx = ctx.WithBlockTime(now)
		require.Equal(t, exported.Active, client.Status(ctx, store, cdc))

		before := recoveryStoreSnapshot(t, store)
		invalid := fromCoreProbabilisticHeader(toCoreProbabilisticHeader(header))
		invalid.AnchorBlock.Hash = testBlockHash("forged-checkpoint")
		require.Error(t, submit(invalid))
		require.Equal(t, before, recoveryStoreSnapshot(t, store))
		require.NoError(t, submit(header))
		client, found = getClientState(store, cdc)
		require.True(t, found)
		require.Equal(t, header.AnchorBlock.Timestamp, client.LatestCheckpointTimestamp)
		require.Equal(t, header.AnchorBlock.Height, client.LatestCheckpointHeight)
		require.Equal(t, rootHeight, client.LatestHeight)
		require.Equal(t, exported.Active, client.Status(ctx, store, cdc))

		rootAfter, found := GetConsensusState(store, cdc, rootHeight)
		require.True(t, found)
		require.Equal(t, rootBefore, rootAfter)
		currentTime, found := GetProcessedTime(store, rootHeight)
		require.True(t, found)
		require.Equal(t, processedTime, currentTime)
		currentHeight, found := GetProcessedHeight(store, rootHeight)
		require.True(t, found)
		require.Equal(t, processedHeight, currentHeight)
		_, found = GetConsensusState(store, cdc, header.GetHeight())
		require.False(t, found)
		_, err := client.GetTimestampAtHeight(ctx, store, cdc, header.GetHeight())
		require.ErrorIs(t, err, clienttypes.ErrConsensusStateNotFound)
		path := commitmenttypes.NewMerklePath("ibc", "connections/connection-0")
		require.ErrorIs(t, client.VerifyMembership(ctx, store, cdc, header.GetHeight(), 0, 0, nil, path, nil), ErrProcessedTimeNotFound)
		require.ErrorIs(t, client.VerifyNonMembership(ctx, store, cdc, header.GetHeight(), 0, 0, nil, path), ErrProcessedTimeNotFound)

		before = recoveryStoreSnapshot(t, store)
		require.Error(t, submit(header), "replaying a checkpoint must not renew trust")
		require.Equal(t, before, recoveryStoreSnapshot(t, store))
	}

	expiresAt := time.Unix(0, int64(client.LatestCheckpointTimestamp)).Add(client.TrustingPeriod)
	ctx = ctx.WithBlockTime(expiresAt.Add(-time.Nanosecond))
	require.Equal(t, exported.Active, client.Status(ctx, store, cdc))
	ctx = ctx.WithBlockTime(expiresAt)
	require.Equal(t, exported.Expired, client.Status(ctx, store, cdc))

	// Even a signed update containing recent blocks cannot revive the client.
	next := boundaryCheckpointAt(t, fixture.Header, client.LatestCheckpointHeight.RevisionHeight, 1001)
	before := recoveryStoreSnapshot(t, store)
	require.ErrorIs(t, client.VerifyClientMessage(ctx, cdc, store, next), ErrTrustingPeriodExpired)
	require.ErrorIs(t, submit(next), clienttypes.ErrClientNotActive)
	require.Equal(t, before, recoveryStoreSnapshot(t, store))
	ctx = ctx.WithBlockTime(time.Unix(0, int64(next.DescendantBlocks[len(next.DescendantBlocks)-1].Timestamp)))
	require.Less(t, ctx.BlockTime().Sub(time.Unix(0, int64(next.AnchorBlock.Timestamp))), client.TrustingPeriod)
	require.ErrorIs(t, client.VerifyClientMessage(ctx, cdc, store, next), ErrTrustingPeriodExpired)
	require.ErrorIs(t, submit(next), clienttypes.ErrClientNotActive)
	require.Equal(t, before, recoveryStoreSnapshot(t, store))
}
