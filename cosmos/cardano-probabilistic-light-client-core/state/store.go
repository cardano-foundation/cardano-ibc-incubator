package state

import (
	"bytes"
	"encoding/binary"
	"fmt"

	"cosmossdk.io/store/prefix"
	storetypes "cosmossdk.io/store/types"
)

const KeyIterateConsensusStatePrefix = "iterateConsensusStates"

var (
	KeyProcessedTime   = []byte("/processedTime")
	KeyProcessedHeight = []byte("/processedHeight")
	KeyIteration       = []byte("/iterationKey")
)

func SetClientState(clientStore storetypes.KVStore, cdc StateCodec, clientState *ClientState) {
	key := []byte("clientState")
	val := cdc.EncodeClient(clientState)
	clientStore.Set(key, val)
}

func GetClientState(store storetypes.KVStore, cdc StateCodec) (*ClientState, bool) {
	bz := store.Get([]byte("clientState"))
	if len(bz) == 0 {
		return nil, false
	}

	return cdc.DecodeClient(bz), true
}

func SetConsensusState(clientStore storetypes.KVStore, cdc StateCodec, consensusState *ConsensusState, height HeightValue) {
	key := consensusStateKey(height)
	val := cdc.EncodeConsensus(consensusState)
	clientStore.Set(key, val)
}

func GetConsensusState(store storetypes.KVStore, cdc StateCodec, height HeightValue) (*ConsensusState, bool) {
	bz := store.Get(consensusStateKey(height))
	if len(bz) == 0 {
		return nil, false
	}
	consensusStateI := mustDecodeConsensus(cdc, bz)
	return consensusStateI, true
}

func deleteConsensusState(clientStore storetypes.KVStore, height HeightValue) {
	clientStore.Delete(consensusStateKey(height))
}

func ProcessedTimeKey(height HeightValue) []byte {
	return append(consensusStateKey(height), KeyProcessedTime...)
}

func SetProcessedTime(clientStore storetypes.KVStore, height HeightValue, timeNs uint64) {
	clientStore.Set(ProcessedTimeKey(height), uint64ToBigEndian(timeNs))
}

func GetProcessedTime(clientStore storetypes.KVStore, height HeightValue) (uint64, bool) {
	bz := clientStore.Get(ProcessedTimeKey(height))
	if len(bz) == 0 {
		return 0, false
	}
	return binary.BigEndian.Uint64(bz), true
}

func deleteProcessedTime(clientStore storetypes.KVStore, height HeightValue) {
	clientStore.Delete(ProcessedTimeKey(height))
}

func ProcessedHeightKey(height HeightValue) []byte {
	return append(consensusStateKey(height), KeyProcessedHeight...)
}

func SetProcessedHeight(clientStore storetypes.KVStore, consHeight, processedHeight HeightValue) {
	clientStore.Set(ProcessedHeightKey(consHeight), []byte(processedHeight.String()))
}

func GetProcessedHeight(clientStore storetypes.KVStore, height HeightValue) (HeightValue, bool) {
	bz := clientStore.Get(ProcessedHeightKey(height))
	if len(bz) == 0 {
		return nil, false
	}
	processedHeight, err := parseHostHeight(string(bz))
	if err != nil {
		return nil, false
	}
	return processedHeight, true
}

func deleteProcessedHeight(clientStore storetypes.KVStore, height HeightValue) {
	clientStore.Delete(ProcessedHeightKey(height))
}

func IterationKey(height HeightValue) []byte {
	heightBytes := bigEndianHeightBytes(height)
	return append([]byte(KeyIterateConsensusStatePrefix), heightBytes...)
}

func SetIterationKey(clientStore storetypes.KVStore, height HeightValue) {
	clientStore.Set(IterationKey(height), consensusStateKey(height))
}

func deleteIterationKey(clientStore storetypes.KVStore, height HeightValue) {
	clientStore.Delete(IterationKey(height))
}

func GetHeightFromIterationKey(iterKey []byte) HeightValue {
	bigEndianBytes := iterKey[len([]byte(KeyIterateConsensusStatePrefix)):]
	revisionBytes := bigEndianBytes[0:8]
	heightBytes := bigEndianBytes[8:]
	revision := binary.BigEndian.Uint64(revisionBytes)
	height := binary.BigEndian.Uint64(heightBytes)
	return NewHostHeight(revision, height)
}

func IterateConsensusStateAscending(clientStore storetypes.KVStore, cb func(height HeightValue) (stop bool)) {
	iterator := storetypes.KVStorePrefixIterator(clientStore, []byte(KeyIterateConsensusStatePrefix))
	defer iterator.Close()
	for ; iterator.Valid(); iterator.Next() {
		height := GetHeightFromIterationKey(iterator.Key())
		if cb(height) {
			break
		}
	}
}

func GetNextConsensusState(clientStore storetypes.KVStore, cdc StateCodec, height HeightValue) (*ConsensusState, bool) {
	iterateStore := prefix.NewStore(clientStore, []byte(KeyIterateConsensusStatePrefix))
	iterator := iterateStore.Iterator(bigEndianHeightBytes(height), nil)
	defer iterator.Close()
	if !iterator.Valid() {
		return nil, false
	}
	if bytes.Equal(iterator.Value(), consensusStateKey(height)) {
		iterator.Next()
		if !iterator.Valid() {
			return nil, false
		}
	}
	return getProbabilisticConsensusState(clientStore, cdc, iterator.Value())
}

func GetPreviousConsensusState(clientStore storetypes.KVStore, cdc StateCodec, height HeightValue) (*ConsensusState, bool) {
	iterateStore := prefix.NewStore(clientStore, []byte(KeyIterateConsensusStatePrefix))
	iterator := iterateStore.ReverseIterator(nil, bigEndianHeightBytes(height))
	defer iterator.Close()
	if !iterator.Valid() {
		return nil, false
	}
	return getProbabilisticConsensusState(clientStore, cdc, iterator.Value())
}

func getProbabilisticConsensusState(clientStore storetypes.KVStore, cdc StateCodec, key []byte) (*ConsensusState, bool) {
	bz := clientStore.Get(key)
	if len(bz) == 0 {
		return nil, false
	}
	consensusStateI, err := cdc.DecodeConsensus(bz)
	if err != nil {
		return nil, false
	}
	consensusState, ok := consensusStateI, consensusStateI != nil
	if !ok {
		return nil, false
	}
	return consensusState, true
}

func bigEndianHeightBytes(height HeightValue) []byte {
	heightBytes := make([]byte, 16)
	binary.BigEndian.PutUint64(heightBytes[:8], height.GetRevisionNumber())
	binary.BigEndian.PutUint64(heightBytes[8:], height.GetRevisionHeight())
	return heightBytes
}

func consensusStateKey(height HeightValue) []byte {
	return fmt.Appendf(nil, "%s/%d-%d", "consensusStates", height.GetRevisionNumber(), height.GetRevisionHeight())
}

func setConsensusMetadata(ctx Context, clientStore storetypes.KVStore, height HeightValue) {
	SetConsensusMetadataWithValues(clientStore, height, ctx.SelfHeight, uint64(ctx.BlockTime().UnixNano()))
}

func SetConsensusMetadataWithValues(clientStore storetypes.KVStore, height, processedHeight HeightValue, processedTime uint64) {
	SetProcessedTime(clientStore, height, processedTime)
	SetProcessedHeight(clientStore, height, processedHeight)
	SetIterationKey(clientStore, height)
}

func deleteConsensusMetadata(clientStore storetypes.KVStore, height HeightValue) {
	deleteProcessedTime(clientStore, height)
	deleteProcessedHeight(clientStore, height)
	deleteIterationKey(clientStore, height)
}
