package state

import (
	"bytes"
	"fmt"
	"math"
	"math/big"
	"slices"
	"strings"

	errorsmod "cosmossdk.io/errors"
)

// An experimental allowance, not an authenticated bound on changes in stake.
const DefaultAdditionalSettlementCreditBps uint64 = 50

// Native stake totals fit uint64. Adding 1/200 to a reduced share needs at
// most 72 bits. The bound also limits work when decoding bootstrap state.
const maxSettlementCreditIntegerBytes = 16

func settlementCreditMap(entries []*PoolSettlementCredit) (map[string]*big.Rat, error) {
	result := make(map[string]*big.Rat, len(entries))
	total := new(big.Rat)
	for _, entry := range entries {
		if entry == nil || entry.PoolId == "" || entry.PoolId != strings.ToLower(strings.TrimSpace(entry.PoolId)) {
			return nil, errorsmod.Wrap(ErrIBCInvalidClient, "invalid settlement credit pool identity")
		}
		if _, exists := result[entry.PoolId]; exists {
			return nil, errorsmod.Wrap(ErrIBCInvalidClient, "duplicate settlement credit pool identity")
		}
		for _, integer := range [][]byte{entry.Numerator, entry.Denominator} {
			if len(integer) == 0 || len(integer) > maxSettlementCreditIntegerBytes || integer[0] == 0 {
				return nil, errorsmod.Wrap(ErrIBCInvalidClient, "settlement credit must use bounded canonical positive integers")
			}
		}
		numerator := new(big.Int).SetBytes(entry.Numerator)
		denominator := new(big.Int).SetBytes(entry.Denominator)
		value := new(big.Rat).SetFrac(numerator, denominator)
		if value.Cmp(big.NewRat(1, 1)) > 0 || !bytes.Equal(value.Num().Bytes(), entry.Numerator) || !bytes.Equal(value.Denom().Bytes(), entry.Denominator) {
			return nil, errorsmod.Wrap(ErrIBCInvalidClient, "settlement credit must be a reduced share at most one")
		}
		result[entry.PoolId] = value
		total.Add(total, value)
	}
	if total.Cmp(big.NewRat(1, 1)) > 0 {
		return nil, errorsmod.Wrap(ErrIBCInvalidClient, "settlement reference shares exceed one")
	}
	return result, nil
}

func validateSettlementCredit(s *SettlementCreditState, epoch uint64) error {
	if s == nil {
		return errorsmod.Wrap(ErrIBCInvalidClient, "settlement credit reference is missing, bootstrap or authenticated migration must supply it")
	}
	if s.Epoch != epoch {
		return errorsmod.Wrap(ErrIBCInvalidClient, "settlement credit reference epoch disagrees with checkpoint")
	}
	_, err := settlementCreditMap(s.Reference)
	return err
}

func cloneSettlementCredit(s *SettlementCreditState) *SettlementCreditState {
	if s == nil {
		return nil
	}
	copy := &SettlementCreditState{Epoch: s.Epoch, Reference: make([]*PoolSettlementCredit, len(s.Reference))}
	for i, entry := range s.Reference {
		if entry != nil {
			copy.Reference[i] = &PoolSettlementCredit{PoolId: entry.PoolId, Numerator: bytes.Clone(entry.Numerator), Denominator: bytes.Clone(entry.Denominator)}
		}
	}
	return copy
}

func settlementCreditsEqual(a, b *SettlementCreditState) bool {
	if a == nil || b == nil {
		return a == b
	}
	if a.Epoch != b.Epoch {
		return false
	}
	left, err := settlementCreditMap(a.Reference)
	if err != nil {
		return false
	}
	right, err := settlementCreditMap(b.Reference)
	if err != nil || len(left) != len(right) {
		return false
	}
	for pool, credit := range left {
		other := right[pool]
		if other == nil || credit.Cmp(other) != 0 {
			return false
		}
	}
	return true
}

func creditsFromMap(values map[string]*big.Rat) []*PoolSettlementCredit {
	pools := make([]string, 0, len(values))
	for pool, credit := range values {
		if credit.Sign() > 0 {
			pools = append(pools, pool)
		}
	}
	slices.Sort(pools)
	result := make([]*PoolSettlementCredit, 0, len(pools))
	for _, pool := range pools {
		credit := values[pool]
		result = append(result, &PoolSettlementCredit{PoolId: pool, Numerator: credit.Num().Bytes(), Denominator: credit.Denom().Bytes()})
	}
	return result
}

// currentSettlementCredits preserves exact fractions until the aggregate is
// converted to basis points. It never redistributes discounted credit.
func currentSettlementCredits(s *SettlementCreditState, context *EpochContext) (map[string]*big.Rat, error) {
	if context == nil {
		return nil, errorsmod.Wrap(ErrInvalidCurrentEpoch, "settlement epoch context is missing")
	}
	if err := validateSettlementCredit(s, context.Epoch); err != nil {
		return nil, err
	}
	reference, _ := settlementCreditMap(s.Reference)
	total := uint64(0)
	seen := make(map[string]bool)
	for _, entry := range context.StakeDistribution {
		if entry == nil || strings.TrimSpace(entry.PoolId) == "" || seen[strings.ToLower(entry.PoolId)] {
			return nil, errorsmod.Wrap(ErrInvalidCurrentEpoch, "invalid or duplicate pool in settlement stake table")
		}
		seen[strings.ToLower(entry.PoolId)] = true
		var ok bool
		total, ok = checkedAddStake(total, entry.Stake)
		if !ok {
			return nil, errorsmod.Wrap(ErrInvalidCurrentEpoch, "stake distribution total overflows uint64")
		}
	}
	if total == 0 {
		return nil, errorsmod.Wrap(ErrInvalidCurrentEpoch, "stake distribution must have positive total stake")
	}
	allowance := new(big.Rat).SetFrac(new(big.Int).SetUint64(DefaultAdditionalSettlementCreditBps), big.NewInt(10_000))
	result := make(map[string]*big.Rat, len(context.StakeDistribution))
	for _, entry := range context.StakeDistribution {
		pool := strings.ToLower(entry.PoolId)
		share := new(big.Rat).SetFrac(new(big.Int).SetUint64(entry.Stake), new(big.Int).SetUint64(total))
		cap := new(big.Rat).Set(allowance)
		if old := reference[pool]; old != nil {
			cap.Add(cap, old)
		}
		if share.Cmp(cap) > 0 {
			share.Set(cap)
		}
		result[pool] = share
	}
	return result, nil
}

func bootstrapSettlementCredit(context *EpochContext) (*SettlementCreditState, error) {
	if context == nil {
		return nil, fmt.Errorf("bootstrap stake context is missing")
	}
	zero := &SettlementCreditState{Epoch: context.Epoch}
	// Bootstrap receives the complete explicitly trusted distribution. This is
	// the only ordinary initialization of an undiscounted reference.
	var total uint64
	seen := make(map[string]bool)
	for _, entry := range context.StakeDistribution {
		if entry == nil || strings.TrimSpace(entry.PoolId) == "" || seen[strings.ToLower(entry.PoolId)] {
			return nil, fmt.Errorf("invalid or duplicate bootstrap stake entry")
		}
		seen[strings.ToLower(entry.PoolId)] = true
		var ok bool
		total, ok = checkedAddStake(total, entry.Stake)
		if !ok {
			return nil, fmt.Errorf("bootstrap stake total overflows uint64")
		}
	}
	if total == 0 {
		return nil, fmt.Errorf("bootstrap stake total is zero")
	}
	values := make(map[string]*big.Rat)
	for _, entry := range context.StakeDistribution {
		values[strings.ToLower(entry.PoolId)] = new(big.Rat).SetFrac(new(big.Int).SetUint64(entry.Stake), new(big.Int).SetUint64(total))
	}
	zero.Reference = creditsFromMap(values)
	return zero, validateSettlementCredit(zero, context.Epoch)
}

func advanceSettlementCredit(trusted *trustedBlockState, contexts []*EpochContext, epoch uint64) (*SettlementCreditState, error) {
	if trusted == nil {
		return nil, errorsmod.Wrap(ErrIBCInvalidClient, "settlement trusted checkpoint is missing")
	}
	if err := validateSettlementCredit(trusted.settlementCredit, trusted.epoch); err != nil {
		return nil, err
	}
	if epoch == trusted.epoch {
		return cloneSettlementCredit(trusted.settlementCredit), nil
	}
	if trusted.epoch == math.MaxUint64 || epoch != trusted.epoch+1 {
		return nil, errorsmod.Wrap(ErrInvalidCurrentEpoch, "settlement reference advances only at an adjacent epoch transition")
	}
	// Advance all pool references using their old capped credit. Neither a raw
	// table claim nor another update within the same epoch grants an allowance.
	credits, err := currentSettlementCredits(trusted.settlementCredit, epochContextByEpoch(contexts, trusted.epoch))
	if err != nil {
		return nil, err
	}
	result := &SettlementCreditState{Epoch: epoch, Reference: creditsFromMap(credits)}
	return result, validateSettlementCredit(result, epoch)
}

func attachSettlementCredit(header *authenticatedProbabilisticHeader, trusted *trustedBlockState, contexts []*EpochContext) error {
	credit, err := advanceSettlementCredit(trusted, contexts, header.anchorBlock.epoch)
	if err != nil {
		return err
	}
	header.anchorSettlementCredit = credit
	return nil
}

func settlementCreditBps(credit *big.Rat) uint64 {
	scaled := new(big.Rat).Mul(credit, big.NewRat(10_000, 1))
	return new(big.Int).Quo(scaled.Num(), scaled.Denom()).Uint64()
}
