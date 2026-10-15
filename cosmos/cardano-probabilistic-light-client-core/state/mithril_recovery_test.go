package state

import (
	"strings"
	"testing"
	"time"

	"cosmossdk.io/store/dbadapter"
	storetypes "cosmossdk.io/store/types"
	"github.com/cardano-foundation/cardano-ibc-incubator/cosmos/cardano-probabilistic-light-client-core/mithril/mithriltest"
	dbm "github.com/cosmos/cosmos-db"
	"github.com/stretchr/testify/require"
)

type mithrilRecovery struct {
	ctx     Context
	cdc     StateCodec
	shared  storetypes.KVStore
	network *mithriltest.Network
}

func newMithrilRecovery(t *testing.T) *mithrilRecovery {
	t.Helper()
	_, consensus := compactTrustedFixture(t, 65)
	shared := dbadapter.Store{DB: dbm.NewMemDB()}
	network, err := mithriltest.NewNetwork(100, 200, 300, 400, 500)
	require.NoError(t, err)
	return &mithrilRecovery{
		ctx:     Context{Time: time.Unix(0, int64(consensus.Timestamp)).Add(time.Hour), Height: 100, SelfHeight: NewHostHeight(0, 100), Snapshots: func() (storetypes.KVStore, error) { return shared, nil }},
		cdc:     jsonTestCodec{},
		shared:  shared,
		network: network,
	}
}

func (m *mithrilRecovery) anchored(network *mithriltest.Network) func(*ClientState) {
	return func(client *ClientState) {
		anchor := network.Anchor(client.CurrentEpoch)
		client.MithrilEpoch = anchor.Epoch
		client.MithrilAggregateVerificationKey = anchor.AggregateVerificationKey
		client.MithrilProtocolParametersHash = anchor.ProtocolParametersHash
	}
}

// certify records Mithril's root for the epoch after the client's anchor.
func (m *mithrilRecovery) certify(t *testing.T, client *ClientState, private storetypes.KVStore, root string) *ClientState {
	t.Helper()
	certificate, err := m.network.StakeCertificate(client.MithrilEpoch, m.network, root)
	require.NoError(t, err)
	msg := &MithrilStakeCertificates{Certificates: []string{certificate}}
	require.NoError(t, client.VerifyClientMessage(m.ctx, m.cdc, private, msg))
	require.False(t, client.CheckForMisbehaviour(m.ctx, m.cdc, private, msg))
	require.Empty(t, client.UpdateState(m.ctx, m.cdc, private, msg))
	updated, found := GetClientState(private, m.cdc)
	require.True(t, found)
	return updated
}

func (m *mithrilRecovery) recover(t *testing.T, subject *ClientState, private storetypes.KVStore, substitute *ClientState, substituteStore storetypes.KVStore) (*ClientState, error) {
	t.Helper()
	subject.UpdateStateOnMisbehaviour(m.ctx, m.cdc, private, nil)
	subject, _ = GetClientState(private, m.cdc)
	if err := subject.CheckSubstituteAndUpdateState(m.ctx, m.cdc, private, substituteStore, substitute); err != nil {
		return nil, err
	}
	recovered, found := GetClientState(private, m.cdc)
	require.True(t, found)
	require.Equal(t, Active, recovered.Status(m.ctx, private, m.cdc))
	return recovered, nil
}

func root(label string) string { return strings.Repeat(label, 32) }

// A substitute with more certificate progress hands over its anchor and the
// roots of the epochs after its checkpoint. The subject's roots stay with its
// old generation, and certificate ingestion continues from the new anchor.
func TestRecoveryAdoptsTheSubstitutesMithrilCertification(t *testing.T) {
	m := newMithrilRecovery(t)
	subject, private := recoveryRetryClient(t, m.ctx, m.cdc, 0, 10, 10, m.anchored(m.network))
	substitute, substituteStore := recoveryRetryClient(t, m.ctx, m.cdc, 10, 10, 10, m.anchored(m.network))
	epoch := subject.CurrentEpoch
	subject = m.certify(t, subject, private, root("a1"))
	substitute = m.certify(t, substitute, substituteStore, root("a1"))
	substitute = m.certify(t, substitute, substituteStore, root("a2"))
	require.Equal(t, epoch+2, substitute.MithrilEpoch)

	recovered, err := m.recover(t, subject, private, substitute, substituteStore)
	require.NoError(t, err)
	require.Equal(t, subject.VerificationGeneration+1, recovered.VerificationGeneration)
	require.Equal(t, substitute.MithrilEpoch, recovered.MithrilEpoch)
	require.Equal(t, substitute.MithrilAggregateVerificationKey, recovered.MithrilAggregateVerificationKey)
	for offset, expected := range []string{root("a1"), root("a2")} {
		certified, err := requireCertifiedStake(private, recovered.VerificationGeneration, epoch+uint64(offset)+1, expected)
		require.NoError(t, err)
		require.True(t, certified, "certified epoch %d survives recovery", epoch+uint64(offset)+1)
	}
	require.Equal(t, root("a1"), string(private.Get(mithrilStakeRootKey(subject.VerificationGeneration, epoch+1))), "old generation records are not deleted")

	recovered = m.certify(t, recovered, private, root("a3"))
	require.Equal(t, epoch+3, recovered.MithrilEpoch)
	certified, err := requireCertifiedStake(private, recovered.VerificationGeneration, epoch+3, root("a3"))
	require.NoError(t, err)
	require.True(t, certified)
}

// A substitute behind the subject's certificate progress hands over its
// earlier anchor. The subject's later root needs its certificate again.
func TestRecoveryFromASubstituteWithLessCertificateProgress(t *testing.T) {
	m := newMithrilRecovery(t)
	subject, private := recoveryRetryClient(t, m.ctx, m.cdc, 0, 10, 10, m.anchored(m.network))
	substitute, substituteStore := recoveryRetryClient(t, m.ctx, m.cdc, 10, 10, 10, m.anchored(m.network))
	epoch := subject.CurrentEpoch
	subject = m.certify(t, subject, private, root("a1"))
	subject = m.certify(t, subject, private, root("a2"))
	substitute = m.certify(t, substitute, substituteStore, root("a1"))

	recovered, err := m.recover(t, subject, private, substitute, substituteStore)
	require.NoError(t, err)
	require.Equal(t, epoch+1, recovered.MithrilEpoch)
	certified, err := requireCertifiedStake(private, recovered.VerificationGeneration, epoch+2, root("a2"))
	require.NoError(t, err)
	require.False(t, certified, "a root beyond the adopted anchor is not trusted without its certificate")

	recovered = m.certify(t, recovered, private, root("a2"))
	certified, err = requireCertifiedStake(private, recovered.VerificationGeneration, epoch+2, root("a2"))
	require.NoError(t, err)
	require.True(t, certified)
}

func TestRecoveryRejectsConflictingCertifiedStake(t *testing.T) {
	m := newMithrilRecovery(t)
	subject, private := recoveryRetryClient(t, m.ctx, m.cdc, 0, 10, 10, m.anchored(m.network))
	substitute, substituteStore := recoveryRetryClient(t, m.ctx, m.cdc, 10, 10, 10, m.anchored(m.network))
	subject = m.certify(t, subject, private, root("a1"))
	substitute = m.certify(t, substitute, substituteStore, root("b1"))
	_, err := m.recover(t, subject, private, substitute, substituteStore)
	require.ErrorContains(t, err, "certified different epoch")
}

// Recovery cannot add or drop Mithril-certified stake, or switch to another
// Mithril network at the same epoch.
func TestRecoveryKeepsTheMithrilTrustConfiguration(t *testing.T) {
	m := newMithrilRecovery(t)
	other, err := mithriltest.NewNetwork(1000, 2000, 3000)
	require.NoError(t, err)
	for _, test := range []struct {
		name                string
		subject, substitute []func(*ClientState)
		message             string
	}{
		{"anchored to unanchored", []func(*ClientState){m.anchored(m.network)}, nil, "substitute"},
		{"unanchored to anchored", nil, []func(*ClientState){m.anchored(m.network)}, "substitute"},
		{"another Mithril network", []func(*ClientState){m.anchored(m.network)}, []func(*ClientState){m.anchored(other)}, "different Mithril anchors"},
	} {
		t.Run(test.name, func(t *testing.T) {
			subject, private := recoveryRetryClient(t, m.ctx, m.cdc, 0, 10, 10, test.subject...)
			substitute, substituteStore := recoveryRetryClient(t, m.ctx, m.cdc, 10, 10, 10, test.substitute...)
			_, err := m.recover(t, subject, private, substitute, substituteStore)
			require.ErrorContains(t, err, test.message)
			frozen, _ := GetClientState(private, m.cdc)
			require.Equal(t, subject.VerificationGeneration, frozen.VerificationGeneration)
		})
	}
}

// A recovered client keeps the substitute's certified next epoch, so its
// rollover activates without a response window.
func TestRecoveredClientRollsOverOnCarriedCertification(t *testing.T) {
	fixture := makeNativeBoundaryFixture(t, false, 0)
	fixture.Client.TrustingPeriod = 7 * 24 * time.Hour
	table := fixture.Header.NewEpochContext
	network, err := mithriltest.NewNetwork(100, 200, 300, 400, 500)
	require.NoError(t, err)
	shared := dbadapter.Store{DB: dbm.NewMemDB()}
	ctx := Context{Time: time.Unix(0, int64(fixture.Header.DescendantBlocks[len(fixture.Header.DescendantBlocks)-1].Timestamp)).Add(time.Hour), Height: 1, SelfHeight: NewHostHeight(0, 1), Snapshots: func() (storetypes.KVStore, error) { return shared, nil }, VerifyHostUsability: stagedTestHostWindow}
	cdc := jsonTestCodec{}
	m := &mithrilRecovery{ctx: ctx, cdc: cdc, shared: shared, network: network}

	// The subject trusted an earlier checkpoint of the same chain.
	earlier := *fixture.Client
	earlierConsensus := *fixture.Consensus
	height := NewHeight(0, fixture.Client.LatestHeight.RevisionHeight-10)
	earlier.LatestHeight = height
	setTestCheckpoint(t, &earlier, height, testBlockHash("mithril-recovery-subject"), earlier.CurrentEpoch, earlier.LatestCheckpointSlot-10)
	earlierConsensus.Timestamp = earlier.LatestCheckpointTimestamp
	earlierConsensus.AcceptedBlockHash = earlier.LatestCheckpointBlockHash
	setTestPacketSnapshot(t, &earlierConsensus, height.RevisionHeight)
	anchorToLocalMithril(t, &earlier, network)
	private := dbadapter.Store{DB: dbm.NewMemDB()}
	subject, _, err := InitializeFromTrustedCheckpoint(ctx, cdc, private, &earlier, &earlierConsensus)
	require.NoError(t, err)

	anchorToLocalMithril(t, fixture.Client, network)
	substituteStore := dbadapter.Store{DB: dbm.NewMemDB()}
	substitute, _, err := InitializeFromTrustedCheckpoint(ctx, cdc, substituteStore, fixture.Client, fixture.Consensus)
	require.NoError(t, err)
	substitute = m.certify(t, substitute, substituteStore, tableRoot(t, table))
	require.Equal(t, table.Epoch, substitute.MithrilEpoch)

	recovered, err := m.recover(t, subject, private, substitute, substituteStore)
	require.NoError(t, err)
	// Recovery restarts the current epoch's response window.
	ctx.Time = ctx.Time.Add(SharedSnapshotChallengePeriod + 2*time.Second)
	a := &anchoredClient{ctx: ctx, cdc: cdc, private: private, shared: shared, client: recovered, fixture: fixture, network: network, table: table, base: append([]byte(nil), recovered.CheckpointReference...)}
	a.stage(t)
	proposedAt := a.ctx.Time
	require.NoError(t, a.activateAt(t, proposedAt))
	require.Equal(t, uint64(proposedAt.UnixNano()), a.client.epochChallenge(table.Epoch).UsableAfterUnixNs)
	require.NoError(t, a.activateAt(t, proposedAt.Add(time.Second)))
	require.NotEqual(t, a.base, a.client.CheckpointReference)
}
