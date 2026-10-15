package state

import (
	"bytes"
	"encoding/binary"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
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

func newAnchoredClient(t *testing.T) *anchoredClient {
	t.Helper()
	fixture := makeNativeBoundaryFixture(t, false, 0)
	fixture.Client.TrustingPeriod = 7 * 24 * time.Hour
	table := fixture.Header.NewEpochContext
	require.NotNil(t, table)
	network, err := mithriltest.NewNetwork(100, 200, 300, 400, 500)
	require.NoError(t, err)
	anchorToLocalMithril(t, fixture.Client, network)
	anchor := network.Anchor(table.Epoch - 1)
	require.Equal(t, anchor, mithril.Anchor{Epoch: fixture.Client.MithrilEpoch, AggregateVerificationKey: fixture.Client.MithrilAggregateVerificationKey, ProtocolParametersHash: fixture.Client.MithrilProtocolParametersHash})

	shared := dbadapter.Store{DB: dbm.NewMemDB()}
	private := dbadapter.Store{DB: dbm.NewMemDB()}
	ctx := Context{Time: time.Unix(0, int64(fixture.Header.DescendantBlocks[len(fixture.Header.DescendantBlocks)-1].Timestamp)).Add(time.Hour), Height: 1, SelfHeight: NewHostHeight(0, 1), Snapshots: func() (storetypes.KVStore, error) { return shared, nil }}
	cdc := jsonTestCodec{}
	client, _, err := InitializeFromTrustedCheckpoint(ctx, cdc, private, fixture.Client, fixture.Consensus)
	require.NoError(t, err)
	require.Equal(t, anchor.Epoch, client.MithrilEpoch)
	ctx.VerifyHostUsability = stagedTestHostWindow
	ctx.Time = ctx.Time.Add(SharedSnapshotChallengePeriod + 2*time.Second)
	return &anchoredClient{ctx: ctx, cdc: cdc, private: private, shared: shared, client: client, fixture: fixture, network: network, table: table, base: bytes.Clone(client.CheckpointReference)}
}

// anchorToLocalMithril anchors a trusted bootstrap client through an aggregator
// serving the certificate that sealed the stake electing its current epoch.
func anchorToLocalMithril(t *testing.T, client *ClientState, network *mithriltest.Network) {
	t.Helper()
	table := epochContextByEpoch(client.EpochContexts, client.CurrentEpoch)
	require.NotNil(t, table)
	distribution := map[string]uint64{}
	for _, entry := range table.StakeDistribution {
		distribution[entry.PoolId] = entry.Stake
	}
	certificate, err := network.StakeCertificate(client.CurrentEpoch-1, network, tableRoot(t, table))
	require.NoError(t, err)
	hash := strings.Repeat("cd", 32)
	aggregator := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/artifact/cardano-stake-distribution/epoch/" + strconv.FormatUint(client.CurrentEpoch-2, 10):
			require.NoError(t, json.NewEncoder(w).Encode(map[string]any{"epoch": client.CurrentEpoch - 2, "certificate_hash": hash, "stake_distribution": distribution}))
		case "/certificate/" + hash:
			_, _ = w.Write([]byte(certificate))
		default:
			http.NotFound(w, r)
		}
	}))
	defer aggregator.Close()
	require.NoError(t, AnchorToMithril(client, aggregator.URL))
}

func tableRoot(t *testing.T, table *EpochContext) string {
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
	a := newAnchoredClient(t)
	a.certify(t, strings.Repeat("ab", 32))
	a.stage(t)
	require.ErrorContains(t, a.activateAt(t, a.ctx.Time), "differs from the Mithril-certified distribution")
	require.Nil(t, a.client.epochChallenge(a.table.Epoch))
}

// A certificate can arrive after the client activated a table under the
// response window. One that contradicts the table proves it wrong. One that
// agrees leaves the window in place, because installed deadlines are immutable.
func TestLateCertificatesCheckTheActivatedTable(t *testing.T) {
	for _, contradicting := range []bool{true, false} {
		t.Run("contradicting="+strconv.FormatBool(contradicting), func(t *testing.T) {
			a := newAnchoredClient(t)
			a.stage(t)
			require.NoError(t, a.activateAt(t, a.ctx.Time))
			deadline := a.client.epochChallenge(a.table.Epoch).UsableAfterUnixNs

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
				return
			}
			require.Empty(t, a.client.UpdateState(a.ctx, a.cdc, a.private, msg))
			require.Equal(t, deadline, a.client.epochChallenge(a.table.Epoch).UsableAfterUnixNs)
		})
	}
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

// The bootstrap tool refuses an anchor whose distribution is not the trusted table.
func TestBootstrapAnchorsMatchTheTrustedTable(t *testing.T) {
	fixture := makeNativeBoundaryFixture(t, false, 0)
	network, err := mithriltest.NewNetwork(100, 200, 300, 400, 500)
	require.NoError(t, err)
	current := epochContextByEpoch(fixture.Client.EpochContexts, fixture.Client.CurrentEpoch)
	// Mithril certifies a distribution with one stake changed.
	current.StakeDistribution[0].Stake++
	certificate, err := network.StakeCertificate(fixture.Client.CurrentEpoch-1, network, tableRoot(t, current))
	require.NoError(t, err)
	current.StakeDistribution[0].Stake--
	distribution := map[string]uint64{}
	for _, entry := range current.StakeDistribution {
		distribution[entry.PoolId] = entry.Stake
	}
	distribution[current.StakeDistribution[0].PoolId]++
	aggregator := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/certificate/") {
			_, _ = w.Write([]byte(certificate))
			return
		}
		require.NoError(t, json.NewEncoder(w).Encode(map[string]any{"epoch": fixture.Client.CurrentEpoch - 2, "certificate_hash": strings.Repeat("cd", 32), "stake_distribution": distribution}))
	}))
	defer aggregator.Close()
	require.ErrorContains(t, AnchorToMithril(fixture.Client, aggregator.URL), "differs from the bootstrap table")
	require.Zero(t, fixture.Client.MithrilEpoch)
}
