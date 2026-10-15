package probabilistic

import (
	"bytes"
	"encoding/json"
	"testing"
	"time"

	"cosmossdk.io/log"
	store "cosmossdk.io/store"
	"cosmossdk.io/store/dbadapter"
	"cosmossdk.io/store/metrics"
	storetypes "cosmossdk.io/store/types"
	state "github.com/cardano-foundation/cardano-ibc-incubator/cosmos/cardano-probabilistic-light-client-core/state"
	cmtproto "github.com/cometbft/cometbft/proto/tendermint/types"
	dbm "github.com/cosmos/cosmos-db"
	"github.com/cosmos/cosmos-sdk/runtime"
	sdk "github.com/cosmos/cosmos-sdk/types"
	clienttypes "github.com/cosmos/ibc-go/v10/modules/core/02-client/types"
	connectiontypes "github.com/cosmos/ibc-go/v10/modules/core/03-connection/types"
	channeltypes "github.com/cosmos/ibc-go/v10/modules/core/04-channel/types"
	commitmenttypes "github.com/cosmos/ibc-go/v10/modules/core/23-commitment/types"
	ibcerrors "github.com/cosmos/ibc-go/v10/modules/core/errors"
	"github.com/cosmos/ibc-go/v10/modules/core/exported"
	"github.com/cosmos/ibc-go/v10/testing/simapp"
	"github.com/stretchr/testify/require"
)

func TestStakeOmissionExpiresAndRecoversThroughAuthority(t *testing.T) {
	var fixture struct {
		Client            *ClientState
		Consensus         *ConsensusState
		Header            *ProbabilisticHeader
		RecoveryClient    *ClientState
		RecoveryConsensus *ConsensusState
		OmittedPool       string
	}
	require.NoError(t, json.Unmarshal(readBoundaryGzip(t, "stake-table-omission.json.gz"), &fixture))
	app := simapp.Setup(t, false)
	t.Cleanup(func() { require.NoError(t, app.Close()) })
	RegisterInterfaces(app.InterfaceRegistry())
	// Use the real app router and keepers with both of the client's stores.
	// The stock IBC test app does not mount this optional light-client store.
	ms := store.NewCommitMultiStore(dbm.NewMemDB(), log.NewNopLogger(), metrics.NewNoOpMetrics())
	for _, key := range app.GetStoreKeys() {
		if key != nil {
			ms.MountStoreWithDB(key, storetypes.StoreTypeIAVL, nil)
		}
	}
	ms.MountStoreWithDB(SharedStoreKey, storetypes.StoreTypeIAVL, nil)
	require.NoError(t, ms.LoadLatestVersion())
	ctx := withTestHostProgress(app.NewContextLegacy(false, cmtproto.Header{ChainID: "omission-1", Height: 100, Time: time.Unix(0, int64(fixture.Consensus.Timestamp))}).WithMultiStore(ms))
	cdc := app.AppCodec()
	provider := clienttypes.NewStoreProvider(runtime.NewKVStoreService(app.GetKey(exported.StoreKey)))
	module := NewLightClientModule(cdc, provider)
	app.IBCKeeper.ClientKeeper.AddRoute(ModuleName, &module)
	clientStore := func(id string) storetypes.KVStore { return provider.ClientStore(ctx, id) }
	RegisterMsgServer(app.MsgServiceRouter(), storageServer{cdc, provider})
	params := clienttypes.DefaultParams()
	params.AllowedClients = append(params.AllowedClients, ModuleName)
	app.IBCKeeper.ClientKeeper.SetParams(ctx, params)
	subjectID, substituteID := ModuleName+"-0", ModuleName+"-1"
	payer := sdk.AccAddress(bytes.Repeat([]byte{9}, 20)).String()
	client := func(id string) *ClientState {
		value, found := getClientState(clientStore(id), cdc)
		require.True(t, found)
		return value
	}
	execute := func(msg sdk.Msg) error {
		cached, commit := ctx.CacheContext()
		cached = cached.WithGasMeter(storetypes.NewGasMeter(state.MaxOperationGas))
		handler := app.MsgServiceRouter().Handler(msg)
		require.NotNil(t, handler)
		_, err := handler(cached, msg)
		if err == nil {
			require.Less(t, cached.GasMeter().GasConsumed(), state.MaxOperationGas)
			commit()
		}
		return err
	}
	update := func(id string, message exported.ClientMessage) error {
		msg, err := clienttypes.NewMsgUpdateClient(id, message, payer)
		require.NoError(t, err)
		return execute(msg)
	}
	bootstrap := func(id string, full *ClientState, consensus *ConsensusState) {
		compact, initial, steps, err := BuildCompactBootstrap(dbadapter.Store{DB: dbm.NewMemDB()}, full, consensus)
		require.NoError(t, err)
		require.NoError(t, compact.Initialize(ctx, cdc, clientStore(id), initial))
		require.Empty(t, client(id).EpochContextChallenges, "imports cannot install a previous destination deadline")
		for _, step := range steps {
			require.NoError(t, update(id, step))
		}
		require.False(t, client(id).BootstrapPending)
		require.Equal(t, uint64(ctx.BlockTime().Add(state.SharedSnapshotChallengePeriod).UnixNano()), client(id).EpochContextChallenges[0].UsableAfterUnixNs)
	}
	bootstrap(subjectID, fixture.Client, fixture.Consensus)
	base := bytes.Clone(client(subjectID).CheckpointReference)
	headerAt := func(trusted, anchor uint64) *ProbabilisticHeader {
		h := &ProbabilisticHeader{TrustedHeight: NewHeight(0, trusted), IsCheckpoint: true}
		blocks := append([]*ProbabilisticBlock{fixture.Header.AnchorBlock}, fixture.Header.DescendantBlocks...)
		for _, block := range blocks {
			if block.Height.RevisionHeight <= trusted || block.Height.RevisionHeight > anchor+30 {
				continue
			}
			if block.Height.RevisionHeight < anchor {
				h.BridgeBlocks = append(h.BridgeBlocks, block)
			} else if block.Height.RevisionHeight == anchor {
				h.AnchorBlock = block
			} else {
				h.DescendantBlocks = append(h.DescendantBlocks, block)
			}
		}
		if trusted < 1001 {
			raw, err := json.Marshal(fixture.Header.NewEpochContext)
			require.NoError(t, err)
			require.NoError(t, json.Unmarshal(raw, &h.NewEpochContext))
		}
		return h
	}
	session := func(id []byte) (uint32, []byte) {
		cs := client(subjectID)
		raw, err := state.QueryVerification(coreContext(ctx), coreCodec{cdc}, &state.QueryVerificationRequest{Namespace: cs.StorageNamespace, Generation: cs.VerificationGeneration, Kind: 8, SessionId: id})
		require.NoError(t, err)
		var record struct {
			Sequence uint32
			Receipt  []byte
		}
		require.NoError(t, json.Unmarshal(raw, &record))
		return record.Sequence, record.Receipt
	}
	stage := func(h *ProbabilisticHeader, original []byte) []byte {
		planner := *client(subjectID)
		if len(original) > 0 {
			planner.CheckpointReference = base
			planner.CurrentEpoch = 7
		}
		steps, id, err := BuildObservationPlan(&planner, h, original, 13, 4)
		require.NoError(t, err)
		before := client(subjectID).LatestCheckpointTimestamp
		for _, step := range steps {
			require.NoError(t, update(subjectID, step))
			require.Equal(t, before, client(subjectID).LatestCheckpointTimestamp)
		}
		return id
	}
	activate := func(id []byte) error {
		sequence, _ := session(id)
		return update(subjectID, &ProbabilisticHeader{ObservationChunk: &ObservationChunk{Operation: state.ObservationActivate, SessionId: id, Sequence: sequence + 1}})
	}

	proposal := headerAt(1000, 1001)
	var rows []*StakeDistributionEntry
	var total uint64
	for _, row := range proposal.NewEpochContext.StakeDistribution {
		if row.PoolId != fixture.OmittedPool {
			rows = append(rows, row)
			total += row.Stake
		}
	}
	for _, row := range rows {
		row.RelativeStakeDenominator = total
	}
	proposal.NewEpochContext.StakeDistribution = rows
	require.Len(t, rows, 12)
	ctx = ctx.WithBlockTime(time.Unix(0, int64(proposal.DescendantBlocks[len(proposal.DescendantBlocks)-1].Timestamp)))
	poisoned := stage(proposal, nil)
	_, original := session(poisoned)
	require.NoError(t, activate(poisoned))
	deadline := client(subjectID).EpochContextChallenges[len(client(subjectID).EpochContextChallenges)-1].UsableAfterUnixNs
	// An honest forward upload cannot overwrite the installed allocation.
	honest := stage(headerAt(1000, 1001), nil)
	require.ErrorContains(t, activate(honest), "cannot replace an installed epoch allocation")
	ctx = ctx.WithBlockTime(time.Unix(0, int64(deadline)).Add(time.Second))
	require.NoError(t, activate(poisoned))
	require.Equal(t, uint64(1001), client(subjectID).LatestCheckpointHeight.RevisionHeight)
	checkpoint := client(subjectID).LatestCheckpointTimestamp

	// The genuine continuation includes producer 11. Execute each operation in
	// a transaction cache so the rejected batch cannot commit partial progress.
	steps, _, err := BuildObservationPlan(client(subjectID), headerAt(1001, 1032), nil, 12, 4)
	require.NoError(t, err)
	for _, step := range steps {
		err = update(subjectID, step)
		if err != nil {
			break
		}
	}
	require.ErrorContains(t, err, "issuer has no sealed stake row")
	require.Equal(t, checkpoint, client(subjectID).LatestCheckpointTimestamp)
	// The independently verified longer observation settles the exact same
	// ancestry, including the missing producer. It is not misbehaviour.
	alternative := stage(headerAt(1000, 1032), original)
	_, other := session(alternative)
	evidence := &Misbehaviour{ClientId: subjectID, VerifiedObservation_1: original, VerifiedObservation_2: other}
	require.False(t, client(subjectID).CheckForMisbehaviour(ctx, cdc, clientStore(subjectID), evidence))
	require.ErrorIs(t, update(subjectID, evidence), clienttypes.ErrInvalidMisbehaviour)
	require.ErrorContains(t, activate(alternative), "only a completed forward observation")
	require.Equal(t, checkpoint, client(subjectID).LatestCheckpointTimestamp)
	bootstrap(substituteID, fixture.RecoveryClient, fixture.RecoveryConsensus)
	maintenance := &MsgContinueClient{Signer: payer, ClientId: subjectID, Operation: state.ObservationContinueRecovery}
	require.ErrorContains(t, execute(maintenance), "no authorized recovery")
	recover := clienttypes.NewMsgRecoverClient(app.IBCKeeper.GetAuthority(), subjectID, substituteID)
	expires := time.Unix(0, int64(checkpoint)).Add(client(subjectID).TrustingPeriod)
	ctx = ctx.WithBlockTime(expires.Add(-time.Nanosecond))
	require.Equal(t, exported.Active, client(subjectID).Status(ctx, clientStore(subjectID), cdc))
	require.NoError(t, update(subjectID, steps[0]))
	require.Equal(t, checkpoint, client(subjectID).LatestCheckpointTimestamp)
	require.ErrorIs(t, execute(recover), clienttypes.ErrInvalidRecoveryClient)
	ctx = ctx.WithBlockTime(expires)
	require.Equal(t, exported.Expired, client(subjectID).Status(ctx, clientStore(subjectID), cdc))
	require.ErrorIs(t, update(subjectID, steps[0]), clienttypes.ErrClientNotActive)
	require.Equal(t, exported.Active, client(substituteID).Status(ctx, clientStore(substituteID), cdc))
	require.ErrorIs(t, execute(clienttypes.NewMsgRecoverClient(payer, subjectID, substituteID)), ibcerrors.ErrUnauthorized)

	// Recovery must keep the original route and outstanding packet accounting.
	app.IBCKeeper.ConnectionKeeper.SetConnection(ctx, "connection-0", connectiontypes.ConnectionEnd{ClientId: subjectID, State: connectiontypes.OPEN, Versions: connectiontypes.GetCompatibleVersions(), Counterparty: connectiontypes.Counterparty{ClientId: "07-tendermint-0", ConnectionId: "connection-1", Prefix: commitmenttypes.NewMerklePrefix([]byte("ibc"))}})
	channel := app.IBCKeeper.ChannelKeeper
	channel.SetChannel(ctx, "transfer", "channel-0", channeltypes.Channel{State: channeltypes.OPEN, Ordering: channeltypes.UNORDERED, Counterparty: channeltypes.Counterparty{PortId: "transfer", ChannelId: "channel-1"}, ConnectionHops: []string{"connection-0"}, Version: "ics20-1"})
	channel.SetNextSequenceSend(ctx, "transfer", "channel-0", 8)
	channel.SetNextSequenceRecv(ctx, "transfer", "channel-0", 4)
	channel.SetNextSequenceAck(ctx, "transfer", "channel-0", 7)
	channel.SetPacketCommitment(ctx, "transfer", "channel-0", 7, bytes.Repeat([]byte{3}, 32))
	channel.SetPacketReceipt(ctx, "transfer", "channel-0", 3)
	channel.SetPacketAcknowledgement(ctx, "transfer", "channel-0", 3, bytes.Repeat([]byte{4}, 32))
	before := recoveryStoreSnapshot(t, ctx.KVStore(app.GetKey(exported.StoreKey)))
	require.NoError(t, execute(recover))
	// There is one retained issuer counter in the poisoned committed anchor.
	// Recovery checks up to 32 counters per continuation, then changes generation.
	require.Equal(t, uint64(1), client(subjectID).VerificationGeneration)
	require.Equal(t, exported.Frozen, client(subjectID).Status(ctx, clientStore(subjectID), cdc))
	require.NoError(t, execute(maintenance))
	require.Equal(t, uint64(2), client(subjectID).VerificationGeneration)
	require.Equal(t, client(substituteID).CheckpointReference, client(subjectID).CheckpointReference)
	require.Error(t, update(subjectID, evidence), "discarded receipts cannot freeze the recovered client")
	_, err = client(subjectID).GetTimestampAtHeight(ctx, clientStore(subjectID), cdc, fixture.Client.LatestHeight)
	require.Error(t, err, "old-generation proof roots remain quarantined")
	deadline = client(subjectID).EpochContextChallenges[0].UsableAfterUnixNs
	ctx = ctx.WithBlockTime(time.Unix(0, int64(deadline)).Add(time.Second))
	require.Equal(t, exported.Active, client(subjectID).Status(ctx, clientStore(subjectID), cdc))
	resumed := stage(headerAt(1031, 1032), nil)
	require.NoError(t, activate(resumed))
	require.Equal(t, uint64(1032), client(subjectID).LatestCheckpointHeight.RevisionHeight)
	require.Equal(t, headerAt(1031, 1032).AnchorBlock.Hash, client(subjectID).LatestCheckpointBlockHash)
	after := recoveryStoreSnapshot(t, ctx.KVStore(app.GetKey(exported.StoreKey)))
	for key, value := range before {
		if !bytes.HasPrefix([]byte(key), []byte("clients/")) {
			require.Equal(t, value, after[key], "recovery changed %s", key)
		}
	}
}
