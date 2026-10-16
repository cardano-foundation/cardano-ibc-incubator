package probabilistic

import state "github.com/cardano-foundation/cardano-ibc-incubator/cosmos/cardano-probabilistic-light-client-core/state"

var (
	ErrEpochContextPending        = state.ErrEpochContextPending
	ErrInvalidChainID             = state.ErrInvalidChainID
	ErrInvalidTrustingPeriod      = state.ErrInvalidTrustingPeriod
	ErrInvalidHeaderHeight        = state.ErrInvalidHeaderHeight
	ErrInvalidHeader              = state.ErrInvalidHeader
	ErrProcessedTimeNotFound      = state.ErrProcessedTimeNotFound
	ErrProcessedHeightNotFound    = state.ErrProcessedHeightNotFound
	ErrDelayPeriodNotPassed       = state.ErrDelayPeriodNotPassed
	ErrTrustingPeriodExpired      = state.ErrTrustingPeriodExpired
	ErrInvalidCurrentEpoch        = state.ErrInvalidCurrentEpoch
	ErrInvalidProbabilisticScore  = state.ErrInvalidProbabilisticScore
	ErrInvalidUniquePools         = state.ErrInvalidUniquePools
	ErrInvalidUniqueStake         = state.ErrInvalidUniqueStake
	ErrInvalidAcceptedBlock       = state.ErrInvalidAcceptedBlock
	ErrInvalidHostStateCommitment = state.ErrInvalidHostStateCommitment
	ErrInvalidTimestamp           = state.ErrInvalidTimestamp
	ErrNotImplemented             = state.ErrNotImplemented
	ErrInvalidMaxClockDrift       = state.ErrInvalidMaxClockDrift
)
