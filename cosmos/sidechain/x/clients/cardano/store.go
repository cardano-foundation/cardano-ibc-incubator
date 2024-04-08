package cardano

import (
	"bytes"
	"encoding/binary"
	"encoding/hex"
	"fmt"
	"strconv"
	"strings"

	channeltypes "github.com/cosmos/ibc-go/v8/modules/core/04-channel/types"

	"cosmossdk.io/store/prefix"
	storetypes "cosmossdk.io/store/types"

	"github.com/cosmos/cosmos-sdk/codec"
	sdk "github.com/cosmos/cosmos-sdk/types"
	clienttypes "github.com/cosmos/ibc-go/v8/modules/core/02-client/types"
	host "github.com/cosmos/ibc-go/v8/modules/core/24-host"
	"github.com/cosmos/ibc-go/v8/modules/core/exported"
	"github.com/fxamacker/cbor/v2"
)

/*
This file contains the logic for storage and iteration over `IterationKey` metadata that is stored
for each consensus state. The consensus state key specified in ICS-24 and expected by counterparty chains
stores the consensus state under the key: `consensusStates/{revision_number}-{revision_height}`, with each number
represented as a string.
While this works fine for IBC proof verification, it makes efficient iteration difficult since the lexicographic order
of the consensus state keys do not match the height order of consensus states. This makes consensus state pruning and
monotonic time enforcement difficult since it is inefficient to find the earliest consensus state or to find the neigboring
consensus states given a consensus state height.
Changing the ICS-24 representation will be a major breaking change that requires counterparty chains to accept a new key format.
Thus to avoid breaking IBC, we can store a lookup from a more efficiently formatted key: `iterationKey` to the consensus state key which
stores the underlying consensus state. This efficient iteration key will be formatted like so: `iterateConsensusStates{BigEndianRevisionBytes}{BigEndianHeightBytes}`.
This ensures that the lexicographic order of iteration keys match the height order of the consensus states. Thus, we can use the SDK store's
Iterators to iterate over the consensus states in ascending/descending order by providing a mapping from `iterationKey -> consensusStateKey -> ConsensusState`.
A future version of IBC may choose to replace the ICS24 ConsensusState path with the more efficient format and make this indirection unnecessary.
*/

const KeyIterateConsensusStatePrefix = "iterateConsensusStates"
const KeyIterateUTXOsPrefix = "iterateUTXOs"

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

// setClientSPOs stores the client SPOs
func setClientSPOs(clientStore storetypes.KVStore, validatorSet []*Validator, epochNo uint64) {
	key := ClientSPOsKey(epochNo)
	val := MustMarshalClientSPOs(validatorSet)
	clientStore.Set(key, val)
}

// getClientSPOs get the client SPOs
func getClientSPOs(clientStore storetypes.KVStore, epochNo uint64) []*Validator {
	key := ClientSPOsKey(epochNo)
	bz := clientStore.Get(key)
	if len(bz) == 0 {
		return []*Validator{}
	}
	return MustUnmarshalClientSPOs(bz)
}

// updateRegisterCert stores the client RegisterCert
func UpdateRegisterCert(clientStore storetypes.KVStore, registerCerts []RegisCert, epochNo uint64, blockNo uint64) {
	if len(registerCerts) > 0 {
		currentState := getSPOState(clientStore, epochNo)
		// val := MustMarshalSPOState(RemoveDuplicateRegisterCert(append(currentRegisterCert, registerCert...)))
		for _, cert := range registerCerts {
			currentState = append(currentState, SPOState{
				IsRegisCert: true,
				PoolId:      cert.RegisPoolId,
				PoolVrf:     cert.RegisPoolVrf,
				BlockNo:     blockNo,
				TxIndex:     uint64(cert.TxIndex),
			})
		}
		val := MustMarshalSPOState(currentState)
		clientStore.Set(SPOStateKey(epochNo), val)
	}
}

// updateUnregisterCert stores the client UnregisterCert
func UpdateUnregisterCert(clientStore storetypes.KVStore, unregisterCert []DeRegisCert, blockNo uint64) {
	if len(unregisterCert) > 0 {
		groups := classifyUnregisterCert(unregisterCert)
		for _, certs := range groups {
			if len(certs) > 0 {
				epochNum, _ := strconv.ParseUint(certs[0].DeRegisEpoch, 10, 64)
				// deregis will be apply in epoch N+2
				epochToApply := epochNum + 2
				epochState := getSPOState(clientStore, epochToApply)
				for _, cert := range certs {
					epochState = append(epochState, SPOState{
						IsRegisCert: false,
						PoolId:      cert.DeRegisPoolId,
						PoolVrf:     "",
						BlockNo:     blockNo,
						TxIndex:     uint64(cert.TxIndex),
					})
				}
				val := MustMarshalSPOState(epochState)
				clientStore.Set(SPOStateKey(epochToApply), val)
			}
		}
	}
}

func getSPOState(clientStore storetypes.KVStore, epochNo uint64) []SPOState {
	key := SPOStateKey(epochNo)
	bytesVal := clientStore.Get(key)
	return MustUnmarshalSPOState(bytesVal)
}

// classifyUnregisterCert classify a slide to groups
func classifyUnregisterCert(unregisterCert []DeRegisCert) map[string][]DeRegisCert {
	result := map[string][]DeRegisCert{}
	for _, e := range unregisterCert {
		if _, ok := result[e.DeRegisEpoch]; !ok {
			result[e.DeRegisEpoch] = make([]DeRegisCert, 0)
		}
		result[e.DeRegisEpoch] = append(result[e.DeRegisEpoch], e)
	}
	return result
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

// ProcessedTimeKey returns the key under which the processed time will be stored in the client store.
func ProcessedTimeKey(height exported.Height) []byte {
	return append(host.ConsensusStateKey(height), KeyProcessedTime...)
}

// SetProcessedTime stores the time at which a header was processed and the corresponding consensus state was created.
// This is useful when validating whether a packet has reached the time specified delay period in the cardano client's
// verification functions
func SetProcessedTime(clientStore storetypes.KVStore, height exported.Height, timeNs uint64) {
	key := ProcessedTimeKey(height)
	val := sdk.Uint64ToBigEndian(timeNs)
	clientStore.Set(key, val)
}

// GetProcessedTime gets the time (in nanoseconds) at which this chain received and processed a cardano header.
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
// This is useful when validating whether a packet has reached the specified block delay period in the cardano client's
// verification functions
func SetProcessedHeight(clientStore storetypes.KVStore, consHeight, processedHeight exported.Height) {
	key := ProcessedHeightKey(consHeight)
	val := []byte(processedHeight.String())
	clientStore.Set(key, val)
}

// GetProcessedHeight gets the height at which this chain received and processed a cardano header.
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

	return getCardanoConsensusState(clientStore, cdc, csKey)
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

	return getCardanoConsensusState(clientStore, cdc, csKey)
}

// Helper function for GetNextConsensusState and GetPreviousConsensusState
func getCardanoConsensusState(clientStore storetypes.KVStore, cdc codec.BinaryCodec, key []byte) (*ConsensusState, bool) {
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

// setConsensusMetadata sets context time as processed time and set context height as processed height
// as this is internal cardano light client logic.
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

func setUTXOs(ctx sdk.Context, tokenConfigs TokenConfigs, clientStore storetypes.KVStore, UTXOs []UTXOOutput, height exported.Height) {
	if len(UTXOs) > 0 {
		for _, UTXO := range UTXOs {
			// IBC UTXO will always have datum, and also included a custom token
			if UTXO.DatumHex != "" && len(UTXO.Tokens) > 1 {
				UTXO.extractAndSaveIBCData(ctx, tokenConfigs, clientStore, height)
			}
		}
	}
}

func (utxo UTXOOutput) extractAndSaveIBCData(ctx sdk.Context, tokenConfigs TokenConfigs, clientStore storetypes.KVStore, height exported.Height) {
	// default key
	key := ClientUTXOKey(height, utxo.TxHash, utxo.OutputIndex)
	val := MustMarshalUTXO(utxo)
	tryFindType := utxo.TryMatchAndSaveIBCType(ctx, tokenConfigs, clientStore, height)
	// fallback if we cannot identify UTXO IBC
	if tryFindType == "" {
		clientStore.Set(key, val)
	}
}

// Try to match UTXO related to IBC action, will return "" if cannot match any
func (utxo UTXOOutput) TryMatchAndSaveIBCType(ctx sdk.Context, tokenConfigs TokenConfigs, clientStore storetypes.KVStore, height exported.Height) string {
	clientTokenPrefix := strings.ToLower(tokenConfigs.ClientPolicyId + IBCTokenPrefix(tokenConfigs.HandlerTokenUnit, KeyUTXOClientStateTokenPrefix))
	connectionTokenPrefix := strings.ToLower(tokenConfigs.ConnectionPolicyId + IBCTokenPrefix(tokenConfigs.HandlerTokenUnit, KeyUTXOConnectionStatePrefix))
	channelTokenPrefix := strings.ToLower(tokenConfigs.ChannelPolicyId + IBCTokenPrefix(tokenConfigs.HandlerTokenUnit, KeyUTXOChannelStatePrefix))

	// Emit Event TokenPrefix
	ctx.EventManager().EmitEvent(
		sdk.NewEvent("TokenPrefix",
			sdk.NewAttribute("clientTokenPrefix:", clientTokenPrefix),
			sdk.NewAttribute("connectionTokenPrefix:", connectionTokenPrefix),
			sdk.NewAttribute("channelTokenPrefix:", channelTokenPrefix),
			sdk.NewAttribute("utxo.Tokens len:", fmt.Sprintf("%v", len(utxo.Tokens))),
			sdk.NewAttribute("utxo:", fmt.Sprintf("%v", utxo)),
		),
	)

	utxoIBCType := ""
	for _, token := range utxo.Tokens {
		tokenAssetName := strings.ToLower(token.TokenAssetName)
		switch true {
		case strings.Contains(tokenAssetName, clientTokenPrefix):
			// maybe client
			// try unmarshall, if ok, set utxoIBCType = KeyUTXOClientStatePrefix
			datumBytes, _ := hex.DecodeString(utxo.DatumHex)
			var vOutput ClientDatum
			err := cbor.Unmarshal(datumBytes, &vOutput)
			if err == nil {
				utxoIBCType = KeyUTXOClientStatePrefix
				clientStateBytes, _ := cbor.Marshal(vOutput.State.ClientState)
				// TODO: Should decode client ID using token name, then use it to save
				// clientIdHex, _ := hex.DecodeString(strings.ReplaceAll(token.TokenAssetName, clientTokenPrefix, ""))
				// clientId :=  string(clientIdHex)
				// save client state
				clientStateKey := ClientUTXOIBCKey(height, KeyUTXOClientStatePrefix, strings.ToLower(utxo.TxHash), utxo.OutputIndex)
				clientStore.Set(clientStateKey, clientStateBytes)

				// Emit Event ClientState
				ctx.EventManager().EmitEvent(
					sdk.NewEvent("Saved: clientState",
						sdk.NewAttribute("clientStateKey:", string(clientStateKey[:])),
					),
				)

				// save consensus states
				for consensusHeight, consensusValue := range vOutput.State.ConsensusStates {
					consensusStateHeight := Height{
						RevisionNumber: consensusHeight.RevisionNumber,
						RevisionHeight: consensusHeight.RevisionHeight,
					}
					consensusStateKey := ClientUTXOIBCKey(height, KeyUTXOConsensusStatePrefix, strings.ToLower(utxo.TxHash), utxo.OutputIndex)
					keyAppend := []byte(fmt.Sprintf("/%s", consensusStateHeight))
					consensusStateKey = append(consensusStateKey, keyAppend...)
					consensusValueBytes, _ := cbor.Marshal(consensusValue)
					clientStore.Set(consensusStateKey, consensusValueBytes)
					// Emit Event ClientState
					ctx.EventManager().EmitEvent(
						sdk.NewEvent("Saved: consensusState",
							sdk.NewAttribute("consensusStateKey:", string(consensusStateKey[:])),
						),
					)
				}
				break
			}
		case strings.Contains(tokenAssetName, connectionTokenPrefix):
			// maybe connection
			// try unmarshall, if ok, set utxoIBCType = KeyUTXOConnectionStatePrefix
			datumBytes, _ := hex.DecodeString(utxo.DatumHex)
			var vOutput ConnectionDatum
			err := cbor.Unmarshal(datumBytes, &vOutput)
			if err == nil {
				utxoIBCType = KeyUTXOConnectionStatePrefix
				connectionStateBytes, _ := cbor.Marshal(vOutput.State)
				// save connection end
				connectionStateKey := ClientUTXOIBCKey(height, KeyUTXOConnectionStatePrefix, strings.ToLower(utxo.TxHash), utxo.OutputIndex)
				clientStore.Set(connectionStateKey, connectionStateBytes)

				// Emit Event ConnectionState
				ctx.EventManager().EmitEvent(
					sdk.NewEvent("Saved: ConnectionState",
						sdk.NewAttribute("connectionStateKey:", string(connectionStateKey[:])),
					),
				)

				break
			}
		case strings.Contains(tokenAssetName, channelTokenPrefix):
			// maybe channel
			// try unmarshall, if ok, set utxoIBCType = KeyUTXOChannelStatePrefix
			datumBytes, _ := hex.DecodeString(utxo.DatumHex)
			var vOutput ChannelDatumWithPort
			err := cbor.Unmarshal(datumBytes, &vOutput)
			if err == nil {
				utxoIBCType = KeyUTXOChannelStatePrefix
				channelStateBytes, _ := cbor.Marshal(vOutput.State.Channel)
				channelChannelSeqHex, _ := hex.DecodeString(strings.ReplaceAll(tokenAssetName, channelTokenPrefix, ""))
				channelSeq, _ := strconv.ParseUint(string(channelChannelSeqHex), 10, 64)
				// save channel end
				// {height}/channel/{tx_hash}/{utxo_index}/{portId}/channel-{channelSeq}
				channelStateKey := ClientUTXOIBCAnyKey(height, KeyUTXOChannelStatePrefix, strings.ToLower(utxo.TxHash), utxo.OutputIndex, string(vOutput.PortId[:]), channeltypes.FormatChannelIdentifier(channelSeq))
				clientStore.Set(channelStateKey, channelStateBytes)

				// Emit Event ConnectionState
				ctx.EventManager().EmitEvent(
					sdk.NewEvent("Saved: ChannelState",
						sdk.NewAttribute("channelStateKey:", string(channelStateKey[:])),
					),
				)

				// {height}/commitments/{tx_hash}/{utxo_index}/{portId}/channel-{channelSeq}/{seq}
				// save PacketCommitment
				for seq, commitmentByte := range vOutput.State.PacketCommitment {
					packetCommitmentKey := ClientUTXOIBCAnyKey(height, KeyUTXOPacketCommitmentPrefix, strings.ToLower(utxo.TxHash), utxo.OutputIndex, string(vOutput.PortId[:]), channeltypes.FormatChannelIdentifier(channelSeq), strconv.FormatUint(seq, 10))
					clientStore.Set(packetCommitmentKey, commitmentByte)

					// Emit Event commitments
					ctx.EventManager().EmitEvent(
						sdk.NewEvent("Saved: packetCommitment",
							sdk.NewAttribute("packetCommitmentKey:", string(packetCommitmentKey[:])),
						),
					)
				}

				// {height}/acks/{tx_hash}/{utxo_index}/{portId}/channel-{channelSeq}/{seq}
				// save PacketAcknowledgement
				for seq, ackByte := range vOutput.State.PacketAcknowledgement {
					packetAcknowledgementKey := ClientUTXOIBCAnyKey(height, KeyUTXOPacketAcksPrefix, strings.ToLower(utxo.TxHash), utxo.OutputIndex, string(vOutput.PortId[:]), channeltypes.FormatChannelIdentifier(channelSeq), strconv.FormatUint(seq, 10))
					clientStore.Set(packetAcknowledgementKey, ackByte)

					// Emit Event packetAcknowledgement
					ctx.EventManager().EmitEvent(
						sdk.NewEvent("Saved: packetAcknowledgement",
							sdk.NewAttribute("packetAcknowledgementKey:", string(packetAcknowledgementKey[:])),
						),
					)
				}

				// {height}/receipts/{tx_hash}/{utxo_index}/{portId}/channel-{channelSeq}/{seq}
				// save PacketReceipt
				for seq, recvByte := range vOutput.State.PacketReceipt {
					packetReceiptKey := ClientUTXOIBCAnyKey(height, KeyUTXOPacketReceiptsPrefix, strings.ToLower(utxo.TxHash), utxo.OutputIndex, string(vOutput.PortId[:]), channeltypes.FormatChannelIdentifier(channelSeq), strconv.FormatUint(seq, 10))
					clientStore.Set(packetReceiptKey, recvByte)
					extraKeys := []byte(KeyUTXOsPrefix + "/" + KeyUTXOPacketReceiptsPrefix + "/" + string(vOutput.PortId[:]) + "/" + channeltypes.FormatChannelIdentifier(channelSeq) + "/" + strconv.FormatUint(seq, 10))
					clientStore.Set(extraKeys, []byte{1})

					// Emit Event packetReceipt
					ctx.EventManager().EmitEvent(
						sdk.NewEvent("Saved: packetReceipt",
							sdk.NewAttribute("packetReceiptKey:", string(packetReceiptKey[:])),
							sdk.NewAttribute("extraKeys:", string(extraKeys[:])),
						),
					)
				}

				// {height}/nextSequenceRecv/{tx_hash}/{utxo_index}/{portId}/channel-{channelSeq}
				// save NextSequenceRecv
				nextSequenceRecvKey := ClientUTXOIBCAnyKey(height, KeyUTXONextSequenceRecvPrefix, strings.ToLower(utxo.TxHash), utxo.OutputIndex, string(vOutput.PortId[:]), channeltypes.FormatChannelIdentifier(channelSeq))
				clientStore.Set(nextSequenceRecvKey, sdk.Uint64ToBigEndian(vOutput.State.NextSequenceRecv))

				// {height}/nextSequenceSend/{tx_hash}/{utxo_index}/{portId}/channel-{channelSeq}
				// save nextSequenceSend
				nextSequenceSendKey := ClientUTXOIBCAnyKey(height, KeyUTXONextSequenceSendPrefix, strings.ToLower(utxo.TxHash), utxo.OutputIndex, string(vOutput.PortId[:]), channeltypes.FormatChannelIdentifier(channelSeq))
				clientStore.Set(nextSequenceSendKey, sdk.Uint64ToBigEndian(vOutput.State.NextSequenceSend))

				// {height}/nextSequenceAck/{tx_hash}/{utxo_index}/{portId}/channel-{channelSeq}
				// save nextSequenceAck
				nextSequenceAckKey := ClientUTXOIBCAnyKey(height, KeyUTXONextSequenceAckPrefix, strings.ToLower(utxo.TxHash), utxo.OutputIndex, string(vOutput.PortId[:]), channeltypes.FormatChannelIdentifier(channelSeq))
				clientStore.Set(nextSequenceAckKey, sdk.Uint64ToBigEndian(vOutput.State.NextSequenceAck))

				// Emit Event next seq
				ctx.EventManager().EmitEvent(
					sdk.NewEvent("Next-seq-keys",
						sdk.NewAttribute("nextSequenceRecvKey:", string(nextSequenceRecvKey[:])),
						sdk.NewAttribute("nextSequenceSendKey:", string(nextSequenceSendKey[:])),
						sdk.NewAttribute("nextSequenceAckKey:", string(nextSequenceAckKey[:])),
					),
				)
				break
			}
		default:
		}
	}

	return utxoIBCType

}

// setConsensusStateBlockHash stores the consensus state block hash at the given height.
func SetConsensusStateBlockHash(clientStore storetypes.KVStore, height exported.Height, blockHash string) {
	key := ConsensusStateBlockHashKey(height)
	clientStore.Set(key, []byte(blockHash))
}

// GetConsensusState retrieves the consensus state from the client prefixed store.
// If the ConsensusState does not exist in state for the provided height a nil value and false boolean flag is returned
func GetConsensusStateBlockHash(store storetypes.KVStore, height exported.Height) (string, bool) {
	bz := store.Get(ConsensusStateBlockHashKey(height))
	if len(bz) == 0 {
		return "", false
	}

	return string(bz[:]), true
}
