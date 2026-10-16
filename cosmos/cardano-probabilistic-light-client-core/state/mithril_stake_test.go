package state

import (
	"bytes"
	"encoding/binary"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"cosmossdk.io/store/dbadapter"
	storetypes "cosmossdk.io/store/types"
	"github.com/cardano-foundation/cardano-ibc-incubator/cosmos/cardano-probabilistic-light-client-core/mithril"
	"github.com/cardano-foundation/cardano-ibc-incubator/cosmos/cardano-probabilistic-light-client-core/mithril/mithriltest"
	dbm "github.com/cosmos/cosmos-db"
	"github.com/stretchr/testify/require"
)

// anchoredClient runs the native boundary fixture's staged epoch 7 to 8
// observation on a client anchored to a local Mithril network in epoch 7.
// Mithril certifies the stake that elects an epoch's leaders during the epoch
// before it.
type anchoredClient struct {
	ctx      Context
	cdc      StateCodec
	private  storetypes.KVStore
	shared   storetypes.KVStore
	client   *ClientState
	fixture  nativeBoundaryFixture
	network  *mithriltest.Network
	table    *EpochContext
	base     []byte
	activate *ProbabilisticHeader
}

var (
	boundaryFixtureOnce sync.Once
	boundaryFixtureJSON []byte
)

// boundaryFixture returns a fresh copy of the native boundary fixture, which
// takes most of a Mithril test's time to generate.
func boundaryFixture(t *testing.T) nativeBoundaryFixture {
	t.Helper()
	boundaryFixtureOnce.Do(func() {
		var err error
		boundaryFixtureJSON, err = json.Marshal(makeNativeBoundaryFixture(t, false, 0))
		require.NoError(t, err)
	})
	var fixture nativeBoundaryFixture
	require.NoError(t, json.Unmarshal(boundaryFixtureJSON, &fixture))
	return fixture
}

func newAnchoredClient(t *testing.T) *anchoredClient {
	t.Helper()
	fixture := boundaryFixture(t)
	fixture.Client.TrustingPeriod = 7 * 24 * time.Hour
	table := fixture.Header.NewEpochContext
	require.NotNil(t, table)
	network, err := mithriltest.NewNetwork(100, 200, 300, 400, 500)
	require.NoError(t, err)
	certificate := anchorToLocalMithril(t, fixture.Client, network)
	require.Equal(t, network.Anchor(fixture.Client.CurrentEpoch-1), mithril.Anchor{Epoch: fixture.Client.MithrilEpoch, AggregateVerificationKey: fixture.Client.MithrilAggregateVerificationKey, ProtocolParametersHash: fixture.Client.MithrilProtocolParametersHash})

	shared := dbadapter.Store{DB: dbm.NewMemDB()}
	private := dbadapter.Store{DB: dbm.NewMemDB()}
	ctx := Context{Time: time.Unix(0, int64(fixture.Header.DescendantBlocks[len(fixture.Header.DescendantBlocks)-1].Timestamp)).Add(time.Hour), Height: 1, SelfHeight: NewHostHeight(0, 1), Snapshots: func() (storetypes.KVStore, error) { return shared, nil }}
	cdc := jsonTestCodec{}
	client, _, err := InitializeFromTrustedCheckpoint(ctx, cdc, private, fixture.Client, fixture.Consensus, certificate)
	require.NoError(t, err)
	// The bootstrap moves the anchor to the epoch whose certificates certify
	// the table electing the next epoch's leaders.
	require.Equal(t, network.Anchor(table.Epoch-1), mithril.Anchor{Epoch: client.MithrilEpoch, AggregateVerificationKey: client.MithrilAggregateVerificationKey, ProtocolParametersHash: client.MithrilProtocolParametersHash})
	ctx.HostProgress = testHostProgress
	// The certified bootstrap table is usable after the next block.
	ctx.Time = ctx.Time.Add(time.Second)
	return &anchoredClient{ctx: ctx, cdc: cdc, private: private, shared: shared, client: client, fixture: fixture, network: network, table: table, base: bytes.Clone(client.CheckpointReference)}
}

// localAggregator serves certified stake distributions by epoch, each with
// its certificate.
func localAggregator(t *testing.T, distributions map[uint64]map[string]uint64, certificates map[uint64]string) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hash := func(epoch uint64) string { return strings.Repeat(strconv.FormatUint(epoch%10, 10), 64) }
		if text, ok := strings.CutPrefix(r.URL.Path, "/artifact/cardano-stake-distribution/epoch/"); ok {
			epoch, err := strconv.ParseUint(text, 10, 64)
			if _, found := certificates[epoch]; err == nil && found {
				require.NoError(t, json.NewEncoder(w).Encode(map[string]any{"epoch": epoch, "certificate_hash": hash(epoch), "stake_distribution": distributions[epoch]}))
				return
			}
		}
		for epoch, certificate := range certificates {
			if r.URL.Path == "/certificate/"+hash(epoch) {
				_, _ = w.Write([]byte(certificate))
				return
			}
		}
		http.NotFound(w, r)
	}))
}

func tableDistribution(table *EpochContext) map[string]uint64 {
	distribution := map[string]uint64{}
	for _, entry := range table.StakeDistribution {
		distribution[entry.PoolId] = entry.Stake
	}
	return distribution
}

// anchorToLocalMithril prepares a trusted bootstrap client through an
// aggregator, as the bootstrap tool does, and returns the certificate that
// completes its bootstrap. The certificate sealing the distribution three
// epochs back names the anchor. The next one certifies the client's table.
func anchorToLocalMithril(t *testing.T, client *ClientState, network *mithriltest.Network) []byte {
	t.Helper()
	table := epochContextByEpoch(client.EpochContexts, client.CurrentEpoch)
	require.NotNil(t, table)
	earlier, err := network.StakeCertificate(client.CurrentEpoch-2, network, strings.Repeat("ab", 32))
	require.NoError(t, err)
	_, certificate, err := network.Bootstrap(client.CurrentEpoch, tableRoot(t, table))
	require.NoError(t, err)
	aggregator := localAggregator(t, map[uint64]map[string]uint64{client.CurrentEpoch - 2: tableDistribution(table)}, map[uint64]string{client.CurrentEpoch - 3: earlier, client.CurrentEpoch - 2: certificate})
	defer aggregator.Close()
	bootstrap, err := AnchorToMithril(client, aggregator.URL)
	require.NoError(t, err)
	require.Equal(t, certificate, string(bootstrap))
	return bootstrap
}

func tableRoot(t testing.TB, table *EpochContext) string {
	t.Helper()
	entries := make([]mithril.StakeEntry, 0, len(table.StakeDistribution))
	for _, entry := range table.StakeDistribution {
		entries = append(entries, mithril.StakeEntry{PoolID: entry.PoolId, Stake: entry.Stake})
	}
	root, err := mithril.StakeDistributionRoot(entries)
	require.NoError(t, err)
	return root
}

func (a *anchoredClient) certificates(t *testing.T, root string) *MithrilStakeCertificates {
	t.Helper()
	certificate, err := a.network.StakeCertificate(a.client.MithrilEpoch, a.network, root)
	require.NoError(t, err)
	msg := &MithrilStakeCertificates{Certificates: []string{certificate}}
	require.NoError(t, a.client.VerifyClientMessage(a.ctx, a.cdc, a.private, msg))
	return msg
}

func (a *anchoredClient) certify(t *testing.T, root string) {
	t.Helper()
	msg := a.certificates(t, root)
	require.False(t, a.client.CheckForMisbehaviour(a.ctx, a.cdc, a.private, msg))
	require.Empty(t, a.client.UpdateState(a.ctx, a.cdc, a.private, msg))
}

// stage uploads and verifies the observation, leaving it ready to activate.
func (a *anchoredClient) stage(t *testing.T) *observationSession {
	t.Helper()
	plan, err := BuildObservationPlan(a.client, a.fixture.Header, nil, uint64(len(a.fixture.Client.EpochStakeDistribution)), 4)
	require.NoError(t, err)
	for _, step := range plan.Steps {
		runObservationStep(t, a.ctx, a.cdc, a.private, a.client, step)
	}
	session, err := loadObservationSession(a.shared, a.client, plan.SessionID[:])
	require.NoError(t, err)
	require.True(t, session.Complete)
	a.activate = &ProbabilisticHeader{ObservationChunk: &ObservationChunk{Operation: ObservationActivate, SessionId: plan.SessionID[:], Sequence: session.Sequence + 1}}
	return session
}

func (a *anchoredClient) activateAt(t *testing.T, at time.Time) error {
	t.Helper()
	a.ctx.Time = at
	if err := a.client.VerifyClientMessage(a.ctx, a.cdc, a.private, a.activate); err != nil {
		return err
	}
	require.False(t, a.client.CheckForMisbehaviour(a.ctx, a.cdc, a.private, a.activate))
	a.client.UpdateState(a.ctx, a.cdc, a.private, a.activate)
	a.activate.ObservationChunk.Sequence++
	return nil
}

func (a *anchoredClient) proposal(t *testing.T) activatedEpochTable {
	t.Helper()
	var table activatedEpochTable
	require.NoError(t, decodeBoundedRecord(a.shared.Get(activatedEpochKey(a.client, a.table.Epoch)), &table))
	return table
}

// The sealed table carries the root Mithril would certify for it.
func TestSealedTablesCarryTheirMithrilRoot(t *testing.T) {
	a := newAnchoredClient(t)
	session := a.stage(t)
	require.Equal(t, tableRoot(t, a.table), session.TableMithrilRoot)
	receipt, err := loadVerifiedObservation(a.shared, a.client, session.Receipt)
	require.NoError(t, err)
	require.Equal(t, session.TableMithrilRoot, receipt.TableMithrilRoot)
}

func TestCertifiedStakeNeedsNoResponseWindow(t *testing.T) {
	a := newAnchoredClient(t)
	a.certify(t, tableRoot(t, a.table))
	require.Equal(t, a.table.Epoch, a.client.MithrilEpoch)
	a.stage(t)

	proposedAt := a.ctx.Time
	require.NoError(t, a.activateAt(t, proposedAt))
	require.Equal(t, a.base, a.client.CheckpointReference, "the proposal does not advance the checkpoint")
	require.Equal(t, uint64(proposedAt.UnixNano()), a.client.epochChallenge(a.table.Epoch).UsableAfterUnixNs)
	require.Equal(t, tableRoot(t, a.table), a.proposal(t).MithrilRoot)

	// The table is usable after the next committed block, not twelve hours later.
	require.NoError(t, a.activateAt(t, proposedAt.Add(time.Second)))
	require.NotEqual(t, a.base, a.client.CheckpointReference)
}

func TestUncertifiedStakeKeepsTheResponseWindow(t *testing.T) {
	a := newAnchoredClient(t)
	a.stage(t)
	proposedAt := a.ctx.Time
	require.NoError(t, a.activateAt(t, proposedAt))
	require.Equal(t, uint64(proposedAt.Add(SharedSnapshotChallengePeriod).UnixNano()), a.client.epochChallenge(a.table.Epoch).UsableAfterUnixNs)
	require.ErrorContains(t, a.activateAt(t, proposedAt.Add(time.Second)), "pending")
	require.NoError(t, a.activateAt(t, proposedAt.Add(SharedSnapshotChallengePeriod+time.Second)))
	require.NotEqual(t, a.base, a.client.CheckpointReference)
}

func TestCertifiedStakeRejectsAnyOtherTable(t *testing.T) {
	t.Run("certified before staging", func(t *testing.T) {
		a := newAnchoredClient(t)
		a.certify(t, strings.Repeat("ab", 32))
		plan, err := BuildObservationPlan(a.client, a.fixture.Header, nil, uint64(len(a.fixture.Client.EpochStakeDistribution)), 4)
		require.NoError(t, err)
		require.ErrorContains(t, a.sealingError(t, plan), "differs from the Mithril-certified distribution")
		require.Nil(t, a.client.epochChallenge(a.table.Epoch))
	})
	t.Run("certified after sealing", func(t *testing.T) {
		a := newAnchoredClient(t)
		a.stage(t)
		a.certify(t, strings.Repeat("ab", 32))
		require.ErrorContains(t, a.activateAt(t, a.ctx.Time), "differs from the Mithril-certified distribution")
		require.Nil(t, a.client.epochChallenge(a.table.Epoch))
	})
}

// A certificate arriving three hours into the response window either proves
// the installed table wrong or releases it after the certificate cutoff commits.
func TestLateCertificatesCheckTheActivatedTable(t *testing.T) {
	for _, contradicting := range []bool{true, false} {
		t.Run("contradicting="+strconv.FormatBool(contradicting), func(t *testing.T) {
			a := newAnchoredClient(t)
			a.stage(t)
			require.NoError(t, a.activateAt(t, a.ctx.Time))
			deadline := a.client.epochChallenge(a.table.Epoch).UsableAfterUnixNs
			proposal := a.proposal(t)
			a.ctx.Time = a.ctx.Time.Add(3 * time.Hour)
			certifiedAt := a.ctx.Time

			root := tableRoot(t, a.table)
			if contradicting {
				root = strings.Repeat("ab", 32)
			}
			msg := a.certificates(t, root)
			require.Equal(t, contradicting, a.client.CheckForMisbehaviour(a.ctx, a.cdc, a.private, msg))
			if contradicting {
				a.client.UpdateStateOnMisbehaviour(a.ctx, a.cdc, a.private, msg)
				frozen, found := GetClientState(a.private, a.cdc)
				require.True(t, found)
				require.Equal(t, Frozen, frozen.Status(a.ctx, a.private, a.cdc))
				require.Equal(t, deadline, frozen.epochChallenge(a.table.Epoch).UsableAfterUnixNs)
				require.ErrorIs(t, frozen.VerifyEpochUsable(a.ctx, a.table.Epoch), ErrIBCClientFrozen)
				return
			}
			require.Empty(t, a.client.UpdateState(a.ctx, a.cdc, a.private, msg))
			require.Equal(t, uint64(certifiedAt.UnixNano()), a.client.epochChallenge(a.table.Epoch).UsableAfterUnixNs)
			require.Equal(t, uint64(certifiedAt.UnixNano()), a.proposal(t).Deadline)
			// The historical receipt remains immutable and addressable. Public
			// state and the proof index expose the earlier authenticated cutoff.
			receipt, err := loadVerifiedObservation(a.shared, a.client, proposal.Receipt)
			require.NoError(t, err)
			require.Equal(t, deadline, receipt.Deadline)
			stored, found := GetClientState(a.private, a.cdc)
			require.True(t, found)
			require.Equal(t, uint64(certifiedAt.UnixNano()), stored.epochChallenge(a.table.Epoch).UsableAfterUnixNs)
			stored.EpochContextChallenges = nil
			require.NoError(t, stored.VerifyEpochUsable(a.ctx.WithBlockTime(certifiedAt.Add(2*time.Nanosecond)), a.table.Epoch))
			require.ErrorContains(t, a.activateAt(t, certifiedAt), "pending")
			require.ErrorContains(t, a.activateAt(t, certifiedAt.Add(time.Nanosecond)), "committed block")
			require.NoError(t, a.activateAt(t, certifiedAt.Add(2*time.Nanosecond)))
			require.NotEqual(t, a.base, a.client.CheckpointReference)
		})
	}
}

func TestLateCertificationDoesNotExtendAnElapsedDeadline(t *testing.T) {
	a := newAnchoredClient(t)
	a.stage(t)
	require.NoError(t, a.activateAt(t, a.ctx.Time))
	deadline := a.client.epochChallenge(a.table.Epoch).UsableAfterUnixNs
	a.ctx.Time = time.Unix(0, int64(deadline)).Add(time.Second)
	a.certify(t, tableRoot(t, a.table))
	require.Equal(t, deadline, a.client.epochChallenge(a.table.Epoch).UsableAfterUnixNs)
	require.Equal(t, deadline, a.proposal(t).Deadline)
}

func TestCertificationOnlyReleasesItsOwnEpoch(t *testing.T) {
	a := newAnchoredClient(t)
	a.stage(t)
	require.NoError(t, a.activateAt(t, a.ctx.Time))
	deadline := a.client.epochChallenge(a.table.Epoch).UsableAfterUnixNs
	other := a.table.Epoch + 1
	a.client.EpochContextChallenges = append(a.client.EpochContextChallenges, &EpochContextChallenge{Epoch: other, UsableAfterUnixNs: deadline})
	require.NoError(t, writeClientState(a.ctx, a.cdc, a.private, a.client))
	a.ctx.Time = a.ctx.Time.Add(3 * time.Hour)
	a.certify(t, tableRoot(t, a.table))
	require.Equal(t, uint64(a.ctx.Time.UnixNano()), a.client.epochChallenge(a.table.Epoch).UsableAfterUnixNs)
	require.Equal(t, deadline, a.client.epochChallenge(other).UsableAfterUnixNs)
	require.ErrorIs(t, a.client.VerifyEpochUsable(a.ctx.WithBlockTime(a.ctx.Time.Add(time.Second)), other), ErrEpochContextPending)
}

func TestMithrilStakeCertificatesMustExtendTheAnchor(t *testing.T) {
	a := newAnchoredClient(t)
	bridging, err := a.network.Certificate(map[string]string{
		"next_aggregate_verification_key": a.network.AggregateVerificationKey,
		"next_protocol_parameters":        a.network.ProtocolParametersHash,
		"current_epoch":                   strconv.FormatUint(a.client.MithrilEpoch, 10),
	})
	require.NoError(t, err)
	// Advancing without recording stake would strand the next epoch's table.
	require.ErrorContains(t, a.client.VerifyClientMessage(a.ctx, a.cdc, a.private, &MithrilStakeCertificates{Certificates: []string{bridging}}), "must certify a Cardano stake distribution")

	forger, err := mithriltest.NewNetwork(1000, 2000, 3000)
	require.NoError(t, err)
	forged, err := forger.StakeCertificate(a.client.MithrilEpoch, forger, tableRoot(t, a.table))
	require.NoError(t, err)
	require.ErrorIs(t, a.client.VerifyClientMessage(a.ctx, a.cdc, a.private, &MithrilStakeCertificates{Certificates: []string{forged}}), ErrInvalidHeader)

	// The anchor moves on, so a recorded certificate cannot be applied again.
	msg := a.certificates(t, tableRoot(t, a.table))
	require.Empty(t, a.client.UpdateState(a.ctx, a.cdc, a.private, msg))
	require.ErrorContains(t, a.client.VerifyClientMessage(a.ctx, a.cdc, a.private, msg), "current_epoch")

	require.ErrorIs(t, (&MithrilStakeCertificates{}).ValidateBasic(), ErrInvalidHeader)
	require.ErrorIs(t, (&MithrilStakeCertificates{Certificates: []string{strings.Repeat("x", MaxMithrilCertificateBytes+1)}}).ValidateBasic(), ErrInvalidHeader)
	oversized := strings.Repeat("x", MaxMithrilCertificateBytes)
	require.ErrorContains(t, (&MithrilStakeCertificates{Certificates: []string{oversized, oversized}}).ValidateBasic(), "transport budget")
}

func TestMithrilAnchorsAreValidated(t *testing.T) {
	a := newAnchoredClient(t)
	client := *a.client
	client.MithrilProtocolParametersHash = "00"
	require.ErrorContains(t, client.Validate(), "protocol parameters hash")

	certificate, err := a.network.StakeCertificate(a.client.MithrilEpoch, a.network, strings.Repeat("ab", 32))
	require.NoError(t, err)
	msg := &MithrilStakeCertificates{Certificates: []string{certificate}}
	unanchored := *a.client
	unanchored.MithrilEpoch, unanchored.MithrilAggregateVerificationKey, unanchored.MithrilProtocolParametersHash = 0, "", ""
	require.ErrorContains(t, unanchored.VerifyClientMessage(a.ctx, a.cdc, a.private, msg), "no Mithril anchor")
}

// Rows must arrive in Mithril's pool ID order, not binary key order.
func TestStakeRowsFollowMithrilOrder(t *testing.T) {
	store := dbadapter.Store{DB: dbm.NewMemDB()}
	session := &observationSession{TableRows: 1, TableMithril: mithril.StakeRootBuilder{Last: "pool1zzz"}}
	row := binary.BigEndian.AppendUint64(make([]byte, 28), 1)
	require.ErrorContains(t, appendObservationStake(store, session, row), "Mithril's pool ID order")
}

// The bootstrap tool refuses a table that is not the distribution Mithril
// certified.
func TestBootstrapAnchorsMatchTheTrustedTable(t *testing.T) {
	fixture := boundaryFixture(t)
	network, err := mithriltest.NewNetwork(100, 200, 300, 400, 500)
	require.NoError(t, err)
	current := epochContextByEpoch(fixture.Client.EpochContexts, fixture.Client.CurrentEpoch)
	epoch := fixture.Client.CurrentEpoch
	// Mithril certifies a distribution with one stake changed.
	current.StakeDistribution[0].Stake++
	certified := tableDistribution(current)
	_, certificate, err := network.Bootstrap(epoch, tableRoot(t, current))
	require.NoError(t, err)
	current.StakeDistribution[0].Stake--
	earlier, err := network.StakeCertificate(epoch-2, network, strings.Repeat("ab", 32))
	require.NoError(t, err)
	aggregator := localAggregator(t, map[uint64]map[string]uint64{epoch - 2: certified}, map[uint64]string{epoch - 3: earlier, epoch - 2: certificate})
	defer aggregator.Close()
	_, err = AnchorToMithril(fixture.Client, aggregator.URL)
	require.ErrorContains(t, err, "differs from the bootstrap table")
	require.Zero(t, fixture.Client.MithrilEpoch)
}
