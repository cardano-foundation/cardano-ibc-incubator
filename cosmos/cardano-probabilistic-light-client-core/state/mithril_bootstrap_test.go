package state

import (
	"strings"
	"sync"
	"testing"
	"time"

	"cosmossdk.io/store/dbadapter"
	"cosmossdk.io/store/gaskv"
	storetypes "cosmossdk.io/store/types"
	"github.com/cardano-foundation/cardano-ibc-incubator/cosmos/cardano-probabilistic-light-client-core/mithril"
	"github.com/cardano-foundation/cardano-ibc-incubator/cosmos/cardano-probabilistic-light-client-core/mithril/mithriltest"
	dbm "github.com/cosmos/cosmos-db"
	"github.com/stretchr/testify/require"
)

var (
	bootstrapNetworkOnce sync.Once
	bootstrapNetwork     *mithriltest.Network
)

// testMithril signs the bootstrap certificates of test clients.
func testMithril(t testing.TB) *mithriltest.Network {
	t.Helper()
	bootstrapNetworkOnce.Do(func() {
		var err error
		bootstrapNetwork, err = mithriltest.NewNetwork(100, 200, 300)
		require.NoError(t, err)
	})
	return bootstrapNetwork
}

// certifyBootstrap anchors a trusted client to network and returns the
// certificate that completes its bootstrap.
func certifyBootstrap(t testing.TB, client *ClientState, network *mithriltest.Network) []byte {
	t.Helper()
	entries, err := BootstrapStakeTable(client)
	require.NoError(t, err)
	root, err := mithril.StakeDistributionRoot(entries)
	require.NoError(t, err)
	anchor, certificate, err := network.Bootstrap(client.CurrentEpoch, root)
	require.NoError(t, err)
	client.MithrilEpoch = anchor.Epoch
	client.MithrilAggregateVerificationKey = anchor.AggregateVerificationKey
	client.MithrilProtocolParametersHash = anchor.ProtocolParametersHash
	return []byte(certificate)
}

// initializeTrusted initializes a trusted client whose stake table the test
// Mithril network certifies.
func initializeTrusted(t testing.TB, ctx Context, cdc StateCodec, private storetypes.KVStore, client *ClientState, consensus *ConsensusState) (*ClientState, *ConsensusState, error) {
	t.Helper()
	return InitializeFromTrustedCheckpoint(ctx, cdc, private, client, consensus, certifyBootstrap(t, client, testMithril(t)))
}

// buildTrustedBootstrap builds the bootstrap of a client whose stake table
// the test Mithril network certifies.
func buildTrustedBootstrap(t testing.TB, store storetypes.KVStore, client *ClientState, consensus *ConsensusState) (*ClientState, *ConsensusState, []*ProbabilisticHeader, error) {
	t.Helper()
	return BuildBootstrap(store, client, consensus, certifyBootstrap(t, client, testMithril(t)))
}

func bootstrapContext(consensus *ConsensusState, shared storetypes.KVStore) Context {
	return Context{Time: time.Unix(0, int64(consensus.Timestamp)), Height: 1, SelfHeight: NewHostHeight(0, 1), Snapshots: func() (storetypes.KVStore, error) { return shared, nil }}
}

// A client is created only with the anchor for the epoch before its
// checkpoint, whose certificate certifies its stake table.
func TestBootstrapRequiresMithrilCertifiedStake(t *testing.T) {
	network := testMithril(t)
	for _, test := range []struct {
		name    string
		prepare func(*ClientState, *ConsensusState) []byte
		message string
	}{
		{"no anchor", func(client *ClientState, _ *ConsensusState) []byte {
			certificate := certifyBootstrap(t, client, network)
			client.MithrilEpoch, client.MithrilAggregateVerificationKey, client.MithrilProtocolParametersHash = 0, "", ""
			return certificate
		}, "needs the Mithril anchor for epoch"},
		{"anchor for the checkpoint epoch", func(client *ClientState, _ *ConsensusState) []byte {
			certificate := certifyBootstrap(t, client, network)
			client.MithrilEpoch++
			return certificate
		}, "needs the Mithril anchor for epoch"},
		{"no certificate", func(client *ClientState, _ *ConsensusState) []byte {
			certifyBootstrap(t, client, network)
			return nil
		}, "needs a Mithril certificate"},
		{"another table", func(client *ClientState, _ *ConsensusState) []byte {
			certifyBootstrap(t, client, network)
			_, certificate, err := network.Bootstrap(client.CurrentEpoch, strings.Repeat("ab", 32))
			require.NoError(t, err)
			return []byte(certificate)
		}, "differs from the distribution Mithril certified"},
		{"another Mithril network", func(client *ClientState, _ *ConsensusState) []byte {
			certifyBootstrap(t, client, network)
			other, err := mithriltest.NewNetwork(400, 500)
			require.NoError(t, err)
			copy := *client
			return certifyBootstrap(t, &copy, other)
		}, "invalid Mithril certificate"},
	} {
		t.Run(test.name, func(t *testing.T) {
			client, consensus := compactTrustedFixture(t, 5)
			certificate := test.prepare(client, consensus)
			shared := dbadapter.Store{DB: dbm.NewMemDB()}
			_, _, err := InitializeFromTrustedCheckpoint(bootstrapContext(consensus, shared), jsonTestCodec{}, dbadapter.Store{DB: dbm.NewMemDB()}, client, consensus, certificate)
			require.ErrorContains(t, err, test.message)
			_, _, _, err = BuildBootstrap(dbadapter.Store{DB: dbm.NewMemDB()}, client, consensus, certificate)
			require.ErrorContains(t, err, test.message)
		})
	}
}

// A certified bootstrap table needs no response window, and the anchor moves
// to the checkpoint epoch, whose certificates extend it.
func TestBootstrapStakeIsUsableAtOnce(t *testing.T) {
	client, consensus := compactTrustedFixture(t, 5)
	shared := dbadapter.Store{DB: dbm.NewMemDB()}
	private := dbadapter.Store{DB: dbm.NewMemDB()}
	ctx := bootstrapContext(consensus, shared)
	thin, _, err := initializeTrusted(t, ctx, jsonTestCodec{}, private, client, consensus)
	require.NoError(t, err)
	require.Equal(t, testMithril(t).Anchor(client.CurrentEpoch), mustAnchor(t, thin))
	require.Equal(t, []*EpochContextChallenge{{Epoch: client.CurrentEpoch, UsableAfterUnixNs: uint64(ctx.Time.UnixNano())}}, thin.EpochContextChallenges)
	contexts, err := client.normalizedEpochContexts()
	require.NoError(t, err)
	certified, err := requireCertifiedStake(private, thin.VerificationGeneration, client.CurrentEpoch, tableRoot(t, epochContextByEpoch(contexts, client.CurrentEpoch)))
	require.NoError(t, err)
	require.True(t, certified)

	certificate, err := testMithril(t).StakeCertificate(thin.MithrilEpoch, testMithril(t), strings.Repeat("ef", 32))
	require.NoError(t, err)
	require.NoError(t, thin.VerifyClientMessage(ctx, jsonTestCodec{}, private, &MithrilStakeCertificates{Certificates: []string{certificate}}))
}

// The runtime bootstrap completes only with the certificate. Until then the
// client accepts no stake certificates.
func TestRuntimeBootstrapCompletesWithItsCertificate(t *testing.T) {
	client, consensus := compactTrustedFixture(t, 5)
	compact, initial, steps, err := buildTrustedBootstrap(t, dbadapter.Store{DB: dbm.NewMemDB()}, client, consensus)
	require.NoError(t, err)
	final := steps[len(steps)-1].ObservationChunk
	require.Equal(t, ObservationBootstrapComplete, final.Operation)
	require.NotEmpty(t, final.Objects)

	unanchored := *compact
	unanchored.MithrilEpoch = compact.MithrilEpoch + 1
	shared := dbadapter.Store{DB: dbm.NewMemDB()}
	ctx := bootstrapContext(consensus, shared)
	cdc := jsonTestCodec{}
	require.ErrorContains(t, unanchored.Initialize(ctx, cdc, dbadapter.Store{DB: dbm.NewMemDB()}, initial), "needs the Mithril anchor for epoch")

	private := dbadapter.Store{DB: dbm.NewMemDB()}
	require.NoError(t, compact.Initialize(ctx, cdc, private, initial))
	fresh, found := GetClientState(private, cdc)
	require.True(t, found)
	early, err := testMithril(t).StakeCertificate(fresh.MithrilEpoch, testMithril(t), strings.Repeat("ef", 32))
	require.NoError(t, err)
	require.ErrorContains(t, fresh.VerifyClientMessage(ctx, cdc, private, &MithrilStakeCertificates{Certificates: []string{early}}), "bootstrap import has not completed")
	for _, step := range steps[:len(steps)-1] {
		runObservationStep(t, ctx, cdc, private, fresh, step)
	}

	for _, objects := range [][]byte{nil, []byte(strings.Repeat("x", MaxMithrilCertificateBytes+1)), []byte(early)} {
		tampered := &ProbabilisticHeader{ObservationChunk: &ObservationChunk{Operation: ObservationBootstrapComplete, Objects: objects, Sequence: final.Sequence}}
		require.Error(t, fresh.VerifyClientMessage(ctx, cdc, private, tampered))
	}
	runObservationStep(t, ctx, cdc, private, fresh, steps[len(steps)-1])
	require.False(t, fresh.BootstrapPending)
	require.Equal(t, testMithril(t).Anchor(client.CurrentEpoch), mustAnchor(t, fresh))
	require.Equal(t, uint64(ctx.Time.UnixNano()), fresh.epochChallenge(client.CurrentEpoch).UsableAfterUnixNs)
}

// The bootstrap certificate's root is computed from the imported table at a
// bounded cost, even with the largest table.
func TestBootstrapCertificationOf4000PoolsFitsOneOperation(t *testing.T) {
	client, consensus := compactTrustedFixture(t, 4000)
	compact, initial, steps, err := buildTrustedBootstrap(t, dbadapter.Store{DB: dbm.NewMemDB()}, client, consensus)
	require.NoError(t, err)
	meter := storetypes.NewInfiniteGasMeter()
	shared := gaskv.NewStore(dbadapter.Store{DB: dbm.NewMemDB()}, meter, storetypes.KVGasConfig())
	private := gaskv.NewStore(dbadapter.Store{DB: dbm.NewMemDB()}, meter, storetypes.KVGasConfig())
	ctx := bootstrapContext(consensus, shared)
	ctx.ConsumeGas, ctx.GasConsumed = meter.ConsumeGas, meter.GasConsumed
	cdc := jsonTestCodec{}
	require.NoError(t, compact.Initialize(ctx, cdc, private, initial))
	fresh, _ := GetClientState(private, cdc)
	for _, step := range steps[:len(steps)-1] {
		runObservationStep(t, ctx, cdc, private, fresh, step)
	}
	start := meter.GasConsumed()
	runObservationStep(t, ctx, cdc, private, fresh, steps[len(steps)-1])
	used := meter.GasConsumed() - start
	require.False(t, fresh.BootstrapPending)
	require.Greater(t, used, MithrilCertificateVerificationGas)
	require.Less(t, used, MaxOperationGas)
	t.Logf("bootstrap completion with 4000 pools used %d gas", used)
}

func mustAnchor(t *testing.T, client *ClientState) mithril.Anchor {
	t.Helper()
	anchor, ok := client.mithrilAnchor()
	require.True(t, ok)
	return anchor
}
