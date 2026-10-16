package state

import (
	"encoding/json"
	"os"
	"testing"
	"time"

	"github.com/cardano-foundation/cardano-ibc-incubator/cosmos/cardano-probabilistic-light-client-core/mithril"
	"github.com/stretchr/testify/require"
)

// These responses are also consumed by Hermes's normal staging regression.
// Exporting them keeps the relayer test tied to the actual verifier's gates.
func TestEpochUsabilityAcrossHaltAndCertification(t *testing.T) {
	frames := map[string]*EpochUsability{}
	var matchingCertificate string
	for _, certification := range []bool{false, true} {
		name := "window"
		if certification {
			name = "certificate"
		}
		t.Run(name, func(t *testing.T) {
			f := newSnapshotExpiryFixture(t)
			f.ctx.Time = time.Unix(0, int64(f.evidence.Header.DescendantBlocks[len(f.evidence.Header.DescendantBlocks)-1].Timestamp)).Add(time.Hour)
			progress, err := AdvanceHostProgress(f.ctx, nil)
			require.NoError(t, err)
			f.ctx.HostProgress = func(Context) *HostProgress { return progress }
			advance := func(gap time.Duration) {
				t.Helper()
				f.ctx.Height++
				f.ctx.SelfHeight.RevisionHeight = uint64(f.ctx.Height)
				f.ctx.Time = f.ctx.Time.Add(gap)
				progress, err = AdvanceHostProgress(f.ctx, progress)
				require.NoError(t, err)
			}
			advance(time.Second)
			advance(time.Second)
			query := func(label string, status EpochUsabilityStatus) {
				t.Helper()
				before := observationStoreContents(t, f.shared)
				result, err := f.client.EpochUsability(f.ctx, f.private, f.cdc, 8)
				require.NoError(t, err)
				require.Equal(t, status, result.Status)
				require.Equal(t, uint64(f.ctx.Height), result.Height)
				require.Equal(t, uint64(f.ctx.Time.UnixNano()), result.Timestamp)
				require.Equal(t, before, observationStoreContents(t, f.shared), "readiness must not mutate the verifier")
				frames[name+"_"+label] = result
			}
			query("unproposed", EpochUnproposed)
			plan := f.stage(t, f.evidence.Header, nil)
			runObservationStep(t, f.ctx, f.cdc, f.private, f.client, f.activation(t, plan))
			deadline := f.client.epochChallenge(8).UsableAfterUnixNs
			query("proposed", EpochPending)
			for i := 0; i < 1800; i++ {
				advance(HostBlockGapTolerance)
			}
			query("five_hours", EpochPending)
			advance(2 * time.Hour)
			require.Greater(t, uint64(f.ctx.Time.UnixNano()), deadline)
			query("after_halt", EpochPending)
			require.ErrorIs(t, f.client.VerifyClientMessage(f.ctx, f.cdc, f.private, f.activation(t, plan)), ErrEpochContextPending)
			if certification {
				var entries []mithril.StakeEntry
				for _, row := range f.evidence.Header.NewEpochContext.StakeDistribution {
					entries = append(entries, mithril.StakeEntry{PoolID: row.PoolId, Stake: row.Stake})
				}
				root, err := mithril.StakeDistributionRoot(entries)
				require.NoError(t, err)
				network := testMithril(t)
				certificate, err := network.StakeCertificate(f.client.MithrilEpoch, network, root)
				require.NoError(t, err)
				matchingCertificate = certificate
				advance(time.Second)
				message := &MithrilStakeCertificates{Certificates: []string{certificate}}
				require.NoError(t, f.client.VerifyClientMessage(f.ctx, f.cdc, f.private, message))
				f.client.UpdateState(f.ctx, f.cdc, f.private, message)
				f.client, _ = GetClientState(f.private, f.cdc)
				query("committed", EpochPending)
			} else {
				for i := 0; i < 360; i++ {
					advance(HostBlockGapTolerance)
				}
				query("complete", EpochPending)
			}
			advance(time.Second)
			query("first_child", EpochPending)
			advance(time.Second)
			query("usable", EpochUsable)
			runObservationStep(t, f.ctx, f.cdc, f.private, f.client, f.activation(t, plan))
			require.Equal(t, Active, f.client.Status(f.ctx, f.private, f.cdc))
			unsupported := *f.client
			unsupported.StorageVersion++
			result, err := unsupported.EpochUsability(f.ctx, f.private, f.cdc, 8)
			require.NoError(t, err)
			require.Equal(t, EpochUnsupported, result.Status)
			frames[name+"_unsupported"] = result
			advance(time.Unix(0, int64(f.client.LatestCheckpointTimestamp)).Add(f.client.TrustingPeriod).Sub(f.ctx.Time))
			query("expired", EpochExpired)
			_, err = beginObservation(f.ctx, f.shared, f.private, f.client, &ObservationChunk{BaseCheckpointReference: f.client.CheckpointReference})
			require.ErrorIs(t, err, ErrTrustingPeriodExpired)
			f.client.UpdateStateOnMisbehaviour(f.ctx, f.cdc, f.private, nil)
			f.client, _ = GetClientState(f.private, f.cdc)
			query("frozen", EpochFrozen)
		})
	}
	if path := os.Getenv("HERMES_EPOCH_USABILITY_FIXTURE"); path != "" {
		encoded, err := json.MarshalIndent(struct {
			Responses   map[string]*EpochUsability `json:"responses"`
			Certificate string                     `json:"certificate"`
		}{frames, matchingCertificate}, "", "  ")
		require.NoError(t, err)
		require.NoError(t, os.WriteFile(path, append(encoded, '\n'), 0o644))
	}
}
