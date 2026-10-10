package state

import (
	"slices"
	"strings"

	errorsmod "cosmossdk.io/errors"
)

const completedProductionEpochs = 5
const completedProductionMask uint32 = (1 << completedProductionEpochs) - 1

func productionRecordMap(history *PoolProductionHistory, epoch uint64) (map[string]*PoolProductionRecord, error) {
	if history == nil {
		return nil, errorsmod.Wrap(ErrIBCInvalidClient, "pool production history is missing, authenticate history or supply an explicitly trusted bootstrap")
	}
	if history.Epoch != epoch {
		return nil, errorsmod.Wrap(ErrIBCInvalidClient, "pool production history epoch disagrees with checkpoint")
	}
	result := make(map[string]*PoolProductionRecord, len(history.Pools))
	for _, record := range history.Pools {
		if record == nil || record.PoolId == "" || record.PoolId != strings.ToLower(strings.TrimSpace(record.PoolId)) {
			return nil, errorsmod.Wrap(ErrIBCInvalidClient, "invalid production pool identity")
		}
		if _, duplicate := result[record.PoolId]; duplicate {
			return nil, errorsmod.Wrap(ErrIBCInvalidClient, "duplicate production pool identity")
		}
		if record.CompletedEpochsBitmap > completedProductionMask ||
			(epoch < completedProductionEpochs && record.CompletedEpochsBitmap>>epoch != 0) ||
			(record.CompletedEpochsBitmap == 0 && !record.ProducedCurrentEpoch) {
			return nil, errorsmod.Wrap(ErrIBCInvalidClient, "production bitmap must describe five preceding completed epochs, omit empty records")
		}
		copy := *record
		result[record.PoolId] = &copy
	}
	return result, nil
}

func clonePoolProduction(history *PoolProductionHistory) *PoolProductionHistory {
	if history == nil {
		return nil
	}
	copy := &PoolProductionHistory{Epoch: history.Epoch, Pools: make([]*PoolProductionRecord, len(history.Pools))}
	for i, record := range history.Pools {
		if record != nil {
			value := *record
			copy.Pools[i] = &value
		}
	}
	return copy
}

func poolProductionsEqual(a, b *PoolProductionHistory) bool {
	if a == nil || b == nil {
		return a == b
	}
	left, err := productionRecordMap(a, a.Epoch)
	if err != nil {
		return false
	}
	right, err := productionRecordMap(b, a.Epoch)
	if err != nil || len(left) != len(right) {
		return false
	}
	for pool, record := range left {
		other := right[pool]
		if other == nil || *record != *other {
			return false
		}
	}
	return true
}

func productionHistoryFromMap(epoch uint64, records map[string]*PoolProductionRecord) *PoolProductionHistory {
	pools := make([]string, 0, len(records))
	for pool := range records {
		pools = append(pools, pool)
	}
	slices.Sort(pools)
	history := &PoolProductionHistory{Epoch: epoch}
	for _, pool := range pools {
		record := *records[pool]
		history.Pools = append(history.Pools, &record)
	}
	return history
}

func advanceProductionEpoch(records map[string]*PoolProductionRecord, from, to uint64) error {
	if to < from {
		return errorsmod.Wrap(ErrInvalidCurrentEpoch, "production observation moves backwards in epoch")
	}
	distance := to - from
	if distance == 0 {
		return nil
	}
	for pool, record := range records {
		// Avoid shifts at or above the integer width. A current observation
		// survives exactly five rollovers, then expires at the sixth.
		bitmap := uint32(0)
		if distance <= completedProductionEpochs {
			bitmap = (record.CompletedEpochsBitmap << distance) & completedProductionMask
			if record.ProducedCurrentEpoch {
				bitmap |= 1 << (distance - 1)
			}
		}
		record.CompletedEpochsBitmap = bitmap
		record.ProducedCurrentEpoch = false
		if bitmap == 0 {
			delete(records, pool)
		}
	}
	return nil
}

// Derive only from blocks already authenticated by the native header verifier.
// Continuity and epoch checks run before this function. Descendants are deliberately
// excluded, they become observations only when a later committed anchor includes them.
func attachPoolProduction(header *authenticatedProbabilisticHeader, trusted *trustedBlockState) error {
	if trusted == nil || header == nil || header.anchorBlock == nil {
		return errorsmod.Wrap(ErrInvalidAcceptedBlock, "production checkpoint or anchor is missing")
	}
	records, err := productionRecordMap(trusted.poolProduction, trusted.epoch)
	if err != nil {
		return err
	}
	epoch := trusted.epoch
	apply := func(block *authenticatedProbabilisticBlock) error {
		if block == nil || block.slotLeader == "" {
			return errorsmod.Wrap(ErrInvalidAcceptedBlock, "authenticated production observation has no issuer")
		}
		if err := advanceProductionEpoch(records, epoch, block.epoch); err != nil {
			return err
		}
		epoch = block.epoch
		pool := strings.ToLower(block.slotLeader)
		record := records[pool]
		if record == nil {
			record = &PoolProductionRecord{PoolId: pool}
			records[pool] = record
		}
		record.ProducedCurrentEpoch = true
		return nil
	}
	for _, block := range header.bridgeBlocks {
		if err := apply(block); err != nil {
			return err
		}
	}
	if err := apply(header.anchorBlock); err != nil {
		return err
	}
	// The completed bits are frozen for settlement in this epoch. Current flags
	// include the anchor, but neither it nor descendants can qualify a pool now.
	header.anchorPoolProduction = productionHistoryFromMap(epoch, records)
	return nil
}
