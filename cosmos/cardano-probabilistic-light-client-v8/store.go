package probabilistic

import (
	storetypes "cosmossdk.io/store/types"
	state "github.com/cardano-foundation/cardano-ibc-incubator/cosmos/cardano-probabilistic-light-client-core/state"
	"github.com/cosmos/cosmos-sdk/codec"
	clienttypes "github.com/cosmos/ibc-go/v8/modules/core/02-client/types"
	"github.com/cosmos/ibc-go/v8/modules/core/exported"
)

const KeyIterateConsensusStatePrefix = state.KeyIterateConsensusStatePrefix

var (
	KeyProcessedTime   = state.KeyProcessedTime
	KeyProcessedHeight = state.KeyProcessedHeight
	KeyIteration       = state.KeyIteration
)

func setClientState(store storetypes.KVStore, cdc codec.BinaryCodec, client *ClientState) {
	state.SetClientState(store, coreCodec{cdc}, toCoreClientState(client))
}

func getClientState(store storetypes.KVStore, cdc codec.BinaryCodec) (*ClientState, bool) {
	client, found := state.GetClientState(store, coreCodec{cdc})
	return fromCoreClientState(client), found
}

func setConsensusState(store storetypes.KVStore, cdc codec.BinaryCodec, consensus *ConsensusState, height exported.Height) {
	state.SetConsensusState(store, coreCodec{cdc}, toCoreConsensusState(consensus), height)
}

func GetConsensusState(store storetypes.KVStore, cdc codec.BinaryCodec, height exported.Height) (*ConsensusState, bool) {
	consensus, found := state.GetConsensusState(store, coreCodec{cdc}, height)
	return fromCoreConsensusState(consensus), found
}

func GetNextConsensusState(store storetypes.KVStore, cdc codec.BinaryCodec, height exported.Height) (*ConsensusState, bool) {
	consensus, found := state.GetNextConsensusState(store, coreCodec{cdc}, height)
	return fromCoreConsensusState(consensus), found
}

func GetPreviousConsensusState(store storetypes.KVStore, cdc codec.BinaryCodec, height exported.Height) (*ConsensusState, bool) {
	consensus, found := state.GetPreviousConsensusState(store, coreCodec{cdc}, height)
	return fromCoreConsensusState(consensus), found
}

func SetProcessedTime(store storetypes.KVStore, height exported.Height, timestamp uint64) {
	state.SetProcessedTime(store, height, timestamp)
}

func GetProcessedTime(store storetypes.KVStore, height exported.Height) (uint64, bool) {
	return state.GetProcessedTime(store, height)
}

func SetProcessedHeight(store storetypes.KVStore, height, processedHeight exported.Height) {
	state.SetProcessedHeight(store, height, processedHeight)
}

func GetProcessedHeight(store storetypes.KVStore, height exported.Height) (exported.Height, bool) {
	value, found := state.GetProcessedHeight(store, height)
	if !found {
		return nil, false
	}
	return clienttypes.NewHeight(value.GetRevisionNumber(), value.GetRevisionHeight()), true
}

func SetIterationKey(store storetypes.KVStore, height exported.Height) {
	state.SetIterationKey(store, height)
}

func GetHeightFromIterationKey(key []byte) exported.Height {
	h := state.GetHeightFromIterationKey(key)
	return clienttypes.NewHeight(h.GetRevisionNumber(), h.GetRevisionHeight())
}

func IterateConsensusStateAscending(store storetypes.KVStore, cb func(exported.Height) bool) {
	state.IterateConsensusStateAscending(store, func(h state.HeightValue) bool {
		return cb(clienttypes.NewHeight(h.GetRevisionNumber(), h.GetRevisionHeight()))
	})
}

func setConsensusMetadataWithValues(store storetypes.KVStore, height, processedHeight exported.Height, timestamp uint64) {
	state.SetConsensusMetadataWithValues(store, height, processedHeight, timestamp)
}

func normalizeConsensusKeyForCardano(path string) string {
	return state.NormalizeConsensusKeyForCardano(path)
}

func ProcessedTimeKey(height exported.Height) []byte   { return state.ProcessedTimeKey(height) }

func ProcessedHeightKey(height exported.Height) []byte { return state.ProcessedHeightKey(height) }

func IterationKey(height exported.Height) []byte       { return state.IterationKey(height) }
