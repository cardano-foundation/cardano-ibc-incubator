package probabilistic

import (
	"bytes"
	"encoding/binary"
	"encoding/hex"
	"slices"
	"strings"

	errorsmod "cosmossdk.io/errors"
	storetypes "cosmossdk.io/store/types"
	"github.com/cosmos/cosmos-sdk/codec"
	clienttypes "github.com/cosmos/ibc-go/v10/modules/core/02-client/types"
	"github.com/cosmos/ibc-go/v10/modules/core/exported"
)

const operationalCertificateCounterRollbackEntrySize = 28 + 8

var operationalCertificateCounterHistoryPrefix = []byte("operationalCertificateCounterHistory/")

// trustedBlockState is the authenticated Cardano block cursor used to verify
// continuity. It is deliberately separate from an IBC consensus state: a
// checkpoint has no HostState commitment root and cannot verify IBC proofs.
type trustedBlockState struct {
	height                         *Height
	blockHash                      string
	epoch                          uint64
	operationalCertificateCounters map[string]uint64
}

func normalizeOperationalCertificateCounters(counters []*OperationalCertificateCounter) ([]*OperationalCertificateCounter, error) {
	byPool := make(map[string]uint64, len(counters))
	for _, counter := range counters {
		if counter == nil {
			return nil, errorsmod.Wrap(clienttypes.ErrInvalidClient, "operational certificate counter must not be nil")
		}
		if len(counter.PoolId) != 28 {
			return nil, errorsmod.Wrapf(
				clienttypes.ErrInvalidClient,
				"operational certificate counter pool id must be 28 bytes, got %d",
				len(counter.PoolId),
			)
		}
		poolID := hex.EncodeToString(counter.PoolId)
		if _, exists := byPool[poolID]; exists {
			return nil, errorsmod.Wrapf(clienttypes.ErrInvalidClient, "duplicate operational certificate counter for pool %s", poolID)
		}
		if counter.SequenceNumber == 0 {
			return nil, errorsmod.Wrapf(
				clienttypes.ErrInvalidClient,
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
			return nil, errorsmod.Wrapf(clienttypes.ErrInvalidClient, "invalid operational certificate pool id %s", poolID)
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

func operationalCertificateCounterHistoryKey(height *Height) []byte {
	key := make([]byte, 0, len(operationalCertificateCounterHistoryPrefix)+16)
	key = append(key, operationalCertificateCounterHistoryPrefix...)
	return append(key, bigEndianHeightBytes(height)...)
}

func operationalCertificateCounterHistoryHeight(key []byte) (*Height, error) {
	if len(key) != len(operationalCertificateCounterHistoryPrefix)+16 ||
		!bytes.HasPrefix(key, operationalCertificateCounterHistoryPrefix) {
		return nil, errorsmod.Wrap(clienttypes.ErrInvalidClient, "invalid operational certificate counter history key")
	}
	heightBytes := key[len(operationalCertificateCounterHistoryPrefix):]
	return NewHeight(
		binary.BigEndian.Uint64(heightBytes[:8]),
		binary.BigEndian.Uint64(heightBytes[8:]),
	), nil
}

func encodeOperationalCertificateCounterRollback(previousByPool map[string]uint64) ([]byte, error) {
	poolIDs := make([]string, 0, len(previousByPool))
	for poolID := range previousByPool {
		poolIDs = append(poolIDs, poolID)
	}
	slices.Sort(poolIDs)

	encoded := make([]byte, 0, len(poolIDs)*operationalCertificateCounterRollbackEntrySize)
	for _, poolID := range poolIDs {
		poolIDBytes, err := hex.DecodeString(poolID)
		if err != nil || len(poolIDBytes) != 28 {
			return nil, errorsmod.Wrapf(clienttypes.ErrInvalidClient, "invalid operational certificate pool id %s", poolID)
		}
		encoded = append(encoded, poolIDBytes...)
		encoded = binary.BigEndian.AppendUint64(encoded, previousByPool[poolID])
	}
	return encoded, nil
}

func applyOperationalCertificateCounterRollback(counters map[string]uint64, encoded []byte) error {
	if len(encoded) == 0 || len(encoded)%operationalCertificateCounterRollbackEntrySize != 0 {
		return errorsmod.Wrap(clienttypes.ErrInvalidClient, "invalid operational certificate counter rollback history")
	}
	previousPoolID := ""
	for offset := 0; offset < len(encoded); offset += operationalCertificateCounterRollbackEntrySize {
		poolIDBytes := encoded[offset : offset+28]
		poolID := hex.EncodeToString(poolIDBytes)
		if previousPoolID != "" && poolID <= previousPoolID {
			return errorsmod.Wrap(clienttypes.ErrInvalidClient, "operational certificate counter rollback entries must be unique and sorted")
		}
		previousPoolID = poolID
		previousSequenceNumber := binary.BigEndian.Uint64(
			encoded[offset+28 : offset+operationalCertificateCounterRollbackEntrySize],
		)
		currentSequenceNumber := counters[poolID]
		if currentSequenceNumber <= previousSequenceNumber {
			return errorsmod.Wrapf(
				clienttypes.ErrInvalidClient,
				"invalid operational certificate counter rollback for pool %s: current %d, previous %d",
				poolID,
				currentSequenceNumber,
				previousSequenceNumber,
			)
		}
		if previousSequenceNumber == 0 {
			delete(counters, poolID)
		} else {
			counters[poolID] = previousSequenceNumber
		}
	}
	return nil
}

func clearOperationalCertificateCounterHistory(clientStore storetypes.KVStore) error {
	iterator := storetypes.KVStorePrefixIterator(clientStore, operationalCertificateCounterHistoryPrefix)
	keys := make([][]byte, 0)
	for ; iterator.Valid(); iterator.Next() {
		keys = append(keys, bytes.Clone(iterator.Key()))
	}
	if err := iterator.Close(); err != nil {
		return errorsmod.Wrap(err, "failed to close operational certificate counter history iterator")
	}
	for _, key := range keys {
		clientStore.Delete(key)
	}
	return nil
}

func (cs *ClientState) compactOperationalCertificateCounterHistory(
	clientStore storetypes.KVStore,
	cdc codec.BinaryCodec,
) error {
	var oldestConsensusHeight *Height
	IterateConsensusStateAscending(clientStore, func(height exported.Height) bool {
		_, found := GetConsensusState(clientStore, cdc, height)
		if found {
			oldestConsensusHeight = NewHeight(height.GetRevisionNumber(), height.GetRevisionHeight())
			return true
		}
		return false
	})
	if oldestConsensusHeight == nil ||
		cs.OperationalCertificateCounterHistoryStartHeight == nil ||
		!oldestConsensusHeight.GT(cs.OperationalCertificateCounterHistoryStartHeight) {
		return nil
	}

	iterator := storetypes.KVStorePrefixIterator(clientStore, operationalCertificateCounterHistoryPrefix)
	keys := make([][]byte, 0)
	for ; iterator.Valid(); iterator.Next() {
		height, err := operationalCertificateCounterHistoryHeight(iterator.Key())
		if err != nil {
			_ = iterator.Close()
			return err
		}
		if height.LTE(oldestConsensusHeight) {
			keys = append(keys, bytes.Clone(iterator.Key()))
		}
	}
	if err := iterator.Close(); err != nil {
		return errorsmod.Wrap(err, "failed to close operational certificate counter history iterator")
	}
	for _, key := range keys {
		clientStore.Delete(key)
	}
	cs.OperationalCertificateCounterHistoryStartHeight = oldestConsensusHeight
	return nil
}

func (cs *ClientState) persistOperationalCertificateCounterSnapshot(
	clientStore storetypes.KVStore,
	height *Height,
	counters []*OperationalCertificateCounter,
) error {
	if height == nil || height.IsZero() {
		return errorsmod.Wrap(ErrInvalidHeaderHeight, "operational certificate counter snapshot height must be present")
	}
	currentHeight := cs.LatestCheckpointHeight
	if currentHeight == nil || currentHeight.IsZero() {
		currentHeight = cs.LatestHeight
	}
	if currentHeight == nil || currentHeight.IsZero() || !height.GT(currentHeight) {
		return errorsmod.Wrapf(
			ErrInvalidHeaderHeight,
			"operational certificate counter snapshot height %s must be newer than checkpoint %s",
			height.String(),
			currentHeight,
		)
	}
	current, err := operationalCertificateCounterMap(cs.LatestCheckpointOperationalCertificateCounters)
	if err != nil {
		return err
	}
	next, err := operationalCertificateCounterMap(counters)
	if err != nil {
		return err
	}

	previousByPool := make(map[string]uint64)
	for poolID, previousSequenceNumber := range current {
		nextSequenceNumber, exists := next[poolID]
		if !exists || nextSequenceNumber < previousSequenceNumber {
			return errorsmod.Wrapf(
				clienttypes.ErrInvalidClient,
				"operational certificate counter for pool %s decreased from %d to %d",
				poolID,
				previousSequenceNumber,
				nextSequenceNumber,
			)
		}
		if nextSequenceNumber > previousSequenceNumber {
			previousByPool[poolID] = previousSequenceNumber
		}
	}
	for poolID, nextSequenceNumber := range next {
		if _, exists := current[poolID]; !exists {
			if nextSequenceNumber == 0 {
				continue
			}
			previousByPool[poolID] = 0
		}
	}

	if len(previousByPool) > 0 {
		key := operationalCertificateCounterHistoryKey(height)
		if len(clientStore.Get(key)) != 0 {
			return errorsmod.Wrapf(clienttypes.ErrInvalidClient, "operational certificate counter history already exists at height %s", height.String())
		}
		encoded, err := encodeOperationalCertificateCounterRollback(previousByPool)
		if err != nil {
			return err
		}
		clientStore.Set(key, encoded)
	}
	cs.LatestCheckpointOperationalCertificateCounters = operationalCertificateCountersFromMap(next)
	return nil
}

func (cs ClientState) operationalCertificateCounterMapAtHeight(
	clientStore storetypes.KVStore,
	height *Height,
) (map[string]uint64, error) {
	if height == nil || height.IsZero() {
		return nil, errorsmod.Wrap(ErrInvalidHeaderHeight, "operational certificate counter history height must be present")
	}
	if cs.OperationalCertificateCounterHistoryStartHeight == nil ||
		cs.OperationalCertificateCounterHistoryStartHeight.IsZero() ||
		height.LT(cs.OperationalCertificateCounterHistoryStartHeight) {
		return nil, errorsmod.Wrapf(
			clienttypes.ErrInvalidConsensus,
			"operational certificate counter history is unavailable at height %s",
			height.String(),
		)
	}
	latestCounterHeight := cs.LatestCheckpointHeight
	if latestCounterHeight == nil || latestCounterHeight.IsZero() {
		latestCounterHeight = cs.LatestHeight
	}
	if latestCounterHeight == nil || height.GT(latestCounterHeight) {
		return nil, errorsmod.Wrapf(clienttypes.ErrInvalidConsensus, "operational certificate counter history does not reach height %s", height.String())
	}
	counters, err := operationalCertificateCounterMap(cs.LatestCheckpointOperationalCertificateCounters)
	if err != nil {
		return nil, err
	}

	if height.EQ(latestCounterHeight) {
		return counters, nil
	}
	startKey := operationalCertificateCounterHistoryKey(height)
	endKey := append(operationalCertificateCounterHistoryKey(latestCounterHeight), 0)
	iterator := clientStore.ReverseIterator(startKey, endKey)
	defer iterator.Close()
	for ; iterator.Valid(); iterator.Next() {
		batchHeight, err := operationalCertificateCounterHistoryHeight(iterator.Key())
		if err != nil {
			return nil, err
		}
		if !batchHeight.GT(cs.OperationalCertificateCounterHistoryStartHeight) ||
			batchHeight.GT(latestCounterHeight) {
			return nil, errorsmod.Wrapf(
				clienttypes.ErrInvalidClient,
				"operational certificate counter rollback height %s is outside retained history",
				batchHeight.String(),
			)
		}
		if batchHeight.GT(height) {
			if err := applyOperationalCertificateCounterRollback(counters, iterator.Value()); err != nil {
				return nil, errorsmod.Wrapf(err, "at height %s", batchHeight.String())
			}
		}
	}
	return counters, nil
}

func (cs ClientState) validateCheckpointFields() error {
	if _, err := normalizeOperationalCertificateCounters(cs.LatestCheckpointOperationalCertificateCounters); err != nil {
		return err
	}
	if cs.OperationalCertificateCounterHistoryStartHeight == nil ||
		cs.OperationalCertificateCounterHistoryStartHeight.IsZero() {
		return errorsmod.Wrap(clienttypes.ErrInvalidClient, "operational certificate counter history start height must be present")
	}
	if cs.LatestCheckpointHeight == nil || cs.LatestCheckpointHeight.IsZero() {
		if cs.LatestCheckpointBlockHash != "" || cs.LatestCheckpointEpoch != 0 {
			return errorsmod.Wrap(ErrInvalidHeaderHeight, "checkpoint hash and epoch require a checkpoint height")
		}
		if cs.LatestHeight == nil || cs.LatestHeight.IsZero() {
			return errorsmod.Wrap(ErrInvalidHeaderHeight, "latest height must be present")
		}
		if cs.OperationalCertificateCounterHistoryStartHeight.GT(cs.LatestHeight) {
			return errorsmod.Wrap(ErrInvalidHeaderHeight, "operational certificate counter history cannot start after the latest height")
		}
		return nil
	}
	if cs.LatestHeight == nil || cs.LatestHeight.IsZero() {
		return errorsmod.Wrap(ErrInvalidHeaderHeight, "latest height must be present when checkpoint height is set")
	}
	if cs.LatestCheckpointHeight.LT(cs.LatestHeight) {
		return errorsmod.Wrapf(
			ErrInvalidHeaderHeight,
			"checkpoint height %s cannot be older than latest consensus height %s",
			cs.LatestCheckpointHeight.String(),
			cs.LatestHeight.String(),
		)
	}
	if strings.TrimSpace(cs.LatestCheckpointBlockHash) == "" {
		return errorsmod.Wrap(ErrInvalidAcceptedBlock, "checkpoint block hash cannot be empty")
	}
	if cs.OperationalCertificateCounterHistoryStartHeight.GT(cs.LatestCheckpointHeight) {
		return errorsmod.Wrap(ErrInvalidHeaderHeight, "operational certificate counter history cannot start after the latest checkpoint")
	}
	return nil
}

func (cs *ClientState) latestTrustedBlockState(
	clientStore storetypes.KVStore,
	cdc codec.BinaryCodec,
) (*trustedBlockState, error) {
	if err := cs.validateCheckpointFields(); err != nil {
		return nil, err
	}
	if cs.LatestCheckpointHeight != nil && !cs.LatestCheckpointHeight.IsZero() {
		return cs.trustedBlockStateAtHeight(clientStore, cdc, cs.LatestCheckpointHeight)
	}
	return cs.trustedBlockStateAtHeight(clientStore, cdc, cs.LatestHeight)
}

func (cs *ClientState) trustedBlockStateAtHeight(
	clientStore storetypes.KVStore,
	cdc codec.BinaryCodec,
	height *Height,
) (*trustedBlockState, error) {
	if height == nil || height.IsZero() {
		return nil, errorsmod.Wrap(ErrInvalidHeaderHeight, "trusted height must be present")
	}
	if cs.LatestCheckpointHeight != nil &&
		!cs.LatestCheckpointHeight.IsZero() &&
		height.EQ(cs.LatestCheckpointHeight) {
		counters, err := cs.operationalCertificateCounterMapAtHeight(clientStore, height)
		if err != nil {
			return nil, err
		}
		state := &trustedBlockState{
			height:                         NewHeight(height.RevisionNumber, height.RevisionHeight),
			blockHash:                      cs.LatestCheckpointBlockHash,
			epoch:                          cs.LatestCheckpointEpoch,
			operationalCertificateCounters: counters,
		}
		if cs.LatestHeight != nil && height.EQ(cs.LatestHeight) {
			consensusState, found := GetConsensusState(clientStore, cdc, height)
			if !found {
				return nil, errorsmod.Wrapf(clienttypes.ErrConsensusStateNotFound, "height (%s)", height.String())
			}
			if !strings.EqualFold(state.blockHash, consensusState.AcceptedBlockHash) ||
				state.epoch != consensusState.AcceptedEpoch {
				return nil, errorsmod.Wrap(
					ErrInvalidAcceptedBlock,
					"checkpoint cursor at latest consensus height does not match the stored consensus state",
				)
			}
		}
		return state, nil
	}

	consensusState, found := GetConsensusState(clientStore, cdc, height)
	if !found {
		return nil, errorsmod.Wrapf(
			clienttypes.ErrConsensusStateNotFound,
			"trusted consensus state not found at height %s",
			height.String(),
		)
	}
	counters, err := cs.operationalCertificateCounterMapAtHeight(clientStore, height)
	if err != nil {
		return nil, err
	}
	return &trustedBlockState{
		height:                         NewHeight(height.RevisionNumber, height.RevisionHeight),
		blockHash:                      consensusState.AcceptedBlockHash,
		epoch:                          consensusState.AcceptedEpoch,
		operationalCertificateCounters: counters,
	}, nil
}

func (cs *ClientState) setLatestCheckpoint(height *Height, blockHash string, epoch uint64) {
	cs.LatestCheckpointHeight = NewHeight(height.RevisionNumber, height.RevisionHeight)
	cs.LatestCheckpointBlockHash = blockHash
	cs.LatestCheckpointEpoch = epoch
}

func (cs *ClientState) initializeCheckpoint(consensusState *ConsensusState) error {
	if consensusState == nil {
		return errorsmod.Wrap(clienttypes.ErrInvalidConsensus, "initial consensus state is missing")
	}
	clientCounters, err := normalizeOperationalCertificateCounters(cs.LatestCheckpointOperationalCertificateCounters)
	if err != nil {
		return err
	}
	cs.LatestCheckpointOperationalCertificateCounters = clientCounters
	if cs.OperationalCertificateCounterHistoryStartHeight == nil ||
		!cs.OperationalCertificateCounterHistoryStartHeight.EQ(cs.LatestHeight) {
		return errorsmod.Wrap(
			clienttypes.ErrInvalidClient,
			"initial operational certificate counter history must start at the initial client height",
		)
	}
	if cs.LatestCheckpointHeight == nil || cs.LatestCheckpointHeight.IsZero() {
		cs.setLatestCheckpoint(cs.LatestHeight, consensusState.AcceptedBlockHash, consensusState.AcceptedEpoch)
		return nil
	}
	if !cs.LatestCheckpointHeight.EQ(cs.LatestHeight) ||
		!strings.EqualFold(cs.LatestCheckpointBlockHash, consensusState.AcceptedBlockHash) ||
		cs.LatestCheckpointEpoch != consensusState.AcceptedEpoch {
		return errorsmod.Wrap(
			clienttypes.ErrInvalidClient,
			"initial checkpoint cursor must match the initial consensus state",
		)
	}
	return nil
}

func (cs *ClientState) persistCheckpoint(
	clientStore storetypes.KVStore,
	cdc codec.BinaryCodec,
	epochContexts []*EpochContext,
	authenticatedHeader *authenticatedProbabilisticHeader,
) error {
	if authenticatedHeader == nil || authenticatedHeader.anchorBlock == nil {
		return errorsmod.Wrap(ErrInvalidAcceptedBlock, "authenticated checkpoint anchor is missing")
	}

	anchor := authenticatedHeader.anchorBlock
	keepEpochs := collectReferencedConsensusEpochs(clientStore, cdc)
	keepEpochs[anchor.epoch] = struct{}{}
	retainedEpochContexts := retainEpochContexts(epochContexts, keepEpochs)
	if err := syncCurrentEpochFields(cs, retainedEpochContexts, anchor.epoch); err != nil {
		return err
	}
	anchorHeight := NewHeight(0, anchor.height)
	if err := cs.persistOperationalCertificateCounterSnapshot(
		clientStore,
		anchorHeight,
		authenticatedHeader.anchorOperationalCertificateCounters,
	); err != nil {
		return err
	}
	cs.setLatestCheckpoint(anchorHeight, anchor.hash, anchor.epoch)
	setClientState(clientStore, cdc, cs)
	return nil
}
