package state

import (
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestMaximumObservationFitsResponseWindow(t *testing.T) {
	// Table boundaries are canonical. Block boundaries can vary down to one
	// header per transaction. Every continuation processes a full certificate
	// batch except the body's last one, even when a different account relays it.
	tableSteps := (MaxStakeEntries + maxObservationRowsPerStep - 1) / maxObservationRowsPerStep
	certificateSteps := (maxCertificatesPerBody + maxCertificatesPerStep - 1) / maxCertificatesPerStep
	verification := 2*tableSteps + MaxHeaderBlocks + (MaxBridgeBlocks+1)*(certificateSteps-1)
	forward := 1 + verification + 1 + 2   // BEGIN, verification, COMPLETE, two activations
	challenge := 1 + verification + 1 + 1 // BEGIN, verification, COMPLETE, freeze
	require.Equal(t, 6*time.Hour, SharedSnapshotChallengePeriod)
	require.Equal(t, 2427, forward)
	require.Equal(t, 2426, challenge)
	require.LessOrEqual(t, uint32(forward-1), MaxObservationSteps)
	require.LessOrEqual(t, uint32(challenge-2), MaxObservationSteps)
	require.LessOrEqual(t, time.Duration(forward)*SupportedInclusionTimePerStep+SupportedDetectionAndPreparationTime, SharedSnapshotChallengePeriod)
	require.LessOrEqual(t, time.Duration(challenge)*SupportedInclusionTimePerStep+SupportedDetectionAndPreparationTime, SharedSnapshotChallengePeriod)
}
