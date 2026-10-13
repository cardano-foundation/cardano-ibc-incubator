package probabilistic

import (
	"bytes"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"os"
	"testing"
	"time"

	storetypes "cosmossdk.io/store/types"
	cmtproto "github.com/cometbft/cometbft/proto/tendermint/types"
	sdk "github.com/cosmos/cosmos-sdk/types"

	clienttypes "github.com/cosmos/ibc-go/v8/modules/core/02-client/types"
	connectiontypes "github.com/cosmos/ibc-go/v8/modules/core/03-connection/types"
	channeltypes "github.com/cosmos/ibc-go/v8/modules/core/04-channel/types"
	commitmenttypes "github.com/cosmos/ibc-go/v8/modules/core/23-commitment/types"
	pathTypes "github.com/cosmos/ibc-go/v8/modules/core/23-commitment/types"
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
		{"frozen pending subject", nil},
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
			vector := loadStateProofVectors(t)[5]
			proof := vectorProofProto(t, vector)
			value := expectedProofValue(t, vector)
			path := pathTypes.NewMerklePath("ibc", vector.Key)
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
				consensus.IbcStateRoot = nextSequenceRecvHex(t, vector.Root)
				setTestPacketSnapshot(t, consensus, state.LatestHeight.RevisionHeight)
				setConsensusState(store, cdc, consensus, state.LatestHeight)
				setConsensusMetadataWithValues(store, state.LatestHeight, clienttypes.NewHeight(1, 99), uint64(ctx.BlockTime().UnixNano()))
				require.NoError(t, state.Validate())
			}
			expectedSubjectStatus := exported.Expired
			if tc.name == "active subject" {
				expectedSubjectStatus = exported.Active
			}
			if tc.name == "frozen pending subject" {
				subject.TrustingPeriod = 24 * time.Hour
				subject.EpochContextChallenges = []*EpochContextChallenge{{Epoch: 7, UsableAfterUnixNs: uint64(ctx.BlockTime().Add(3 * time.Minute).UnixNano())}}
				setClientState(clientStore(subjectID), cdc, subject)
				require.ErrorIs(t, subject.VerifyMembership(ctx, clientStore(subjectID), cdc, subject.LatestHeight, 0, 0, proof, path, value), ErrEpochContextPending)
				subject.UpdateStateOnMisbehaviour(ctx, cdc, clientStore(subjectID), nil)
				subject, _ = getClientState(clientStore(subjectID), cdc)
				expectedSubjectStatus = exported.Frozen
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
			// An elapsed replacement window releases only the replacement root.
			_, oldRootFound := GetConsensusState(clientStore(subjectID), cdc, subject.LatestHeight)
			require.False(t, oldRootFound)
			_, oldTimeFound := GetProcessedTime(clientStore(subjectID), subject.LatestHeight)
			require.False(t, oldTimeFound)
			_, oldHeightFound := GetProcessedHeight(clientStore(subjectID), subject.LatestHeight)
			require.False(t, oldHeightFound)
			require.Nil(t, clientStore(subjectID).Get(IterationKey(subject.LatestHeight)))
			proofCtx := ctx.WithBlockTime(ctx.BlockTime().Add(3 * time.Minute))
			require.Error(t, recovered.VerifyMembership(proofCtx, clientStore(subjectID), cdc, subject.LatestHeight, 0, 0, proof, path, value))
			require.NoError(t, recovered.VerifyMembership(proofCtx, clientStore(subjectID), cdc, substitute.LatestHeight, 0, 0, proof, path, value))
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

// Export actual SDK keeper events and transaction bytes for the Hermes watcher
// regression. Consume its serialized challenge through the real SDK handler.
func TestAppWatcherChallenge(t *testing.T) {
	for _, rootless := range []bool{false, true} {
		name := "root-bearing"
		if rootless {
			name = "rootless"
		}
		t.Run(name, func(t *testing.T) {
			data, err := os.ReadFile("../cardano-probabilistic-light-client-core/testdata/native-challenge.json")
			require.NoError(t, err)
			var fixture struct {
				Client       *ClientState
				Consensus    *ConsensusState
				Header, Fork *ProbabilisticHeader
			}
			require.NoError(t, json.Unmarshal(data, &fixture))
			clientID := ModuleName + "-0"
			fixture.Client.TrustingPeriod = 48 * time.Hour

			app := simapp.Setup(t, false)
			t.Cleanup(func() { require.NoError(t, app.Close()) })
			RegisterInterfaces(app.InterfaceRegistry())
			ctx := app.NewContextLegacy(false, cmtproto.Header{ChainID: "watcher-test-1", Height: 100, Time: time.Unix(0, int64(fixture.Fork.DescendantBlocks[29].Timestamp))})
			cdc := app.AppCodec()
			store := app.IBCKeeper.ClientKeeper.ClientStore(ctx, clientID)

			params := app.IBCKeeper.ClientKeeper.GetParams(ctx)
			params.AllowedClients = append(params.AllowedClients, ModuleName)
			app.IBCKeeper.ClientKeeper.SetParams(ctx, params)
			require.NoError(t, fixture.Client.Initialize(ctx, cdc, store, fixture.Consensus))
			ctx = ctx.WithBlockTime(ctx.BlockTime().Add(3 * time.Minute))
			fixture.Header.IsCheckpoint = rootless
			signer := sdk.AccAddress(bytes.Repeat([]byte{9}, 20)).String()
			msg, err := clienttypes.NewMsgUpdateClient(clientID, fixture.Header, signer)
			require.NoError(t, err)
			result, err := app.MsgServiceRouter().Handler(msg)(ctx, msg)
			require.NoError(t, err)
			builder := app.TxConfig().NewTxBuilder()
			require.NoError(t, builder.SetMsgs(msg))
			tx, err := app.TxConfig().TxEncoder()(builder.GetTx())
			require.NoError(t, err)
			captured := struct {
				Tx      string           `json:"tx"`
				Events  []map[string]any `json:"events"`
				Context string           `json:"context"`
				Client  string           `json:"client"`
				Witness string           `json:"witness"`
			}{Tx: hex.EncodeToString(tx)}
			key := append([]byte("epochChallengeCheckpoint/"), make([]byte, 8)...)
			binary.BigEndian.PutUint64(key[len(key)-8:], 8)
			captured.Context = hex.EncodeToString(store.Get(key))
			latest, found := getClientState(store, cdc)
			require.True(t, found)
			clientBytes, err := latest.Marshal()
			require.NoError(t, err)
			captured.Client = hex.EncodeToString(clientBytes)
			witnessBytes, err := fixture.Fork.Marshal()
			require.NoError(t, err)
			captured.Witness = hex.EncodeToString(witnessBytes)
			for _, event := range result.Events {
				attrs := []map[string]any{}
				for _, attr := range event.Attributes {
					attrs = append(attrs, map[string]any{"key": attr.Key, "value": attr.Value, "index": attr.Index})
				}
				captured.Events = append(captured.Events, map[string]any{"type": event.Type, "attributes": attrs})
			}
			encoded, err := json.MarshalIndent(captured, "", "  ")
			require.NoError(t, err)
			file := "../cardano-probabilistic-light-client-core/testdata/watcher-v8-" + name + ".json"
			if os.Getenv("UPDATE_WATCHER_FIXTURES") == "1" {
				require.NoError(t, os.WriteFile(file, append(encoded, '\n'), 0644))
			}
			saved, err := os.ReadFile(file)
			require.NoError(t, err)
			require.JSONEq(t, string(saved), string(encoded))
			// These bytes are constructed by ForeignClient from the recovered event
			// and independent fork witness. The destination verifies them natively.
			if os.Getenv("UPDATE_WATCHER_FIXTURES") == "1" {
				return
			}
			challengeBytes, err := os.ReadFile("../cardano-probabilistic-light-client-core/testdata/watcher-challenge-" + name + ".hex")
			if os.Getenv("UPDATE_WATCHER_FIXTURES") == "1" && os.IsNotExist(err) {
				return
			}
			require.NoError(t, err)
			wire, err := hex.DecodeString(string(bytes.TrimSpace(challengeBytes)))
			require.NoError(t, err)
			challenge := &clienttypes.MsgUpdateClient{}
			require.NoError(t, cdc.Unmarshal(wire, challenge))
			_, err = app.MsgServiceRouter().Handler(challenge)(ctx, challenge)
			require.NoError(t, err)
			frozen, found := getClientState(store, cdc)
			require.True(t, found)
			require.Equal(t, exported.Frozen, frozen.Status(ctx, store, cdc))
		})
	}
}

// Run both unsigned-table attacks through the actual keeper. The unchanged
// signed blocks pass native verification in the historical evidence path.
func TestAppUnsignedStakeDisagreementDoesNotFreeze(t *testing.T) {
	for _, mutation := range []string{"scaled amounts", "unobserved allocation"} {
		t.Run(mutation, func(t *testing.T) {
			data, err := os.ReadFile("../cardano-probabilistic-light-client-core/testdata/native-settlement.json")
			require.NoError(t, err)
			var fixture struct {
				Client       *ClientState
				Consensus    *ConsensusState
				Header, Fork *ProbabilisticHeader
			}
			require.NoError(t, json.Unmarshal(data, &fixture))
			clientID := ModuleName + "-0"

			app := simapp.Setup(t, false)
			t.Cleanup(func() { require.NoError(t, app.Close()) })
			RegisterInterfaces(app.InterfaceRegistry())
			ctx := app.NewContextLegacy(false, cmtproto.Header{ChainID: "challenge-test-1", Height: 100, Time: time.Unix(0, int64(fixture.Fork.DescendantBlocks[29].Timestamp))})
			cdc := app.AppCodec()
			store := app.IBCKeeper.ClientKeeper.ClientStore(ctx, clientID)

			params := app.IBCKeeper.ClientKeeper.GetParams(ctx)
			params.AllowedClients = append(params.AllowedClients, ModuleName)
			app.IBCKeeper.ClientKeeper.SetParams(ctx, params)
			require.NoError(t, fixture.Client.Initialize(ctx, cdc, store, fixture.Consensus))
			original := fixture.Header
			changed := fromCoreProbabilisticHeader(toCoreProbabilisticHeader(original))
			changed.NewEpochContext = fromCoreEpochContext(toCoreEpochContext(fixture.Client.EpochContexts[0]))
			if mutation == "scaled amounts" {
				for _, entry := range changed.NewEpochContext.StakeDistribution {
					entry.Stake *= 2
					entry.RelativeStakeNumerator *= 2
					entry.RelativeStakeDenominator *= 2
				}
			} else {
				changed.NewEpochContext.StakeDistribution[11].Stake += 100
				changed.NewEpochContext.StakeDistribution[11].RelativeStakeNumerator += 100
				changed.NewEpochContext.StakeDistribution[12].Stake -= 100
				changed.NewEpochContext.StakeDistribution[12].RelativeStakeNumerator -= 100
			}
			signer := sdk.AccAddress(bytes.Repeat([]byte{9}, 20)).String()
			update, err := clienttypes.NewMsgUpdateClient(clientID, changed, signer)
			require.NoError(t, err)
			_, err = app.MsgServiceRouter().Handler(update)(ctx, update)
			require.ErrorContains(t, err, "cannot replace an installed epoch context")
			evidence := NewMisbehaviour(clientID, original, changed)
			challenge, err := clienttypes.NewMsgSubmitMisbehaviour(clientID, evidence, signer)
			require.NoError(t, err)
			_, err = app.MsgServiceRouter().Handler(challenge)(ctx, challenge)
			require.ErrorContains(t, err, "cannot replace an installed epoch context")
			healthy, found := getClientState(store, cdc)
			require.True(t, found)
			require.Equal(t, exported.Active, healthy.Status(ctx, store, cdc))
			require.Equal(t, uint64(200), healthy.EpochContexts[0].StakeDistribution[0].Stake)
			// An altered old table is not allowed to authenticate a signed fork either.
			forkClaim := fromCoreProbabilisticHeader(toCoreProbabilisticHeader(fixture.Fork))
			forkClaim.NewEpochContext = changed.NewEpochContext
			challenge, err = clienttypes.NewMsgSubmitMisbehaviour(clientID, NewMisbehaviour(clientID, original, forkClaim), signer)
			require.NoError(t, err)
			_, err = app.MsgServiceRouter().Handler(challenge)(ctx, challenge)
			require.ErrorContains(t, err, "cannot replace an installed epoch context")
			// Genuine incompatible signed histories still freeze through the same handler.
			challenge, err = clienttypes.NewMsgSubmitMisbehaviour(clientID, NewMisbehaviour(clientID, original, fixture.Fork), signer)
			require.NoError(t, err)
			_, err = app.MsgServiceRouter().Handler(challenge)(ctx, challenge)
			require.NoError(t, err)
			frozen, found := getClientState(store, cdc)
			require.True(t, found)
			require.Equal(t, exported.Frozen, frozen.Status(ctx, store, cdc))
		})
	}
}
