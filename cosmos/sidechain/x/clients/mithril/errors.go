package mithril

import (
	errorsmod "cosmossdk.io/errors"
)

// IBC cardano client sentinel errors
var (
	ErrInvalidChainID                             = errorsmod.Register(ModuleName, 2, "invalid chain-id")
	ErrInvalidTrustingPeriod                      = errorsmod.Register(ModuleName, 3, "invalid trusting period")
	ErrInvalidMithrilHeaderHeight                 = errorsmod.Register(ModuleName, 4, "invalid mithril header height")
	ErrInvalidMithrilHeader                       = errorsmod.Register(ModuleName, 5, "invalid mithril header")
	ErrInvalidMaxClockDrift                       = errorsmod.Register(ModuleName, 6, "invalid max clock drift")
	ErrProcessedTimeNotFound                      = errorsmod.Register(ModuleName, 7, "processed time not found")
	ErrProcessedHeightNotFound                    = errorsmod.Register(ModuleName, 8, "processed height not found")
	ErrDelayPeriodNotPassed                       = errorsmod.Register(ModuleName, 9, "packet-specified delay period has not been reached")
	ErrTrustingPeriodExpired                      = errorsmod.Register(ModuleName, 10, "time since latest trusted state has passed the trusting period")
	ErrInvalidCurrentEpoch                        = errorsmod.Register(ModuleName, 11, "invalid current epoch")
	ErrInvalidMithrilStakeDistribution            = errorsmod.Register(ModuleName, 12, "invalid mithril stake distribution")
	ErrInvalidTransactionSnapshot                 = errorsmod.Register(ModuleName, 13, "invalid cardano transaction snapshot")
	ErrInvalidMithrilStakeDistributionCertificate = errorsmod.Register(ModuleName, 14, "invalid mithril stake distribution certificate")
	ErrInvalidTransactionSnapshotCertificate      = errorsmod.Register(ModuleName, 15, "invalid cardano transaction snapshot certificate")
	ErrInvalidHeaderEpoch                         = errorsmod.Register(ModuleName, 16, "invalid header epoch")
	ErrInvalidProtocolParamaters                  = errorsmod.Register(ModuleName, 17, "invalid protocol parameters")
	ErrInvalidNumberRequiredSignatures            = errorsmod.Register(ModuleName, 18, "invalid number of required signature (k) in protocol parameters")
	ErrInvalidNumberLotteries                     = errorsmod.Register(ModuleName, 19, "invalid number of lotteries (m) in protocol parameters")
	ErrInvalidChanceWinLottery                    = errorsmod.Register(ModuleName, 20, "invalid chance of a signer win lottery (phi_f) in protocol parameters")
)
