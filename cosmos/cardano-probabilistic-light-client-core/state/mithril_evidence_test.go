package state

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

// stageAlternative stages an alternative observation from the original
// receipt's checkpoint and returns its receipt and the receipt's ID.
func (a *anchoredClient) stageAlternative(t *testing.T, header *ProbabilisticHeader, original []byte) (*verifiedObservation, []byte) {
	t.Helper()
	plan, err := BuildObservationPlan(a.client, header, original, uint64(len(a.fixture.Client.EpochStakeDistribution)), 1)
	require.NoError(t, err)
	for _, step := range plan.Steps {
		runObservationStep(t, a.ctx, a.cdc, a.private, a.client, step)
	}
	session, err := loadObservationSession(a.shared, a.client, plan.SessionID[:])
	require.NoError(t, err)
	receipt, err := loadVerifiedObservation(a.shared, a.client, session.Receipt)
	require.NoError(t, err)
	return receipt, session.Receipt
}

// withAnotherTable copies a header whose new epoch table gives one pool a
// lovelace more, which changes the table's Mithril root but not who leads.
func withAnotherTable(t *testing.T, header *ProbabilisticHeader) *ProbabilisticHeader {
	t.Helper()
	raw, err := json.Marshal(header)
	require.NoError(t, err)
	var copy ProbabilisticHeader
	require.NoError(t, json.Unmarshal(raw, &copy))
	table := copy.NewEpochContext
	require.NotNil(t, table)
	table.StakeDistribution[0].Stake++
	var total uint64
	for _, entry := range table.StakeDistribution {
		total += entry.Stake
	}
	for _, entry := range table.StakeDistribution {
		entry.RelativeStakeNumerator, entry.RelativeStakeDenominator = entry.Stake, total
	}
	return &copy
}

// A table accepted under the response window stays checkable against a late
// certificate after retention cleanup deletes its activated record, so a
// relayer can catch up on several epochs of certificates at once.
func TestLateCertificatesCheckAcceptedStakeAfterCleanup(t *testing.T) {
	later := []string{strings.Repeat("91", 32), strings.Repeat("a1", 32)}
	for _, test := range []struct {
		name       string
		contradict int
	}{
		{"agreeing", -1},
		{"contradicting the cleaned-up table", 0},
		{"contradicting a later table", 2},
	} {
		t.Run(test.name, func(t *testing.T) {
			a := newAnchoredClient(t)
			epoch := a.table.Epoch
			a.stage(t)
			proposedAt := a.ctx.Time
			require.NoError(t, a.activateAt(t, proposedAt))
			require.NoError(t, a.activateAt(t, proposedAt.Add(SharedSnapshotChallengePeriod+time.Second)))
			require.Equal(t, epoch, a.client.CurrentEpoch)
			generation := a.client.VerificationGeneration
			require.Equal(t, tableRoot(t, a.table), string(a.private.Get(acceptedStakeRootKey(generation, epoch))))
			// The fixture crosses one epoch boundary. Later tables accepted under
			// the response window are recorded as their activations record them.
			for offset, root := range later {
				require.NoError(t, recordAcceptedStake(a.private, generation, epoch+uint64(offset)+1, root))
			}

			a.ctx.Time = time.Unix(0, int64(retentionDeadline(a.client, uint64(proposedAt.UnixNano())))).Add(time.Hour)
			for i := 0; i < 64 && len(a.shared.Get(activatedEpochKey(a.client, epoch))) > 0; i++ {
				require.NoError(t, a.client.ContinueMaintenance(a.ctx, a.cdc, a.private, ObservationCleanup))
			}
			require.Empty(t, a.shared.Get(activatedEpochKey(a.client, epoch)), "cleanup removes the activated table")
			require.Equal(t, tableRoot(t, a.table), string(a.private.Get(acceptedStakeRootKey(generation, epoch))), "cleanup keeps its accepted root")

			// Mithril's certificates for the three epochs arrive together.
			roots := append([]string{tableRoot(t, a.table)}, later...)
			if test.contradict >= 0 {
				roots[test.contradict] = strings.Repeat("ee", 32)
			}
			var certificates []string
			for offset, root := range roots {
				certificate, err := a.network.StakeCertificate(a.client.MithrilEpoch+uint64(offset), a.network, root)
				require.NoError(t, err)
				certificates = append(certificates, certificate)
			}
			msg := &MithrilStakeCertificates{Certificates: certificates}
			require.NoError(t, a.client.VerifyClientMessage(a.ctx, a.cdc, a.private, msg))
			if test.contradict >= 0 {
				require.True(t, a.client.CheckForMisbehaviour(a.ctx, a.cdc, a.private, msg))
				a.client.UpdateStateOnMisbehaviour(a.ctx, a.cdc, a.private, msg)
				frozen, found := GetClientState(a.private, a.cdc)
				require.True(t, found)
				require.Equal(t, Frozen, frozen.Status(a.ctx, a.private, a.cdc))
				return
			}
			require.False(t, a.client.CheckForMisbehaviour(a.ctx, a.cdc, a.private, msg))
			require.Empty(t, a.client.UpdateState(a.ctx, a.cdc, a.private, msg))
			updated, _ := GetClientState(a.private, a.cdc)
			require.Equal(t, epoch+uint64(len(roots))-1, updated.MithrilEpoch)
			for offset, root := range roots {
				leader := epoch + uint64(offset)
				require.Nil(t, a.private.Get(acceptedStakeRootKey(generation, leader)), "a certificate supersedes the accepted root")
				certified, err := requireCertifiedStake(a.private, generation, leader, root)
				require.NoError(t, err)
				require.True(t, certified)
			}
		})
	}
}

// An alternative that relies on a table Mithril later disproves cannot
// freeze a client whose installed table Mithril certified.
func TestDisprovedAlternativeCannotFreezeTheClient(t *testing.T) {
	a := newAnchoredClient(t)
	session := a.stage(t)
	require.NoError(t, a.activateAt(t, a.ctx.Time))
	alternative, id := a.stageAlternative(t, withAnotherTable(t, a.fixture.Fork), session.Receipt)
	require.Equal(t, a.table.Epoch, alternative.Table.Epoch)
	require.NotEqual(t, tableRoot(t, a.table), alternative.TableMithrilRoot)
	evidence := &Misbehaviour{VerifiedObservation_1: session.Receipt, VerifiedObservation_2: id}
	// Before Mithril speaks, the conflicting histories are misbehaviour.
	require.NoError(t, a.client.VerifyClientMessage(a.ctx, a.cdc, a.private, evidence))
	require.True(t, a.client.CheckForMisbehaviour(a.ctx, a.cdc, a.private, evidence))

	a.certify(t, tableRoot(t, a.table))
	require.ErrorIs(t, a.client.VerifyClientMessage(a.ctx, a.cdc, a.private, evidence), ErrIBCInvalidMisbehaviour)
	require.ErrorContains(t, a.client.VerifyClientMessage(a.ctx, a.cdc, a.private, evidence), "differs from the Mithril-certified distribution")
	require.False(t, a.client.CheckForMisbehaviour(a.ctx, a.cdc, a.private, evidence))
	require.False(t, a.client.CheckForMisbehaviour(a.ctx, a.cdc, a.private, &Misbehaviour{VerifiedObservation_1: evidence.VerifiedObservation_2, VerifiedObservation_2: evidence.VerifiedObservation_1}))
	current, _ := GetClientState(a.private, a.cdc)
	require.Equal(t, Active, current.Status(a.ctx, a.private, a.cdc))
}

// If Mithril certifies the alternative's table, the client's installed table
// is the wrong one, and the certificate itself freezes the client.
func TestCertificateExposesAnIncorrectInstalledTable(t *testing.T) {
	a := newAnchoredClient(t)
	session := a.stage(t)
	require.NoError(t, a.activateAt(t, a.ctx.Time))
	alternative, _ := a.stageAlternative(t, withAnotherTable(t, a.fixture.Fork), session.Receipt)
	msg := a.certificates(t, alternative.TableMithrilRoot)
	require.True(t, a.client.CheckForMisbehaviour(a.ctx, a.cdc, a.private, msg))
	a.client.UpdateStateOnMisbehaviour(a.ctx, a.cdc, a.private, msg)
	frozen, found := GetClientState(a.private, a.cdc)
	require.True(t, found)
	require.Equal(t, Frozen, frozen.Status(a.ctx, a.private, a.cdc))
}

// Once Mithril has certified an epoch, no observation can seal a different
// table for it, so no such receipt exists.
func TestTablesContradictingACertifiedRootDoNotSeal(t *testing.T) {
	a := newAnchoredClient(t)
	session := a.stage(t)
	require.NoError(t, a.activateAt(t, a.ctx.Time))
	a.certify(t, tableRoot(t, a.table))
	plan, err := BuildObservationPlan(a.client, withAnotherTable(t, a.fixture.Fork), session.Receipt, uint64(len(a.fixture.Client.EpochStakeDistribution)), 1)
	require.NoError(t, err)
	require.ErrorContains(t, a.sealingError(t, plan), "differs from the Mithril-certified distribution")
}

// sealingError runs a plan until a step fails, which must be the stake upload
// that seals the table.
func (a *anchoredClient) sealingError(t *testing.T, plan *ObservationPlan) error {
	t.Helper()
	for _, step := range plan.Steps {
		if err := a.client.VerifyClientMessage(a.ctx, a.cdc, a.private, step); err != nil {
			require.Equal(t, ObservationAppendStake, step.ObservationChunk.Operation)
			return err
		}
		a.client.UpdateState(a.ctx, a.cdc, a.private, step)
	}
	return nil
}
