package state

import (
	"bytes"
	"encoding/hex"
	"fmt"
	"slices"
	"strings"

	errorsmod "cosmossdk.io/errors"
)

// trustedBlockState is the authenticated Cardano block cursor used to verify
// continuity. It is deliberately separate from an IBC consensus state: a
// checkpoint has no HostState commitment root and cannot verify IBC proofs.
type trustedBlockState struct {
	nonceState                     *PraosNonceState
	poolRegistry                   *PoolRegistryState
	settlementCredit               *SettlementCreditState
	poolProduction                 *PoolProductionHistory
	height                         *Height
	blockHash                      string
	epoch                          uint64
	slot                           uint64
	timestamp                      uint64
	operationalCertificateCounters map[string]uint64
}

func normalizeOperationalCertificateCounters(counters []*OperationalCertificateCounter) ([]*OperationalCertificateCounter, error) {
	byPool := make(map[string]uint64, len(counters))
	for _, counter := range counters {
		if counter == nil {
			return nil, errorsmod.Wrap(ErrIBCInvalidClient, "operational certificate counter must not be nil")
		}
		if len(counter.PoolId) != 28 {
			return nil, errorsmod.Wrapf(
				ErrIBCInvalidClient,
				"operational certificate counter pool id must be 28 bytes, got %d",
				len(counter.PoolId),
			)
		}
		poolID := hex.EncodeToString(counter.PoolId)
		if _, exists := byPool[poolID]; exists {
			return nil, errorsmod.Wrapf(ErrIBCInvalidClient, "duplicate operational certificate counter for pool %s", poolID)
		}
		if counter.SequenceNumber == 0 {
			return nil, errorsmod.Wrapf(
				ErrIBCInvalidClient,
				"zero operational certificate counter for pool %s must be omitted",
				poolID,
			)
		}
		byPool[poolID] = counter.SequenceNumber
	}

	poolIDs := make([]string, 0, len(byPool))
	for poolID := range byPool {
		poolIDs = append(poolIDs, poolID)
	}
	slices.Sort(poolIDs)

	normalized := make([]*OperationalCertificateCounter, 0, len(poolIDs))
	for _, poolID := range poolIDs {
		poolIDBytes, err := hex.DecodeString(poolID)
		if err != nil {
			return nil, errorsmod.Wrapf(ErrIBCInvalidClient, "invalid operational certificate pool id %s", poolID)
		}
		normalized = append(normalized, &OperationalCertificateCounter{
			PoolId:         poolIDBytes,
			SequenceNumber: byPool[poolID],
		})
	}
	return normalized, nil
}

func operationalCertificateCounterMap(counters []*OperationalCertificateCounter) (map[string]uint64, error) {
	normalized, err := normalizeOperationalCertificateCounters(counters)
	if err != nil {
		return nil, err
	}
	result := make(map[string]uint64, len(normalized))
	for _, counter := range normalized {
		result[hex.EncodeToString(counter.PoolId)] = counter.SequenceNumber
	}
	return result, nil
}

func operationalCertificateCountersFromMap(counters map[string]uint64) []*OperationalCertificateCounter {
	poolIDs := make([]string, 0, len(counters))
	for poolID, sequenceNumber := range counters {
		if sequenceNumber > 0 {
			poolIDs = append(poolIDs, strings.ToLower(poolID))
		}
	}
	slices.Sort(poolIDs)

	result := make([]*OperationalCertificateCounter, 0, len(poolIDs))
	for _, poolID := range poolIDs {
		poolIDBytes, err := hex.DecodeString(poolID)
		if err != nil || len(poolIDBytes) != 28 {
			continue
		}
		result = append(result, &OperationalCertificateCounter{
			PoolId:         poolIDBytes,
			SequenceNumber: counters[poolID],
		})
	}
	return result
}

func cloneOperationalCertificateCounters(counters []*OperationalCertificateCounter) []*OperationalCertificateCounter {
	cloned := make([]*OperationalCertificateCounter, 0, len(counters))
	for _, counter := range counters {
		if counter == nil {
			continue
		}
		cloned = append(cloned, &OperationalCertificateCounter{
			PoolId:         bytes.Clone(counter.PoolId),
			SequenceNumber: counter.SequenceNumber,
		})
	}
	return cloned
}

func (cs *ClientState) setLatestCheckpoint(
	height *Height,
	blockHash string,
	epoch uint64,
	slot uint64,
	timestamp uint64,
) {
	cs.LatestCheckpointHeight = NewHeight(height.RevisionNumber, height.RevisionHeight)
	cs.LatestCheckpointBlockHash = blockHash
	cs.LatestCheckpointEpoch = epoch
	cs.LatestCheckpointSlot = slot
	cs.LatestCheckpointTimestamp = timestamp
}

func (cs ClientState) validateBootstrapCheckpoint() error {
	if _, err := normalizeOperationalCertificateCounters(cs.LatestCheckpointOperationalCertificateCounters); err != nil {
		return err
	}
	if cs.LatestHeight == nil || cs.LatestCheckpointHeight == nil || cs.LatestHeight.IsZero() || !cs.LatestCheckpointHeight.EQ(cs.LatestHeight) {
		return fmt.Errorf("trusted bootstrap requires a proof-bearing checkpoint")
	}
	if _, err := decodeBlockHash(cs.LatestCheckpointBlockHash); err != nil {
		return err
	}
	timestamp, err := cs.DeriveTimestampFromSlot(cs.LatestCheckpointSlot)
	if err != nil {
		return err
	}
	if timestamp != cs.LatestCheckpointTimestamp {
		return fmt.Errorf("trusted bootstrap timestamp does not match its slot")
	}
	return nil
}
