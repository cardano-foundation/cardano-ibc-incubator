package state

import (
	"bytes"
	"encoding/binary"
	"testing"
	"time"

	"cosmossdk.io/store/dbadapter"
	storetypes "cosmossdk.io/store/types"
	dbm "github.com/cosmos/cosmos-db"
	"github.com/stretchr/testify/require"
)

func TestSnapshotCrossEpochZeroStakeProducer(t *testing.T) {
	// Producer 11 is registered and recently productive, but sits out epoch 7.
	// It regains stake and produces a genuinely signed epoch-8 descendant.
	fixture := makeNativeBoundaryFixtureWithProducers(t, false, 0, 966, 0, map[uint64]int{1002: 11})
	fixture.Client.TrustingPeriod = 7 * 24 * time.Hour
	returning := fixture.Client.EpochStakeDistribution[11]
	previous := cloneStakeDistributionEntries(fixture.Client.EpochStakeDistribution)
	previous[12].Stake += previous[11].Stake
	previous[12].RelativeStakeNumerator = previous[12].Stake
	previous = append(previous[:11], previous[12:]...)
	fixture.Client.EpochStakeDistribution = previous
	fixture.Client.EpochContexts[0].StakeDistribution = previous
	header := boundaryHeaderAtAnchor(t, fixture.Header, 966, 1000)
	require.Equal(t, uint64(7), header.AnchorBlock.Epoch)
	require.Equal(t, uint64(8), header.DescendantBlocks[1].Epoch)
	require.Len(t, previous, 12)
	require.Len(t, header.NewEpochContext.StakeDistribution, 13)

	for _, missingNativeStake := range []bool{false, true} {
		name := "valid next-epoch producer"
		if missingNativeStake {
			name = "missing block-epoch stake remains invalid"
		}
		t.Run(name, func(t *testing.T) {
			shared := dbadapter.Store{DB: dbm.NewMemDB()}
			private := dbadapter.Store{DB: dbm.NewMemDB()}
			ctx := Context{Time: time.Unix(0, int64(header.DescendantBlocks[len(header.DescendantBlocks)-1].Timestamp)), Height: 1, SelfHeight: NewHostHeight(0, 1), Snapshots: func() (storetypes.KVStore, error) { return shared, nil }}
			cdc := jsonTestCodec{}
			client, _, err := initializeTrusted(t, ctx, cdc, private, fixture.Client, fixture.Consensus)
			require.NoError(t, err)
			ctx.HostProgress = testHostProgress
			ctx.Time = ctx.Time.Add(SharedSnapshotChallengePeriod + time.Second)
			evidence := cloneNativeHeader(t, header)
			if missingNativeStake {
				// This is a false omission in the applicable epoch, unlike the
				// legitimate zero in the preceding anchor epoch.
				evidence.NewEpochContext.StakeDistribution = cloneStakeDistributionEntries(previous)
			}
			plan, err := BuildObservationPlan(client, evidence, nil, uint64(len(previous)), 1)
			require.NoError(t, err)
			for _, step := range plan.Steps {
				chunk := step.ObservationChunk
				if missingNativeStake && len(chunk.Blocks) == 1 && chunk.Blocks[0].Height.RevisionHeight == 1002 {
					require.ErrorContains(t, client.VerifyClientMessage(ctx, cdc, private, step), "issuer has no sealed stake row: epoch 8")
					return
				}
				runObservationStep(t, ctx, cdc, private, client, step)
			}
			require.False(t, missingNativeStake, "the returning producer's native eligibility must be checked")
			session, err := loadObservationSession(shared, client, plan.SessionID[:])
			require.NoError(t, err)
			require.True(t, session.Complete)
			key := mustPoolKey(t, returning.PoolId)
			_, found, err := NewSnapshotMap(shared, session.Anchor.Scope, snapshotStake).Lookup(session.Anchor.Stake.Root, key)
			require.NoError(t, err)
			require.False(t, found)
			amount, err := lookupStakeAmount(shared, session.Working.Scope, session.Working.Stake, key)
			require.NoError(t, err)
			require.Equal(t, returning.Stake, amount)
			binding, found, err := lookupBinding(shared, session.Anchor.Scope, session.Anchor.Registry.Effective, key)
			require.NoError(t, err)
			require.True(t, found)
			cutoff, err := client.poolRegistrationCutoffSlotExclusive(session.Anchor.Slot)
			require.NoError(t, err)
			require.Less(t, binding.FirstRegistrationSlot, cutoff)
			production, err := lookupProduction(shared, session.Anchor.Scope, session.Anchor.Production, key, session.Anchor.Epoch)
			require.NoError(t, err)
			require.NotZero(t, production.CompletedEpochsBitmap)
			receipt, err := loadVerifiedObservation(shared, client, session.Receipt)
			require.NoError(t, err)
			require.Equal(t, uint64(11), receipt.QualifiedPools, "the returning producer has no anchor-epoch qualification")
			require.Equal(t, uint64(550), receipt.QualifiedStakeBps, "only the other eleven producers contribute credit")

			// Compare qualification with the independent batch oracle on the same
			// native evidence and its independently authenticated anchor state.
			oracleStore := dbadapter.Store{DB: dbm.NewMemDB()}

			trusted, err := fixture.Client.latestTrustedBlockState(oracleStore, cdc)
			require.NoError(t, err)
			contexts := append(fixture.Client.EpochContexts, header.NewEpochContext)
			auth, err := fixture.Client.authenticateHeaderBlocksWithContexts(header, contexts, trusted.operationalCertificateCounters, trusted)
			require.NoError(t, err)
			require.NoError(t, attachPoolProduction(auth, trusted))
			require.NoError(t, attachSettlementCredit(auth, trusted, contexts))
			pools, credit, err := fixture.Client.computeHeaderSecurityMetrics(auth, fixture.Client.EpochContexts[0])
			require.NoError(t, err)
			require.Equal(t, receipt.QualifiedPools, pools)
			require.Equal(t, receipt.QualifiedStakeBps, credit)
		})
	}
}

func TestQualificationStakeLookupDistinguishesAbsenceFromInvalidRecords(t *testing.T) {
	for _, test := range []struct {
		name   string
		raw    []byte
		total  uint64
		absent bool
		valid  bool
	}{
		{name: "absent means zero qualification", total: 100, absent: true, valid: true},
		{name: "positive stake", raw: binary.BigEndian.AppendUint64(nil, 20), total: 100, valid: true},
		{name: "malformed row", raw: []byte{20}, total: 100},
		{name: "stored zero", raw: make([]byte, 8), total: 100},
		{name: "amount above total", raw: binary.BigEndian.AppendUint64(nil, 101), total: 100},
		{name: "zero total", raw: binary.BigEndian.AppendUint64(nil, 20)},
		{name: "absent row with zero total", absent: true},
	} {
		t.Run(test.name, func(t *testing.T) {
			store := dbadapter.Store{DB: dbm.NewMemDB()}
			key := bytes.Repeat([]byte{1}, 28)
			var scope [32]byte
			snapshot := stakeSnapshot{Epoch: 7, Total: test.total}
			if !test.absent {
				var err error
				snapshot.Root, err = NewSnapshotMap(store, scope, snapshotStake).Put(SnapshotRoot{}, key, test.raw)
				require.NoError(t, err)
			}
			amount, found, err := lookupOptionalStakeAmount(store, scope, snapshot, key)
			if test.valid {
				require.NoError(t, err)
				require.Equal(t, !test.absent, found)
				if test.absent {
					require.Zero(t, amount)
				} else {
					require.Equal(t, uint64(20), amount)
				}
			} else {
				require.Error(t, err)
			}
			_, err = lookupStakeAmount(store, scope, snapshot, key)
			if test.valid && !test.absent {
				require.NoError(t, err)
			} else {
				require.Error(t, err, "native eligibility always requires a positive stored row")
			}
		})
	}
	t.Run("missing snapshot page remains an error", func(t *testing.T) {
		store := dbadapter.Store{DB: dbm.NewMemDB()}
		snapshot := stakeSnapshot{Epoch: 7, Total: 100, Root: SnapshotRoot{Hash: [32]byte{1}, Rows: 1}}
		_, _, err := lookupOptionalStakeAmount(store, [32]byte{}, snapshot, bytes.Repeat([]byte{1}, 28))
		require.ErrorContains(t, err, "snapshot page is missing")
	})
}
