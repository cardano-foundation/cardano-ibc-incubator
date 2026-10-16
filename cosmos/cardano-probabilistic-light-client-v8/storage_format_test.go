package probabilistic

import (
	"bytes"
	"crypto/sha256"
	"fmt"
	"testing"
	"time"

	storetypes "cosmossdk.io/store/types"

	"cosmossdk.io/store/dbadapter"
	"github.com/blinklabs-io/gouroboros/ledger/common"
	state "github.com/cardano-foundation/cardano-ibc-incubator/cosmos/cardano-probabilistic-light-client-core/state"
	dbm "github.com/cosmos/cosmos-db"
	sdk "github.com/cosmos/cosmos-sdk/types"
	clienttypes "github.com/cosmos/ibc-go/v8/modules/core/02-client/types"
	"github.com/stretchr/testify/require"
)

func TestOnlySnapshotStorageCanCreateAClient(t *testing.T) {
	fixture := capacityEvidence(t, "control")
	client, initial, _, err := buildTrustedBootstrap(t, dbadapter.Store{DB: dbm.NewMemDB()}, fixture.Client, fixture.Consensus)
	require.NoError(t, err)
	require.Equal(t, state.StorageVersion, client.StorageVersion)
	require.Empty(t, client.EpochStakeDistribution)
	require.Empty(t, initial.PacketStateSnapshot)
	require.LessOrEqual(t, client.Size(), state.MaxClientBytes)
	require.LessOrEqual(t, initial.Size(), state.MaxConsensusBytes)
	require.Equal(t, state.StorageVersion, NewClientState("cardano", NewHeight(0, 1), 1, 1, 1, nil).StorageVersion)
	signer := sdk.AccAddress(bytes.Repeat([]byte{9}, 20)).String()
	for _, version := range []uint32{0, 1, 3} {
		t.Run(fmt.Sprintf("version %d", version), func(t *testing.T) {
			invalid := fromCoreClientState(toCoreClientState(client))
			invalid.StorageVersion = version
			message, err := clienttypes.NewMsgCreateClient(invalid, initial, signer)
			require.NoError(t, err)
			require.Error(t, message.ValidateBasic())
			ctx, private := newProbabilisticTestClientStore(t, "unsupported-format")
			before := recoveryStoreSnapshot(t, private)
			require.Error(t, invalid.Initialize(ctx, newProbabilisticTestCodec(), private, initial))
			require.Equal(t, before, recoveryStoreSnapshot(t, private))
			require.Error(t, invalid.VerifyClientMessage(ctx, newProbabilisticTestCodec(), private, &ProbabilisticHeader{}))
		})
	}
	// A version marker cannot make an inline client installable.
	inline := fromCoreClientState(toCoreClientState(fixture.Client))
	inline.StorageVersion = state.StorageVersion
	require.Error(t, inline.Validate())
	inline = fromCoreClientState(toCoreClientState(client))
	inline.EpochStakeDistribution = fixture.Client.EpochStakeDistribution
	require.Error(t, inline.Validate())
	consensus := fromCoreConsensusState(toCoreConsensusState(initial))
	consensus.VerificationGeneration = 0
	require.Error(t, consensus.ValidateBasic())
	consensus.VerificationGeneration = initial.VerificationGeneration
	consensus.PacketStateSnapshot = fixture.Consensus.PacketStateSnapshot
	require.Error(t, consensus.ValidateBasic())
	// Real MsgCreateClient execution accepts the builder's bounded format.
	app, ctx, _ := newBoundaryTestApp(t, initial.GetTime())
	message, err := clienttypes.NewMsgCreateClient(client, initial, signer)
	require.NoError(t, err)
	require.NoError(t, message.ValidateBasic())
	_, err = app.MsgServiceRouter().Handler(message)(ctx, message)
	require.NoError(t, err)
	installed, found := getClientState(app.IBCKeeper.ClientKeeper.ClientStore(ctx, ModuleName+"-0"), app.AppCodec())
	require.True(t, found)
	require.Equal(t, state.StorageVersion, installed.StorageVersion)
	require.True(t, installed.BootstrapPending)
	// Full logical evidence is input to the planner, never an executable update.
	require.ErrorContains(t, fixture.Header.ValidateBasic(), "bounded observation operations")
	require.Error(t, (&Misbehaviour{ClientId: ModuleName + "-0", ProbabilisticHeader1: fixture.Header, ProbabilisticHeader2: fixture.Fork}).ValidateBasic())
}

// A host tracker replacement starts an observation clock. It does not impose
// a response window on already usable state.
func TestSnapshotHostReplacementDoesNotStartChallengeWindow(t *testing.T) {
	now := time.Unix(1_700_000_000, 0)
	app, ctx, _ := newBoundaryTestApp(t, now)
	key := app.GetKey("ibc")
	store := ctx.KVStore(key)
	previous := &state.HostProgress{Height: ctx.BlockHeight() - 1, TimeUnixNs: uint64(now.Add(-time.Second).UnixNano()), ClockID: 1}
	store.Set([]byte("probabilisticHost/continuity"), encodeHostProgress(previous))
	host := &formatTestHost{key: key, ante: func(ctx sdk.Context, _ sdk.Tx, _ bool) (sdk.Context, error) { return ctx, nil }}
	InstallHostLiveness(host)
	_, err := host.begin(ctx)
	require.NoError(t, err)
	progress := decodeHostProgress(store.Get(hostProgressKey))
	require.NotNil(t, progress)
	require.Equal(t, uint64(now.UnixNano()), progress.ClockID)
	require.Zero(t, progress.ObservationTime)
	require.Equal(t, encodeHostProgress(previous), store.Get([]byte("probabilisticHost/continuity")))
	later := coreContext(ctx.WithBlockTime(now.Add(3*time.Minute + time.Second)))
	progress.TimeUnixNs = uint64(later.BlockTime().UnixNano())
	progress.PreviousTimeUnixNs = progress.TimeUnixNs - 1
	require.NoError(t, state.VerifyHostWindow(later, 1, progress))
}

type formatTestHost struct {
	key   *storetypes.KVStoreKey
	begin sdk.BeginBlocker
	ante  sdk.AnteHandler
}

func (h *formatTestHost) GetKey(string) *storetypes.KVStoreKey { return h.key }
func (h *formatTestHost) BeginBlocker(sdk.Context) (sdk.BeginBlock, error) {
	return sdk.BeginBlock{}, nil
}
func (h *formatTestHost) SetBeginBlocker(begin sdk.BeginBlocker) { h.begin = begin }
func (h *formatTestHost) AnteHandler() sdk.AnteHandler           { return h.ante }
func (h *formatTestHost) SetAnteHandler(ante sdk.AnteHandler)    { h.ante = ante }

func TestInitialRegistryCanRetainZeroStakePoolsBeyondElectionCapacity(t *testing.T) {
	fixture := capacityEvidence(t, "control")
	hash := sha256.Sum256([]byte("registered-zero-stake-pool"))
	binding := &PoolRegistrationBinding{PoolId: common.PoolId(hash[:28]).String(), VrfKeyHash: hash[:], FirstRegistrationSlot: 1}
	for _, registry := range []*PoolRegistryState{fixture.Client.LatestCheckpointPoolRegistry, fixture.Consensus.PoolRegistry} {
		registry.Pools = append(registry.Pools, &PoolRegistrationRecord{Registration: binding, Registered: true})
		registry.Mark = append(registry.Mark, binding)
		registry.Effective = append(registry.Effective, binding)
	}
	require.Len(t, fixture.Client.EpochStakeDistribution, state.MaxStakeEntries)
	_, _, _, err := buildTrustedBootstrap(t, dbadapter.Store{DB: dbm.NewMemDB()}, fixture.Client, fixture.Consensus)
	require.NoError(t, err)
}
