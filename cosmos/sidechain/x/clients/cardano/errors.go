package cardano

import (
	errorsmod "cosmossdk.io/errors"
)

// IBC cardano client sentinel errors
var (
	ErrInvalidChainID              = errorsmod.Register(ModuleName, 2, "invalid chain-id")
	ErrInvalidTrustingPeriod       = errorsmod.Register(ModuleName, 3, "invalid trusting period")
	ErrInvalidUnbondingPeriod      = errorsmod.Register(ModuleName, 4, "invalid unbonding period")
	ErrInvalidBlockDataHeight      = errorsmod.Register(ModuleName, 5, "invalid block data height")
	ErrInvalidBlockDataSlot        = errorsmod.Register(ModuleName, 6, "invalid block data slot")
	ErrInvalidHeader               = errorsmod.Register(ModuleName, 7, "invalid header")
	ErrInvalidMaxClockDrift        = errorsmod.Register(ModuleName, 8, "invalid max clock drift")
	ErrProcessedTimeNotFound       = errorsmod.Register(ModuleName, 9, "processed time not found")
	ErrProcessedHeightNotFound     = errorsmod.Register(ModuleName, 10, "processed height not found")
	ErrDelayPeriodNotPassed        = errorsmod.Register(ModuleName, 11, "packet-specified delay period has not been reached")
	ErrTrustingPeriodExpired       = errorsmod.Register(ModuleName, 12, "time since latest trusted state has passed the trusting period")
	ErrUnbondingPeriodExpired      = errorsmod.Register(ModuleName, 13, "time since latest trusted state has passed the unbonding period")
	ErrInvalidProofSpecs           = errorsmod.Register(ModuleName, 14, "invalid proof specs")
	ErrInvalidValidatorSet         = errorsmod.Register(ModuleName, 15, "invalid validator set")
	ErrInvalidHeaderCbor           = errorsmod.Register(ModuleName, 16, "invalid header cbor")
	ErrInvalidBlockDataHash        = errorsmod.Register(ModuleName, 17, "invalid block data hash")
	ErrInvalidBlockDataEpochNumber = errorsmod.Register(ModuleName, 18, "invalid block data block number")
	ErrInvalidBlockDataEpochNonce  = errorsmod.Register(ModuleName, 19, "invalid block data block nonce")
	ErrInvalidCurrentEpoch         = errorsmod.Register(ModuleName, 20, "invalid current epoch")
	ErrInvalidEpochLength          = errorsmod.Register(ModuleName, 21, "invalid epoch length")
	ErrInvalidSlotPerKesPeriod     = errorsmod.Register(ModuleName, 22, "invalid slot per kes poriod")
	ErrInvalidChainId              = errorsmod.Register(ModuleName, 23, "invalid chain ID")
	ErrInvalidEpochNo              = errorsmod.Register(ModuleName, 24, "invalid epoch number")
	ErrInvalidBlockData            = errorsmod.Register(ModuleName, 25, "invalid block data")
	ErrInvalidSPOsNewEpoch         = errorsmod.Register(ModuleName, 26, "invalid validator set for new epoch")
	ErrInvalidConsensus            = errorsmod.Register(ModuleName, 27, "invalid consensus state")
)
