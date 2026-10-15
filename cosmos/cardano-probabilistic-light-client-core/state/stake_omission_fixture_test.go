package state

import (
	"bytes"
	"compress/gzip"
	"encoding/json"
	"os"
	"testing"
	"time"

	"cosmossdk.io/store/dbadapter"
	core "github.com/cardano-foundation/cardano-ibc-incubator/cosmos/cardano-probabilistic-light-client-core"
	dbm "github.com/cosmos/cosmos-db"
	"github.com/stretchr/testify/require"
)

const stakeOmissionTrustedHeight uint64 = 1000

// Both SDK adapters replay this fully signed history. Producer 11 first appears
// at 1032, after the 30 descendants that admit the epoch-8 allocation at 1001.
func TestStakeOmissionFixture(t *testing.T) {
	fixture := makeNativeBoundaryFixtureAtHeight(t, false, 0, stakeOmissionTrustedHeight)
	originalBytes, err := json.Marshal(fixture.Client)
	require.NoError(t, err)
	var original ClientState
	require.NoError(t, json.Unmarshal(originalBytes, &original))
	header := boundaryHeaderAtAnchor(t, fixture.Header, 1000, 1031)
	header.IsCheckpoint = true
	private := dbadapter.Store{DB: dbm.NewMemDB()}
	cdc := jsonTestCodec{}
	ctx := Context{Time: time.Unix(0, int64(fixture.Header.DescendantBlocks[len(fixture.Header.DescendantBlocks)-1].Timestamp)), Height: 100, SelfHeight: NewHostHeight(0, 100), VerifyHostUsability: stagedTestHostWindow}
	require.NoError(t, fixture.Client.Initialize(ctx, cdc, private, fixture.Consensus))
	fixture.Client, _ = GetClientState(private, cdc)
	ctx.Time = ctx.Time.Add(SharedSnapshotChallengePeriod + time.Second)
	require.NoError(t, fixture.Client.VerifyClientMessage(ctx, cdc, private, header))
	fixture.Client.UpdateState(ctx, cdc, private, header)
	recovery, found := GetClientState(private, cdc)
	require.True(t, found)
	require.Equal(t, uint64(1031), recovery.LatestCheckpointHeight.RevisionHeight)

	// Recovery starts from a separately trusted snapshot on this same ancestry.
	// Keep the actual root and packet state derived from authenticated bodies.
	// A rootless update itself does not publish a new proof-bearing height.
	snapshotBytes := private.Get(packetSnapshotKey(1031))
	snapshot, err := core.DecodePacketStateSnapshot(snapshotBytes)
	require.NoError(t, err)
	recovery.LatestHeight = recovery.LatestCheckpointHeight
	consensus := &ConsensusState{
		Timestamp: recovery.LatestCheckpointTimestamp, AcceptedBlockHash: recovery.LatestCheckpointBlockHash,
		AcceptedEpoch: recovery.CurrentEpoch, IbcStateRoot: bytes.Clone(snapshot.HostRoot), PacketStateSnapshot: bytes.Clone(snapshotBytes),
		NonceState: clonePraosNonceState(recovery.LatestCheckpointNonceState), PoolRegistry: clonePoolRegistry(recovery.LatestCheckpointPoolRegistry),
		SettlementCredit: cloneSettlementCredit(recovery.LatestCheckpointSettlementCredit), PoolProduction: clonePoolProduction(recovery.LatestCheckpointPoolProduction),
	}
	require.NotEmpty(t, recovery.EpochContextChallenges, "the trusted export must carry the old destination deadlines")
	require.NoError(t, recovery.Validate())
	require.NoError(t, consensus.ValidateBasic())
	data := struct {
		Client            *ClientState
		Consensus         *ConsensusState
		Header            *ProbabilisticHeader
		RecoveryClient    *ClientState
		RecoveryConsensus *ConsensusState
		OmittedPool       string
	}{&original, fixture.Consensus, fixture.Header, recovery, consensus, original.EpochStakeDistribution[11].PoolId}
	encoded, err := json.Marshal(data)
	require.NoError(t, err)
	const path = "../testdata/stake-table-omission.json.gz"
	if os.Getenv("UPDATE_STAKE_OMISSION_FIXTURE") == "1" {
		file, err := os.Create(path)
		require.NoError(t, err)
		writer := gzip.NewWriter(file)
		_, err = writer.Write(encoded)
		require.NoError(t, err)
		require.NoError(t, writer.Close())
		require.NoError(t, file.Close())
	}
	file, err := os.Open(path)
	require.NoError(t, err)
	defer file.Close()
	reader, err := gzip.NewReader(file)
	require.NoError(t, err)
	defer reader.Close()
	var saved json.RawMessage
	require.NoError(t, json.NewDecoder(reader).Decode(&saved))
	require.JSONEq(t, string(encoded), string(saved))
}
