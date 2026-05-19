package probabilistic

import errorsmod "cosmossdk.io/errors"

var (
	ErrInvalidChainID             = errorsmod.Register(ModuleName, 2, "invalid chain-id")
	ErrInvalidTrustingPeriod      = errorsmod.Register(ModuleName, 3, "invalid trusting period")
	ErrInvalidHeaderHeight        = errorsmod.Register(ModuleName, 4, "invalid probabilistic header height")
	ErrInvalidHeader              = errorsmod.Register(ModuleName, 5, "invalid probabilistic header")
	ErrProcessedTimeNotFound      = errorsmod.Register(ModuleName, 6, "processed time not found")
	ErrProcessedHeightNotFound    = errorsmod.Register(ModuleName, 7, "processed height not found")
	ErrDelayPeriodNotPassed       = errorsmod.Register(ModuleName, 8, "packet-specified delay period has not been reached")
	ErrTrustingPeriodExpired      = errorsmod.Register(ModuleName, 9, "time since latest trusted state has passed the trusting period")
	ErrInvalidCurrentEpoch        = errorsmod.Register(ModuleName, 10, "invalid current epoch")
	ErrInvalidProbabilisticScore  = errorsmod.Register(ModuleName, 12, "invalid security score")
	ErrInvalidUniquePools         = errorsmod.Register(ModuleName, 13, "invalid unique pool count")
	ErrInvalidUniqueStake         = errorsmod.Register(ModuleName, 14, "invalid qualified unique stake basis points")
	ErrInvalidAcceptedBlock       = errorsmod.Register(ModuleName, 15, "invalid accepted block")
	ErrInvalidHostStateCommitment = errorsmod.Register(ModuleName, 16, "invalid host state commitment evidence")
	ErrInvalidTimestamp           = errorsmod.Register(ModuleName, 17, "invalid timestamp")
	ErrNotImplemented             = errorsmod.Register(ModuleName, 18, "not implemented")
)
