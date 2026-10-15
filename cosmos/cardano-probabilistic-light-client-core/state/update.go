package state

import (
	"math/bits"

	storetypes "cosmossdk.io/store/types"
)

func (cs *ClientState) VerifyClientMessage(ctx Context, cdc StateCodec, clientStore storetypes.KVStore, clientMsg any) error {
	if err := cs.Validate(); err != nil {
		return err
	}
	switch msg := clientMsg.(type) {
	case *ProbabilisticHeader:
		return cs.verifyObservationOperation(ctx, cdc, clientStore, msg)
	case *Misbehaviour:
		return cs.verifyMisbehaviour(ctx, clientStore, cdc, msg)
	case *MithrilStakeCertificates:
		return cs.verifyMithrilStakeCertificates(ctx, msg)
	default:
		return ErrIBCInvalidClientType
	}
}

func checkedAddStake(current, addition uint64) (uint64, bool) {
	sum, carry := bits.Add64(current, addition, 0)
	return sum, carry == 0
}

func (cs *ClientState) computeSecurityScore(depth, qualifiedUniquePools, qualifiedUniqueStakeBps uint64) uint64 {
	depthScore := minBps(depth, DefaultThresholdDepth)
	poolsScore := minBps(qualifiedUniquePools, DefaultThresholdUniquePools)
	qualifiedStakeScore := minBps(qualifiedUniqueStakeBps, DefaultThresholdUniqueStakeBps)
	return min(
		(DefaultDepthWeightBps*depthScore+
			DefaultPoolsWeightBps*poolsScore+
			DefaultStakeWeightBps*qualifiedStakeScore)/10_000,
		10_000,
	)
}

func minBps(value, target uint64) uint64 {
	if target == 0 {
		return 10_000
	}
	if value >= target {
		return 10_000
	}

	// value is below target, so the quotient is below 10,000 and fits in
	// uint64. Div64 therefore receives a high word smaller than its divisor.
	high, low := bits.Mul64(value, 10_000)
	quotient, _ := bits.Div64(high, low, target)
	return quotient
}

func min(a, b uint64) uint64 {
	if a < b {
		return a
	}
	return b
}

func (cs *ClientState) UpdateState(ctx Context, cdc StateCodec, clientStore storetypes.KVStore, clientMsg any) []HeightValue {
	if err := cs.Validate(); err != nil {
		panic(err)
	}
	// Admission verifies custom misbehaviour without changing client state.
	// The keeper's verified misbehaviour path performs the freeze.
	if _, ok := clientMsg.(*Misbehaviour); ok {
		return nil
	}
	if msg, ok := clientMsg.(*MithrilStakeCertificates); ok {
		return cs.applyMithrilStakeCertificates(ctx, cdc, clientStore, msg)
	}
	header, ok := clientMsg.(*ProbabilisticHeader)
	if !ok || header.ObservationChunk == nil {
		panic("client update requires a verified observation operation")
	}
	return cs.consumeObservationResult(ctx, cdc, clientStore, header)
}

func (cs ClientState) UpdateStateOnMisbehaviour(ctx Context, cdc StateCodec, clientStore storetypes.KVStore, _ any) {
	cs.FrozenHeight = FrozenHeight
	if err := writeClientState(ctx, cdc, clientStore, &cs); err != nil {
		panic(err)
	}
}
