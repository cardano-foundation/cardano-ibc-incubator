package state

import (
	"fmt"
	"math"
	"time"
)

// The production envelope is per transaction. The logical observation keeps the
// existing 128-header and 97-body window. A full honest 4,000-pool table receives
// the same budget even when the disputed proposal contained fewer rows.
const MaxObservationSteps = uint32(4096)
const SharedSnapshotChallengePeriod = 12 * time.Hour
const SupportedInclusionTimePerStep = 10 * time.Second
const SupportedDetectionAndPreparationTime = 30 * time.Minute

func sharedSnapshotChallengeDeadline(ctx Context) (uint64, error) {
	now := ctx.BlockTime().UnixNano()
	if now <= 0 || now > math.MaxInt64-int64(SharedSnapshotChallengePeriod) {
		return 0, fmt.Errorf("host time cannot represent the bounded challenge deadline")
	}
	return uint64(now + int64(SharedSnapshotChallengePeriod)), nil
}
