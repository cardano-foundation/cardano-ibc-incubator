package stability

import (
	"bytes"
	"encoding/binary"
	"fmt"
	"strings"

	"cosmossdk.io/store/prefix"
	storetypes "cosmossdk.io/store/types"
	"github.com/cosmos/cosmos-sdk/codec"
	sdk "github.com/cosmos/cosmos-sdk/types"
	clienttypes "github.com/cosmos/ibc-go/v10/modules/core/02-client/types"
	host "github.com/cosmos/ibc-go/v10/modules/core/24-host"
	"github.com/cosmos/ibc-go/v10/modules/core/exported"
)

const KeyIterateConsensusStatePrefix = "iterateConsensusStates"

var (
	KeyProcessedTime   = []byte("/processedTime")
	KeyProcessedHeight = []byte("/processedHeight")
	KeyIteration       = []byte("/iterationKey")
)

func setClientState(clientStore storetypes.KVStore, cdc codec.BinaryCodec, clientState *ClientState) {
	key := host.ClientStateKey()
	val := clienttypes.MustMarshalClientState(cdc, clientState)
	clientStore.Set(key, val)
}

func getClientState(store storetypes.KVStore, cdc codec.BinaryCodec) (*ClientState, bool) {
	bz := store.Get(host.ClientStateKey())
	if len(bz) == 0 {
		return nil, false
	}

	clientStateI := clienttypes.MustUnmarshalClientState(cdc, bz)
	clientState, ok := clientStateI.(*ClientState)
	if !ok {
		panic(fmt.Errorf("cannot convert %T to %T", clientStateI, clientState))
	}
	return clientState, true
}

func setConsensusState(clientStore storetypes.KVStore, cdc codec.BinaryCodec, consensusState *ConsensusState, height exported.Height) {
	key := host.ConsensusStateKey(height)
	val := clienttypes.MustMarshalConsensusState(cdc, consensusState)
	clientStore.Set(key, val)
}

func GetConsensusState(store storetypes.KVStore, cdc codec.BinaryCodec, height exported.Height) (*ConsensusState, bool) {
	bz := store.Get(host.ConsensusStateKey(height))
	if len(bz) == 0 {
		return nil, false
	}
	consensusStateI := clienttypes.MustUnmarshalConsensusState(cdc, bz)
	return consensusStateI.(*ConsensusState), true
}

func deleteConsensusState(clientStore storetypes.KVStore, height exported.Height) {
	clientStore.Delete(host.ConsensusStateKey(height))
}

func ProcessedTimeKey(height exported.Height) []byte {
	return append(host.ConsensusStateKey(height), KeyProcessedTime...)
}

func SetProcessedTime(clientStore storetypes.KVStore, height exported.Height, timeNs uint64) {
	clientStore.Set(ProcessedTimeKey(height), sdk.Uint64ToBigEndian(timeNs))
}

func GetProcessedTime(clientStore storetypes.KVStore, height exported.Height) (uint64, bool) {
	bz := clientStore.Get(ProcessedTimeKey(height))
	if len(bz) == 0 {
		return 0, false
	}
	return sdk.BigEndianToUint64(bz), true
}

func deleteProcessedTime(clientStore storetypes.KVStore, height exported.Height) {
	clientStore.Delete(ProcessedTimeKey(height))
}

func ProcessedHeightKey(height exported.Height) []byte {
	return append(host.ConsensusStateKey(height), KeyProcessedHeight...)
}

func SetProcessedHeight(clientStore storetypes.KVStore, consHeight, processedHeight exported.Height) {
	clientStore.Set(ProcessedHeightKey(consHeight), []byte(processedHeight.String()))
}

func GetProcessedHeight(clientStore storetypes.KVStore, height exported.Height) (exported.Height, bool) {
	bz := clientStore.Get(ProcessedHeightKey(height))
	if len(bz) == 0 {
		return nil, false
	}
	processedHeight, err := clienttypes.ParseHeight(string(bz))
	if err != nil {
		return nil, false
	}
	return processedHeight, true
}

func deleteProcessedHeight(clientStore storetypes.KVStore, height exported.Height) {
	clientStore.Delete(ProcessedHeightKey(height))
}

func IterationKey(height exported.Height) []byte {
	heightBytes := bigEndianHeightBytes(height)
	return append([]byte(KeyIterateConsensusStatePrefix), heightBytes...)
}

func SetIterationKey(clientStore storetypes.KVStore, height exported.Height) {
	clientStore.Set(IterationKey(height), host.ConsensusStateKey(height))
}

func deleteIterationKey(clientStore storetypes.KVStore, height exported.Height) {
	clientStore.Delete(IterationKey(height))
}

func GetHeightFromIterationKey(iterKey []byte) exported.Height {
	bigEndianBytes := iterKey[len([]byte(KeyIterateConsensusStatePrefix)):]
	revisionBytes := bigEndianBytes[0:8]
	heightBytes := bigEndianBytes[8:]
	revision := binary.BigEndian.Uint64(revisionBytes)
	height := binary.BigEndian.Uint64(heightBytes)
	return clienttypes.NewHeight(revision, height)
}

func IterateConsensusStateAscending(clientStore storetypes.KVStore, cb func(height exported.Height) (stop bool)) {
	iterator := storetypes.KVStorePrefixIterator(clientStore, []byte(KeyIterateConsensusStatePrefix))
	defer iterator.Close()
	for ; iterator.Valid(); iterator.Next() {
		height := GetHeightFromIterationKey(iterator.Key())
		if cb(height) {
			break
		}
	}
}

func GetNextConsensusState(clientStore storetypes.KVStore, cdc codec.BinaryCodec, height exported.Height) (*ConsensusState, bool) {
	iterateStore := prefix.NewStore(clientStore, []byte(KeyIterateConsensusStatePrefix))
	iterator := iterateStore.Iterator(bigEndianHeightBytes(height), nil)
	defer iterator.Close()
	if !iterator.Valid() {
		return nil, false
	}
	if bytes.Equal(iterator.Value(), host.ConsensusStateKey(height)) {
		iterator.Next()
		if !iterator.Valid() {
			return nil, false
		}
	}
	return getStabilityConsensusState(clientStore, cdc, iterator.Value())
}

func GetPreviousConsensusState(clientStore storetypes.KVStore, cdc codec.BinaryCodec, height exported.Height) (*ConsensusState, bool) {
	iterateStore := prefix.NewStore(clientStore, []byte(KeyIterateConsensusStatePrefix))
	iterator := iterateStore.ReverseIterator(nil, bigEndianHeightBytes(height))
	defer iterator.Close()
	if !iterator.Valid() {
		return nil, false
	}
	return getStabilityConsensusState(clientStore, cdc, iterator.Value())
}

func getStabilityConsensusState(clientStore storetypes.KVStore, cdc codec.BinaryCodec, key []byte) (*ConsensusState, bool) {
	bz := clientStore.Get(key)
	if len(bz) == 0 {
		return nil, false
	}
	consensusStateI, err := clienttypes.UnmarshalConsensusState(cdc, bz)
	if err != nil {
		return nil, false
	}
	consensusState, ok := consensusStateI.(*ConsensusState)
	if !ok {
		return nil, false
	}
	return consensusState, true
}

func bigEndianHeightBytes(height exported.Height) []byte {
	heightBytes := make([]byte, 16)
	binary.BigEndian.PutUint64(heightBytes[:8], height.GetRevisionNumber())
	binary.BigEndian.PutUint64(heightBytes[8:], height.GetRevisionHeight())
	return heightBytes
}

func setConsensusMetadata(ctx sdk.Context, clientStore storetypes.KVStore, height exported.Height) {
	setConsensusMetadataWithValues(clientStore, height, GetSelfHeight(ctx), uint64(ctx.BlockTime().UnixNano()))
}

func setConsensusMetadataWithValues(clientStore storetypes.KVStore, height, processedHeight exported.Height, processedTime uint64) {
	SetProcessedTime(clientStore, height, processedTime)
	SetProcessedHeight(clientStore, height, processedHeight)
	SetIterationKey(clientStore, height)
}

func deleteConsensusMetadata(clientStore storetypes.KVStore, height exported.Height) {
	deleteProcessedTime(clientStore, height)
	deleteProcessedHeight(clientStore, height)
	deleteIterationKey(clientStore, height)
}

func normalizeConsensusKeyForCardano(path string) string {
	if !strings.Contains(path, "/consensusStates/") {
		return path
	}
	parts := strings.SplitN(path, "/consensusStates/", 2)
	if len(parts) != 2 {
		return path
	}
	revisionParts := strings.SplitN(parts[1], "-", 2)
	if len(revisionParts) != 2 || revisionParts[0] == "" || revisionParts[1] == "" {
		return path
	}
	return parts[0] + "/consensusStates/" + revisionParts[1]
}
