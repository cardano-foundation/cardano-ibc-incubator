package probabilistic

import (
	"bytes"
	"testing"
	"time"

	storetypes "cosmossdk.io/store/types"
	cmtproto "github.com/cometbft/cometbft/proto/tendermint/types"
	sdk "github.com/cosmos/cosmos-sdk/types"

	clienttypes "github.com/cosmos/ibc-go/v8/modules/core/02-client/types"
	connectiontypes "github.com/cosmos/ibc-go/v8/modules/core/03-connection/types"
	channeltypes "github.com/cosmos/ibc-go/v8/modules/core/04-channel/types"
	commitmenttypes "github.com/cosmos/ibc-go/v8/modules/core/23-commitment/types"
	host "github.com/cosmos/ibc-go/v8/modules/core/24-host"
	ibcerrors "github.com/cosmos/ibc-go/v8/modules/core/errors"
	"github.com/cosmos/ibc-go/v8/modules/core/exported"
	ibctm "github.com/cosmos/ibc-go/v8/modules/light-clients/07-tendermint"
	"github.com/cosmos/ibc-go/v8/testing/simapp"
	"github.com/stretchr/testify/require"
)

// Exercise the app's registered MsgRecoverClient handler, including the authority
// and keeper status gates that direct CheckSubstituteAndUpdateState tests skip.
func TestAppRecoverClient(t *testing.T) {
	for _, tc := range []struct {
		name    string
		wantErr error
	}{
		{"success", nil},
		{"active subject", clienttypes.ErrInvalidRecoveryClient},
		{"expired substitute", clienttypes.ErrClientNotActive},
		{"frozen substitute", clienttypes.ErrClientNotActive},
		{"different concrete type", clienttypes.ErrInvalidClient},
		{"unauthorized signer", ibcerrors.ErrUnauthorized},
	} {
		t.Run(tc.name, func(t *testing.T) {
			app := simapp.Setup(t, false)
			t.Cleanup(func() { require.NoError(t, app.Close()) })
			RegisterInterfaces(app.InterfaceRegistry())
			ctx := app.NewContextLegacy(false, cmtproto.Header{
				ChainID: "recovery-test-1", Height: 100,
				Time: time.Unix(1_700_000_100, 0),
			})
			cdc := app.AppCodec()
			ibcStore := ctx.KVStore(app.GetKey(exported.StoreKey))
			clientStore := func(id string) storetypes.KVStore { return app.IBCKeeper.ClientKeeper.ClientStore(ctx, id) }
			params := app.IBCKeeper.ClientKeeper.GetParams(ctx)
			params.AllowedClients = append(params.AllowedClients, ModuleName, ibctm.ModuleName)
			app.IBCKeeper.ClientKeeper.SetParams(ctx, params)

			subjectID := ModuleName + "-0"
			substituteID := ModuleName + "-1"
			subject := newProbabilisticTestClientState()
			subject.TrustingPeriod = time.Second
			substitute := newProbabilisticTestClientState()
			substitute.LatestHeight = NewHeight(0, 20)
			if tc.name == "active subject" {
				subject.TrustingPeriod = 24 * time.Hour
			}
			if tc.name == "expired substitute" {
				substitute.TrustingPeriod = time.Second
			}
			if tc.name == "frozen substitute" {
				substitute.FrozenHeight = NewHeight(0, 20)
			}
			for _, entry := range []struct {
				id    string
				state *ClientState
			}{
				{subjectID, subject}, {substituteID, substitute},
			} {
				state := entry.state
				slot := state.LatestHeight.RevisionHeight
				setTestCheckpoint(t, state, state.LatestHeight, testBlockHash("checkpoint-"+entry.id), 7, slot)
				state.OperationalCertificateCounterHistoryStartHeight = state.LatestHeight
				store := clientStore(entry.id)
				setClientState(store, cdc, state)
				consensus := newProbabilisticTestConsensusState(state.LatestCheckpointBlockHash, slot)
				consensus.Timestamp = state.LatestCheckpointTimestamp
				setConsensusState(store, cdc, consensus, state.LatestHeight)
				setConsensusMetadataWithValues(store, state.LatestHeight, clienttypes.NewHeight(1, 99), uint64(ctx.BlockTime().UnixNano()))
				require.NoError(t, state.Validate())
			}
			expectedSubjectStatus := exported.Expired
			if tc.name == "active subject" {
				expectedSubjectStatus = exported.Active
			}
			require.Equal(t, expectedSubjectStatus, subject.Status(ctx, clientStore(subjectID), cdc))
			expectedSubstituteStatus := exported.Active
			if tc.name == "expired substitute" {
				expectedSubstituteStatus = exported.Expired
			}
			if tc.name == "frozen substitute" {
				expectedSubstituteStatus = exported.Frozen
			}
			require.Equal(t, expectedSubstituteStatus, substitute.Status(ctx, clientStore(substituteID), cdc))

			if tc.name == "different concrete type" {
				substituteID = "07-tendermint-0"
				tmState := ibctm.NewClientState("other-1", ibctm.DefaultTrustLevel, time.Hour, 2*time.Hour, time.Minute,
					clienttypes.NewHeight(1, 20), commitmenttypes.GetSDKSpecs(), nil)
				tmConsensus := &ibctm.ConsensusState{Timestamp: ctx.BlockTime(), Root: commitmenttypes.NewMerkleRoot(bytes.Repeat([]byte{1}, 32)), NextValidatorsHash: bytes.Repeat([]byte{2}, 32)}
				require.NoError(t, tmState.Validate())
				require.NoError(t, tmConsensus.ValidateBasic())
				store := clientStore(substituteID)
				store.Set(host.ClientStateKey(), clienttypes.MustMarshalClientState(cdc, tmState))
				store.Set(host.ConsensusStateKey(tmState.LatestHeight), clienttypes.MustMarshalConsensusState(cdc, tmConsensus))
				require.Equal(t, exported.Active, tmState.Status(ctx, store, cdc))
			}

			// A live route and pending packet must survive even a rejected recovery.
			app.IBCKeeper.ConnectionKeeper.SetConnection(ctx, "connection-0", connectiontypes.ConnectionEnd{
				ClientId: subjectID, State: connectiontypes.OPEN, Versions: connectiontypes.GetCompatibleVersions(),
				Counterparty: connectiontypes.Counterparty{ClientId: "07-tendermint-0", ConnectionId: "connection-1", Prefix: commitmenttypes.NewMerklePrefix([]byte("ibc"))},
			})
			channel := app.IBCKeeper.ChannelKeeper
			channel.SetChannel(ctx, "transfer", "channel-0", channeltypes.Channel{
				State: channeltypes.OPEN, Ordering: channeltypes.UNORDERED,
				Counterparty:   channeltypes.Counterparty{PortId: "transfer", ChannelId: "channel-1"},
				ConnectionHops: []string{"connection-0"}, Version: "ics20-1",
			})
			channel.SetNextSequenceSend(ctx, "transfer", "channel-0", 8)
			channel.SetNextSequenceRecv(ctx, "transfer", "channel-0", 4)
			channel.SetNextSequenceAck(ctx, "transfer", "channel-0", 7)
			channel.SetPacketCommitment(ctx, "transfer", "channel-0", 7, bytes.Repeat([]byte{3}, 32))
			channel.SetPacketReceipt(ctx, "transfer", "channel-0", 3)
			channel.SetPacketAcknowledgement(ctx, "transfer", "channel-0", 3, bytes.Repeat([]byte{4}, 32))

			signer := app.IBCKeeper.GetAuthority()
			if tc.name == "unauthorized signer" {
				signer = sdk.AccAddress(bytes.Repeat([]byte{9}, 20)).String()
			}
			msg := clienttypes.NewMsgRecoverClient(signer, subjectID, substituteID)
			handler := app.MsgServiceRouter().Handler(msg)
			require.NotNil(t, handler)
			before := recoveryStoreSnapshot(t, ibcStore)
			substituteBefore := recoveryStoreSnapshot(t, clientStore(substituteID))
			var err error
			require.NotPanics(t, func() { _, err = handler(ctx, msg) })
			if tc.wantErr != nil {
				require.ErrorIs(t, err, tc.wantErr)
				// This includes every client consensus/custom key, connection,
				// channel, sequence, commitment, receipt and acknowledgement.
				require.Equal(t, before, recoveryStoreSnapshot(t, ibcStore))
				return
			}
			require.NoError(t, err)
			recovered, found := getClientState(clientStore(subjectID), cdc)
			require.True(t, found)
			require.Equal(t, exported.Active, recovered.Status(ctx, clientStore(subjectID), cdc))
			require.Equal(t, substitute.LatestHeight, recovered.LatestHeight)
			require.Equal(t, substituteBefore, recoveryStoreSnapshot(t, clientStore(substituteID)))
			after := recoveryStoreSnapshot(t, ibcStore)
			for key, value := range before {
				if !bytes.HasPrefix([]byte(key), []byte("clients/"+subjectID+"/")) {
					require.Equal(t, value, after[key], "recovery changed %s", key)
					delete(after, key)
				}
			}
			for key := range after {
				require.True(t, bytes.HasPrefix([]byte(key), []byte("clients/"+subjectID+"/")), "recovery added %s", key)
			}
		})
	}
}

func recoveryStoreSnapshot(t *testing.T, store storetypes.KVStore) map[string][]byte {
	t.Helper()
	snapshot := map[string][]byte{}
	iterator := store.Iterator(nil, nil)
	defer func() { require.NoError(t, iterator.Close()) }()
	for ; iterator.Valid(); iterator.Next() {
		snapshot[string(iterator.Key())] = bytes.Clone(iterator.Value())
	}
	return snapshot
}
