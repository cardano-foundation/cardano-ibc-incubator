package probabilistic

import (
	"bytes"
	"compress/gzip"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"os"
	"testing"
	"time"

	"cosmossdk.io/log"
	store "cosmossdk.io/store"
	"cosmossdk.io/store/dbadapter"
	"cosmossdk.io/store/metrics"
	storetypes "cosmossdk.io/store/types"
	"github.com/blinklabs-io/gouroboros/ledger/common"
	state "github.com/cardano-foundation/cardano-ibc-incubator/cosmos/cardano-probabilistic-light-client-core/state"
	cmtproto "github.com/cometbft/cometbft/proto/tendermint/types"
	dbm "github.com/cosmos/cosmos-db"
	sdk "github.com/cosmos/cosmos-sdk/types"
	"github.com/stretchr/testify/require"
)

func TestSDKSnapshotBootstrapAndFreeze4000Pools(t *testing.T) {
	file, err := os.Open("../cardano-probabilistic-light-client-core/testdata/native-recovery.json.gz")
	require.NoError(t, err)
	defer file.Close()
	reader, err := gzip.NewReader(file)
	require.NoError(t, err)
	defer reader.Close()
	var fixture struct {
		Client    *ClientState
		Consensus *ConsensusState
	}
	require.NoError(t, json.NewDecoder(reader).Decode(&fixture))
	client := fixture.Client
	for i := len(client.EpochStakeDistribution); i < 4000; i++ {
		hash := sha256.Sum256([]byte(fmt.Sprintf("sdk-compact-pool-%d", i)))
		binding := &PoolRegistrationBinding{PoolId: common.PoolId(hash[:28]).String(), VrfKeyHash: bytes.Clone(hash[:]), FirstRegistrationSlot: 1}
		client.LatestCheckpointPoolRegistry.Pools = append(client.LatestCheckpointPoolRegistry.Pools, &PoolRegistrationRecord{Registration: binding, Registered: true})
		client.LatestCheckpointPoolRegistry.Mark = append(client.LatestCheckpointPoolRegistry.Mark, binding)
		client.LatestCheckpointPoolRegistry.Effective = append(client.LatestCheckpointPoolRegistry.Effective, binding)
		client.EpochStakeDistribution = append(client.EpochStakeDistribution, &StakeDistributionEntry{PoolId: binding.PoolId, VrfKeyHash: binding.VrfKeyHash, FirstRegistrationSlot: 1, Stake: 1})
	}
	var total uint64
	for _, row := range client.EpochStakeDistribution {
		total += row.Stake
	}
	for _, row := range client.EpochStakeDistribution {
		row.RelativeStakeNumerator = row.Stake
		row.RelativeStakeDenominator = total
	}
	client.EpochContexts[0].StakeDistribution = client.EpochStakeDistribution
	registryBytes, err := client.LatestCheckpointPoolRegistry.Marshal()
	require.NoError(t, err)
	fixture.Consensus.PoolRegistry = &PoolRegistryState{}
	require.NoError(t, fixture.Consensus.PoolRegistry.Unmarshal(registryBytes))
	compact, initial, steps, err := BuildBootstrap(dbadapter.Store{DB: dbm.NewMemDB()}, client, fixture.Consensus)
	require.NoError(t, err)
	database := dbm.NewMemDB()
	multistore := store.NewCommitMultiStore(database, log.NewNopLogger(), metrics.NewNoOpMetrics())
	privateKey := storetypes.NewKVStoreKey("test-client")
	multistore.MountStoreWithDB(privateKey, storetypes.StoreTypeIAVL, database)
	multistore.MountStoreWithDB(SharedStoreKey, storetypes.StoreTypeIAVL, database)
	require.NoError(t, multistore.LoadLatestVersion())
	ctx := sdk.NewContext(multistore, cmtproto.Header{ChainID: "test-host", Height: 1, Time: time.Unix(0, int64(initial.Timestamp))}, false, log.NewNopLogger())
	cdc := newProbabilisticTestCodec()
	require.NoError(t, compact.Initialize(ctx, cdc, ctx.KVStore(privateKey), initial))
	compact, found := getClientState(ctx.KVStore(privateKey), cdc)
	require.True(t, found)
	for _, step := range steps {
		ctx = ctx.WithGasMeter(storetypes.NewGasMeter(state.MaxOperationGas))
		require.NoError(t, compact.VerifyClientMessage(ctx, cdc, ctx.KVStore(privateKey), step))
		require.False(t, compact.CheckForMisbehaviour(ctx, cdc, ctx.KVStore(privateKey), step))
		compact.UpdateState(ctx, cdc, ctx.KVStore(privateKey), step)
		before := bytes.Clone(ctx.KVStore(privateKey).Get([]byte("clientState")))
		require.Empty(t, compact.UpdateState(ctx.WithIsReCheckTx(true), cdc, ctx.KVStore(privateKey), step))
		require.Equal(t, before, ctx.KVStore(privateKey).Get([]byte("clientState")))
	}
	require.False(t, compact.BootstrapPending)
	require.LessOrEqual(t, compact.Size(), state.MaxClientBytes)
	consensus, found := GetConsensusState(ctx.KVStore(privateKey), cdc, compact.LatestHeight)
	require.True(t, found)
	require.LessOrEqual(t, consensus.Size(), state.MaxConsensusBytes)
	ctx = ctx.WithGasMeter(storetypes.NewGasMeter(1000000))
	compact.UpdateStateOnMisbehaviour(ctx, cdc, ctx.KVStore(privateKey), nil)
	frozen, found := getClientState(ctx.KVStore(privateKey), cdc)
	require.True(t, found)
	require.Equal(t, FrozenHeight, frozen.FrozenHeight)
	require.Equal(t, compact.CheckpointReference, frozen.CheckpointReference)
	require.Less(t, ctx.GasMeter().GasConsumed(), uint64(1000000))
	// The auxiliary store is included in module genesis export and import.
	ctx = ctx.WithGasMeter(storetypes.NewInfiniteGasMeter())
	exported, err := state.ExportSnapshotGenesis(ctx.KVStore(SharedStoreKey))
	require.NoError(t, err)
	restored := dbadapter.Store{DB: dbm.NewMemDB()}
	require.NoError(t, state.ImportSnapshotGenesis(restored, exported))
	reexported, err := state.ExportSnapshotGenesis(restored)
	require.NoError(t, err)
	require.Equal(t, exported, reexported)
}
