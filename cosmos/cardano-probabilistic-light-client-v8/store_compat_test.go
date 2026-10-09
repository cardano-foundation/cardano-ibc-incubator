package probabilistic

import (
	"bytes"
	storetypes "cosmossdk.io/store/types"
	"encoding/hex"
	"encoding/json"
	"github.com/stretchr/testify/require"
	"os"
	"testing"
	"time"
)

func TestStateMachineStoreCompatibility(t *testing.T) {
	ctx, subjectStore := newProbabilisticTestClientStore(t, "subject")
	ctx = ctx.WithChainID("host-7").WithBlockHeight(100)
	_, substituteStore := newProbabilisticTestClientStore(t, "substitute")
	cdc := newProbabilisticTestCodec()
	subject := newProbabilisticTestClientState()
	subject.UpgradePath = []string{"upgrade", "upgradedIBCState"}
	subject.LatestCheckpointOperationalCertificateCounters = []*OperationalCertificateCounter{{PoolId: bytes.Repeat([]byte{1}, 28), SequenceNumber: 3}}
	initial := newProbabilisticTestConsensusState(testBlockHash("initial-block"))
	require.NoError(t, subject.Initialize(ctx, cdc, subjectStore, initial))
	snapshots := map[string]map[string]string{"initialized": snapshotStore(t, subjectStore)}
	subject, found := getClientState(subjectStore, cdc)
	require.True(t, found)
	require.Equal(t, "Active", string(subject.Status(ctx, subjectStore, cdc)))
	subject.UpdateStateOnMisbehaviour(ctx, cdc, subjectStore, nil)
	snapshots["frozen"] = snapshotStore(t, subjectStore)
	subject, found = getClientState(subjectStore, cdc)
	require.True(t, found)
	require.Equal(t, "Frozen", string(subject.Status(ctx, subjectStore, cdc)))
	substitute := newProbabilisticTestClientState()
	substitute.UpgradePath = subject.UpgradePath
	substitute.LatestHeight = NewHeight(0, 20)
	substitute.OperationalCertificateCounterHistoryStartHeight = NewHeight(0, 20)
	substitute.LatestCheckpointOperationalCertificateCounters = []*OperationalCertificateCounter{{PoolId: bytes.Repeat([]byte{1}, 28), SequenceNumber: 4}}
	consensus := newProbabilisticTestConsensusState(testBlockHash("substitute-block"), 20)
	consensus.Timestamp += uint64(20 * time.Second)
	require.NoError(t, substitute.Initialize(ctx.WithBlockHeight(110).WithBlockTime(ctx.BlockTime().Add(30*time.Second)), cdc, substituteStore, consensus))
	substitute, found = getClientState(substituteStore, cdc)
	require.True(t, found)
	require.NoError(t, subject.CheckSubstituteAndUpdateState(ctx, cdc, subjectStore, substituteStore, substitute))
	snapshots["recovered"] = snapshotStore(t, subjectStore)
	recovered, found := getClientState(subjectStore, cdc)
	require.True(t, found)
	require.Equal(t, "Active", string(recovered.Status(ctx, subjectStore, cdc)))
	require.Equal(t, "Expired", string(recovered.Status(ctx.WithBlockTime(ctx.BlockTime().Add(48*time.Hour)), subjectStore, cdc)))
	// Both adapters must encode identical retained state, including nonce snapshots.
	if os.Getenv("UPDATE_LIGHT_CLIENT_STORE_FIXTURE") == "1" {
		encoded, err := json.MarshalIndent(snapshots, "", "  ")
		require.NoError(t, err)
		require.NoError(t, os.WriteFile("../cardano-probabilistic-light-client-core/testdata/state_machine_store.json", append(encoded, '\n'), 0644))
	}
	data, err := os.ReadFile("../cardano-probabilistic-light-client-core/testdata/state_machine_store.json")
	require.NoError(t, err)
	var expected map[string]map[string]string
	require.NoError(t, json.Unmarshal(data, &expected))
	require.Equal(t, expected, snapshots)

}
func snapshotStore(t *testing.T, store storetypes.KVStore) map[string]string {
	t.Helper()
	result := map[string]string{}
	iterator := store.Iterator(nil, nil)
	defer iterator.Close()
	for ; iterator.Valid(); iterator.Next() {
		result[hex.EncodeToString(iterator.Key())] = hex.EncodeToString(iterator.Value())
	}
	return result
}
