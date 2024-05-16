package mithril

import (
	"bytes"
	"encoding/binary"
	"strings"

	"cosmossdk.io/store/prefix"
	storetypes "cosmossdk.io/store/types"
	"github.com/cosmos/cosmos-sdk/codec"
	sdk "github.com/cosmos/cosmos-sdk/types"
	clienttypes "github.com/cosmos/ibc-go/v8/modules/core/02-client/types"
	host "github.com/cosmos/ibc-go/v8/modules/core/24-host"
	"github.com/cosmos/ibc-go/v8/modules/core/exported"
)

const KeyIterateConsensusStatePrefix = "iterateConsensusStates"

var (
	// KeyProcessedTime is appended to consensus state key to store the processed time
	KeyProcessedTime = []byte("/processedTime")
	// KeyProcessedHeight is appended to consensus state key to store the processed height
	KeyProcessedHeight = []byte("/processedHeight")
	// KeyIteration stores the key mapping to consensus state key for efficient iteration
	KeyIteration = []byte("/iterationKey")
)

// setClientState stores the client state
func setClientState(clientStore storetypes.KVStore, cdc codec.BinaryCodec, clientState *ClientState) {
	key := host.ClientStateKey()
	val := clienttypes.MustMarshalClientState(cdc, clientState)
	clientStore.Set(key, val)
}

// setConsensusState stores the consensus state at the given height.
func setConsensusState(clientStore storetypes.KVStore, cdc codec.BinaryCodec, consensusState *ConsensusState, height exported.Height) {
	key := host.ConsensusStateKey(height)
	val := clienttypes.MustMarshalConsensusState(cdc, consensusState)
	clientStore.Set(key, val)
}

// GetConsensusState retrieves the consensus state from the client prefixed store.
// If the ConsensusState does not exist in state for the provided height a nil value and false boolean flag is returned
func GetConsensusState(store storetypes.KVStore, cdc codec.BinaryCodec, height exported.Height) (*ConsensusState, bool) {
	bz := store.Get(host.ConsensusStateKey(height))
	if len(bz) == 0 {
		return nil, false
	}

	consensusStateI := clienttypes.MustUnmarshalConsensusState(cdc, bz)
	return consensusStateI.(*ConsensusState), true
}

// deleteConsensusState deletes the consensus state at the given height
func deleteConsensusState(clientStore storetypes.KVStore, height exported.Height) {
	key := host.ConsensusStateKey(height)
	clientStore.Delete(key)
}

// ProcessedTimeKey returns the key under which the processed time will be stored in the client store.
func ProcessedTimeKey(height exported.Height) []byte {
	return append(host.ConsensusStateKey(height), KeyProcessedTime...)
}

// SetProcessedTime stores the time at which a header was processed and the corresponding consensus state was created.
// This is useful when validating whether a packet has reached the time specified delay period in the mithril client's
// verification functions
func SetProcessedTime(clientStore storetypes.KVStore, height exported.Height, timeNs uint64) {
	key := ProcessedTimeKey(height)
	val := sdk.Uint64ToBigEndian(timeNs)
	clientStore.Set(key, val)
}

// GetProcessedTime gets the time (in nanoseconds) at which this chain received and processed a tendermint header.
// This is used to validate that a received packet has passed the time delay period.
func GetProcessedTime(clientStore storetypes.KVStore, height exported.Height) (uint64, bool) {
	key := ProcessedTimeKey(height)
	bz := clientStore.Get(key)
	if len(bz) == 0 {
		return 0, false
	}
	return sdk.BigEndianToUint64(bz), true
}

// deleteProcessedTime deletes the processedTime for a given height
func deleteProcessedTime(clientStore storetypes.KVStore, height exported.Height) {
	key := ProcessedTimeKey(height)
	clientStore.Delete(key)
}

// ProcessedHeightKey returns the key under which the processed height will be stored in the client store.
func ProcessedHeightKey(height exported.Height) []byte {
	return append(host.ConsensusStateKey(height), KeyProcessedHeight...)
}

// SetProcessedHeight stores the height at which a header was processed and the corresponding consensus state was created.
// This is useful when validating whether a packet has reached the specified block delay period in the mithril client's
// verification functions
func SetProcessedHeight(clientStore storetypes.KVStore, consHeight, processedHeight exported.Height) {
	key := ProcessedHeightKey(consHeight)
	val := []byte(processedHeight.String())
	clientStore.Set(key, val)
}

// GetProcessedHeight gets the height at which this chain received and processed a tendermint header.
// This is used to validate that a received packet has passed the block delay period.
func GetProcessedHeight(clientStore storetypes.KVStore, height exported.Height) (exported.Height, bool) {
	key := ProcessedHeightKey(height)
	bz := clientStore.Get(key)
	if len(bz) == 0 {
		return nil, false
	}
	processedHeight, err := clienttypes.ParseHeight(string(bz))
	if err != nil {
		return nil, false
	}
	return processedHeight, true
}

// deleteProcessedHeight deletes the processedHeight for a given height
func deleteProcessedHeight(clientStore storetypes.KVStore, height exported.Height) {
	key := ProcessedHeightKey(height)
	clientStore.Delete(key)
}

// IterationKey returns the key under which the consensus state key will be stored.
// The iteration key is a BigEndian representation of the consensus state key to support efficient iteration.
func IterationKey(height exported.Height) []byte {
	heightBytes := bigEndianHeightBytes(height)
	return append([]byte(KeyIterateConsensusStatePrefix), heightBytes...)
}

// SetIterationKey stores the consensus state key under a key that is more efficient for ordered iteration
func SetIterationKey(clientStore storetypes.KVStore, height exported.Height) {
	key := IterationKey(height)
	val := host.ConsensusStateKey(height)
	clientStore.Set(key, val)
}

// GetIterationKey returns the consensus state key stored under the efficient iteration key.
// NOTE: This function is currently only used for testing purposes
func GetIterationKey(clientStore storetypes.KVStore, height exported.Height) []byte {
	key := IterationKey(height)
	return clientStore.Get(key)
}

// deleteIterationKey deletes the iteration key for a given height
func deleteIterationKey(clientStore storetypes.KVStore, height exported.Height) {
	key := IterationKey(height)
	clientStore.Delete(key)
}

// GetHeightFromIterationKey takes an iteration key and returns the height that it references
func GetHeightFromIterationKey(iterKey []byte) exported.Height {
	bigEndianBytes := iterKey[len([]byte(KeyIterateConsensusStatePrefix)):]
	revisionBytes := bigEndianBytes[0:8]
	heightBytes := bigEndianBytes[8:]
	revision := binary.BigEndian.Uint64(revisionBytes)
	height := binary.BigEndian.Uint64(heightBytes)
	return clienttypes.NewHeight(revision, height)
}

// IterateConsensusStateAscending iterates through the consensus states in ascending order. It calls the provided
// callback on each height, until stop=true is returned.
func IterateConsensusStateAscending(clientStore storetypes.KVStore, cb func(height exported.Height) (stop bool)) {
	iterator := storetypes.KVStorePrefixIterator(clientStore, []byte(KeyIterateConsensusStatePrefix))
	defer iterator.Close()

	for ; iterator.Valid(); iterator.Next() {
		iterKey := iterator.Key()
		height := GetHeightFromIterationKey(iterKey)
		if cb(height) {
			break
		}
	}
}

// GetNextConsensusState returns the lowest consensus state that is larger than the given height.
// The Iterator returns a storetypes.Iterator which iterates from start (inclusive) to end (exclusive).
// If the starting height exists in store, we need to call iterator.Next() to get the next consenus state.
// Otherwise, the iterator is already at the next consensus state so we can call iterator.Value() immediately.
func GetNextConsensusState(clientStore storetypes.KVStore, cdc codec.BinaryCodec, height exported.Height) (*ConsensusState, bool) {
	iterateStore := prefix.NewStore(clientStore, []byte(KeyIterateConsensusStatePrefix))
	iterator := iterateStore.Iterator(bigEndianHeightBytes(height), nil)
	defer iterator.Close()
	if !iterator.Valid() {
		return nil, false
	}

	// if iterator is at current height, ignore the consensus state at current height and get next height
	// if iterator value is not at current height, it is already at next height.
	if bytes.Equal(iterator.Value(), host.ConsensusStateKey(height)) {
		iterator.Next()
		if !iterator.Valid() {
			return nil, false
		}
	}

	csKey := iterator.Value()

	return getMithrilConsensusState(clientStore, cdc, csKey)
}

// GetPreviousConsensusState returns the highest consensus state that is lower than the given height.
// The Iterator returns a storetypes.Iterator which iterates from the end (exclusive) to start (inclusive).
// Thus to get previous consensus state we call iterator.Value() immediately.
func GetPreviousConsensusState(clientStore storetypes.KVStore, cdc codec.BinaryCodec, height exported.Height) (*ConsensusState, bool) {
	iterateStore := prefix.NewStore(clientStore, []byte(KeyIterateConsensusStatePrefix))
	iterator := iterateStore.ReverseIterator(nil, bigEndianHeightBytes(height))
	defer iterator.Close()

	if !iterator.Valid() {
		return nil, false
	}

	csKey := iterator.Value()

	return getMithrilConsensusState(clientStore, cdc, csKey)
}

// Helper function for GetNextConsensusState and GetPreviousConsensusState
func getMithrilConsensusState(clientStore storetypes.KVStore, cdc codec.BinaryCodec, key []byte) (*ConsensusState, bool) {
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
	binary.BigEndian.PutUint64(heightBytes, height.GetRevisionNumber())
	binary.BigEndian.PutUint64(heightBytes[8:], height.GetRevisionHeight())
	return heightBytes
}

// IterateConsensusMetadata iterates through the prefix store and applies the callback.
// If the cb returns true, then iterator will close and stop.
func IterateConsensusMetadata(store storetypes.KVStore, cb func(key, val []byte) bool) {
	iterator := storetypes.KVStorePrefixIterator(store, []byte(host.KeyConsensusStatePrefix))

	// iterate over processed time and processed height
	defer iterator.Close()
	for ; iterator.Valid(); iterator.Next() {
		keySplit := strings.Split(string(iterator.Key()), "/")
		// processed time key in prefix store has format: "consensusState/<height>/processedTime"
		if len(keySplit) != 3 {
			// ignore all consensus state keys
			continue
		}

		if keySplit[2] != "processedTime" && keySplit[2] != "processedHeight" {
			// only perform callback on consensus metadata
			continue
		}

		if cb(iterator.Key(), iterator.Value()) {
			break
		}
	}

	// iterate over iteration keys
	iter := storetypes.KVStorePrefixIterator(store, []byte(KeyIterateConsensusStatePrefix))

	defer iter.Close()
	for ; iter.Valid(); iter.Next() {
		if cb(iter.Key(), iter.Value()) {
			break
		}
	}
}

// setConsensusMetadata sets context time as processed time and set context height as processed height
// as this is internal mithril light client logic.
// client state and consensus state will be set by client keeper
// set iteration key to provide ability for efficient ordered iteration of consensus states.
func setConsensusMetadata(ctx sdk.Context, clientStore storetypes.KVStore, height exported.Height) {
	setConsensusMetadataWithValues(clientStore, height, clienttypes.GetSelfHeight(ctx), uint64(ctx.BlockTime().UnixNano()))
}

// setConsensusMetadataWithValues sets the consensus metadata with the provided values
func setConsensusMetadataWithValues(
	clientStore storetypes.KVStore, height,
	processedHeight exported.Height,
	processedTime uint64,
) {
	SetProcessedTime(clientStore, height, processedTime)
	SetProcessedHeight(clientStore, height, processedHeight)
	SetIterationKey(clientStore, height)
}

// deleteConsensusMetadata deletes the metadata stored for a particular consensus state.
func deleteConsensusMetadata(clientStore storetypes.KVStore, height exported.Height) {
	deleteProcessedTime(clientStore, height)
	deleteProcessedHeight(clientStore, height)
	deleteIterationKey(clientStore, height)
}

// setFcMsdInEpoch stores the first Mithril Stake Distribution certificate in epoch
func setFcMsdInEpoch(clientStore storetypes.KVStore, certificate MithrilCertificate, epoch uint64) {
	key := FcMsdInEpochKey(epoch)
	val := MustMarshalMithrilCertificate(certificate)
	clientStore.Set(key, val)
}

// getFcMsdInEpoch get the first Mithril Stake Distribution certificate in epoch
func getFcMsdInEpoch(clientStore storetypes.KVStore, epoch uint64) MithrilCertificate {
	key := FcMsdInEpochKey(epoch)
	bz := clientStore.Get(key)
	if len(bz) == 0 {
		return MithrilCertificate{}
	}
	return MustUnmarshalMithrilCertificate(bz)
}

// setLcMsdInEpoch stores the latest Mithril Stake Distribution certificate in epoch
func setLcMsdInEpoch(clientStore storetypes.KVStore, certificate MithrilCertificate, epoch uint64) {
	key := LcMsdInEpochKey(epoch)
	val := MustMarshalMithrilCertificate(certificate)
	clientStore.Set(key, val)
}

// getLcMsdInEpoch get the latest Mithril Stake Distribution certificate in epoch
func getLcMsdInEpoch(clientStore storetypes.KVStore, epoch uint64) MithrilCertificate {
	key := LcMsdInEpochKey(epoch)
	bz := clientStore.Get(key)
	if len(bz) == 0 {
		return MithrilCertificate{}
	}
	return MustUnmarshalMithrilCertificate(bz)
}

// setFcTsInEpoch stores the first Transaction Snapshot certificate in epoch
func setFcTsInEpoch(clientStore storetypes.KVStore, certificate MithrilCertificate, epoch uint64) {
	key := FcTsInEpochKey(epoch)
	val := MustMarshalMithrilCertificate(certificate)
	clientStore.Set(key, val)
}

// getFcTsInEpoch get the first Transaction Snapshot certificate in epoch
func getFcTsInEpoch(clientStore storetypes.KVStore, epoch uint64) MithrilCertificate {
	key := FcTsInEpochKey(epoch)
	bz := clientStore.Get(key)
	if len(bz) == 0 {
		return MithrilCertificate{}
	}
	return MustUnmarshalMithrilCertificate(bz)
}

// setLcTsInEpoch stores the latest Transaction Snapshot certificate in epoch
func setLcTsInEpoch(clientStore storetypes.KVStore, certificate MithrilCertificate, epoch uint64) {
	key := LcTsInEpochKey(epoch)
	val := MustMarshalMithrilCertificate(certificate)
	clientStore.Set(key, val)
}

// getLcTsInEpoch get the latest Transaction Snapshot certificate in epoch
func getLcTsInEpoch(clientStore storetypes.KVStore, epoch uint64) MithrilCertificate {
	key := LcTsInEpochKey(epoch)
	bz := clientStore.Get(key)
	if len(bz) == 0 {
		return MithrilCertificate{}
	}
	return MustUnmarshalMithrilCertificate(bz)
}
