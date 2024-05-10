package mithril

import (
	storetypes "cosmossdk.io/store/types"
	"github.com/cosmos/cosmos-sdk/codec"
	sdk "github.com/cosmos/cosmos-sdk/types"
	"github.com/cosmos/ibc-go/v8/modules/core/exported"
)

// UpdateState may be used to either create a consensus state for:
// - a future height greater than the latest client state height
// - a past height that was skipped during bisection
// If we are updating to a past height, a consensus state is created for that height to be persisted in client store
// If we are updating to a future height, the consensus state is created and the client state is updated to reflect
// the new latest height
// A list containing the updated consensus height is returned.
// UpdateState must only be used to update within a single revision, thus header revision number and trusted height's revision
// number must be the same. To update to a new revision, use a separate upgrade path
// UpdateState will prune the oldest consensus state if it is expired.
func (cs ClientState) UpdateState(ctx sdk.Context, cdc codec.BinaryCodec, clientStore storetypes.KVStore, clientMsg exported.ClientMessage) []exported.Height

// UpdateStateOnMisbehaviour updates state upon misbehaviour, freezing the ClientState. This method should only be called when misbehaviour is detected
// as it does not perform any misbehaviour checks.
func (cs ClientState) UpdateStateOnMisbehaviour(ctx sdk.Context, cdc codec.BinaryCodec, clientStore storetypes.KVStore, _ exported.ClientMessage)

// VerifyClientMessage checks if the clientMessage is of type Header or Misbehaviour and verifies the message
// Called by clientState.VerifyClientMessage, before clientState.CheckForMisbehaviour
func (cs *ClientState) VerifyClientMessage(
	ctx sdk.Context, cdc codec.BinaryCodec, clientStore storetypes.KVStore,
	clientMsg exported.ClientMessage,
) error

// // VerifyClientMessage checks if the clientMessage is of type Header or Misbehaviour and verifies the message
// // Called by clientState.VerifyClientMessage, before clientState.CheckForMisbehaviour
// func (cs *ClientState) VerifyClientMessage(
// 	ctx sdk.Context, cdc codec.BinaryCodec, clientStore storetypes.KVStore,
// 	clientMsg exported.ClientMessage,
// ) error {
// 	switch msg := clientMsg.(type) {
// 	case *BlockData:
// 		return cs.verifyBlockData(ctx, clientStore, cdc, msg)
// 	case *Misbehaviour:
// 		return cs.verifyMisbehaviour(ctx, clientStore, cdc, msg)
// 	default:
// 		return clienttypes.ErrInvalidClientType
// 	}
// }

// // verifyBlockData returns an error if:
// // - signature is not valid
// // - vrf key hash is not in SPO list
// // - header timestamp is past the trusting period in relation to the consensus state
// func (cs *ClientState) verifyBlockData(
// 	ctx sdk.Context, clientStore storetypes.KVStore, cdc codec.BinaryCodec,
// 	blockData *BlockData,
// ) error {
// 	verifyError, isValid, vrfHex, blockNo, slotNo := VerifyBlock(BlockHexCbor{
// 		HeaderCbor:    blockData.HeaderCbor,
// 		Eta0:          blockData.EpochNonce,
// 		Spk:           int(cs.SlotPerKesPeriod),
// 		BlockBodyCbor: blockData.BodyCbor,
// 	})

// 	if verifyError != nil {
// 		return errorsmod.Wrapf(ErrInvalidBlockData, "Verify: Invalid block data, data not valid, %v", verifyError.Error())
// 	}

// 	if !isValid {
// 		return errorsmod.Wrap(ErrInvalidBlockData, "Verify: Invalid block data, signature not valid")
// 	}

// 	if slotNo != blockData.Slot || blockNo != blockData.Height.RevisionHeight {
// 		return errorsmod.Wrap(ErrInvalidBlockData, "Verify: Invalid block data, slot or block not valid")
// 	}

// 	// check, calculate and store validator set for new epoch
// 	if cs.CurrentEpoch != blockData.EpochNo {
// 		newValidatorSet := CalValidatorsNewEpoch(clientStore, cs.CurrentEpoch, blockData.EpochNo)

// 		// verify
// 		if !newValidatorSetIsValid(newValidatorSet, vrfHex) {
// 			return errorsmod.Wrap(ErrInvalidSPOsNewEpoch, "Verify: Invalid signature")
// 		}

// 		// store
// 		setClientSPOs(clientStore, newValidatorSet, blockData.EpochNo)
// 	} else {
// 		oldValidatorSetBytes := clientStore.Get(ClientSPOsKey(cs.CurrentEpoch))
// 		oldValidatorSet := MustUnmarshalClientSPOs(oldValidatorSetBytes)
// 		// verify
// 		if !newValidatorSetIsValid(oldValidatorSet, vrfHex) {
// 			return errorsmod.Wrap(ErrInvalidSPOsNewEpoch, "Verify: Invalid signature")
// 		}
// 	}

// 	return nil
// }

// // calValidatorsNewEpoch calculate SPO for new epoch
// func CalValidatorsNewEpoch(clientStore storetypes.KVStore, oldEpoch, newEpoch uint64) []*Validator {
// 	// get SPO State
// 	spoState := getSPOState(clientStore, newEpoch)
// 	// calculate
// 	var newValidatorSet []*Validator
// 	if nextValidatorSet := getClientSPOs(clientStore, newEpoch); len(nextValidatorSet) > 0 {
// 		newValidatorSet = nextValidatorSet
// 	} else {
// 		// current validator set
// 		newValidatorSet = getClientSPOs(clientStore, oldEpoch)
// 	}

// 	if len(spoState) > 0 {
// 		newValidatorSet = applyStateChange(newValidatorSet, spoState)
// 	}

// 	return newValidatorSet
// }

// func applyStateChange(validatorSet []*Validator, spoStates []SPOState) []*Validator {
// 	result := validatorSet
// 	// sort to get correct order of regis or deregis
// 	sort.Slice(spoStates[:], func(i, j int) bool {
// 		var a, b big.Int
// 		if spoStates[i].BlockNo != spoStates[j].BlockNo {
// 			a.SetUint64(spoStates[i].BlockNo)
// 			b.SetUint64(spoStates[j].BlockNo)
// 		} else {
// 			a.SetUint64(spoStates[i].TxIndex)
// 			b.SetUint64(spoStates[j].TxIndex)
// 		}
// 		return a.Cmp(&b) == -1
// 	})

// 	// apply state changes
// 	for _, spoState := range spoStates {
// 		if spoState.IsRegisCert {
// 			result = append(result, &Validator{
// 				VrfKeyHash: spoState.PoolVrf,
// 				PoolId:     spoState.PoolId,
// 			})
// 		} else {
// 			tmp := make([]*Validator, 0)
// 			// remove validator
// 			for _, validator := range result {
// 				poolToRemove := strings.ToLower(spoState.PoolId)
// 				validatorPool := strings.ToLower(validator.PoolId)
// 				if poolToRemove != validatorPool {
// 					tmp = append(tmp, validator)
// 				}
// 			}
// 			result = tmp
// 		}
// 	}
// 	return result
// }

// func newValidatorSetIsValid(validatorSet []*Validator, vrfKHexString string) bool {
// 	if len(validatorSet) == 0 {
// 		return false
// 	}
// 	bytesVrfKey, err := hex.DecodeString(vrfKHexString)
// 	if err != nil {
// 		return false
// 	}
// 	hashBytesVrfKey := blake2b.Sum256(bytesVrfKey)
// 	for _, validator := range validatorSet {
// 		if strings.EqualFold(validator.VrfKeyHash, hex.EncodeToString(hashBytesVrfKey[:])) {
// 			return true
// 		}
// 	}
// 	return false
// }

// // UpdateState may be used to either create a consensus state for:
// // - a future height greater than the latest client state height
// // - a past height that was skipped during bisection
// // If we are updating to a past height, a consensus state is created for that height to be persisted in client store
// // If we are updating to a future height, the consensus state is created and the client state is updated to reflect
// // the new latest height
// // A list containing the updated consensus height is returned.
// // UpdateState must only be used to update within a single revision, thus header revision number and trusted height's revision
// // number must be the same. To update to a new revision, use a separate upgrade path
// // UpdateState will prune the oldest consensus state if it is expired.
// func (cs ClientState) UpdateState(ctx sdk.Context, cdc codec.BinaryCodec, clientStore storetypes.KVStore, clientMsg exported.ClientMessage) []exported.Height {
// 	blockData, ok := clientMsg.(*BlockData)
// 	if !ok {
// 		panic(fmt.Errorf("expected type %T, got %T", &BlockData{}, clientMsg))
// 	}

// 	cs.pruneOldestConsensusState(ctx, cdc, clientStore)

// 	// check for duplicate update
// 	if _, found := GetConsensusState(clientStore, cdc, blockData.GetHeight()); found {
// 		// perform no-op
// 		return []exported.Height{blockData.GetHeight()}
// 	}

// 	height := blockData.Height
// 	if height.GT(*cs.LatestHeight) {
// 		cs.LatestHeight = height
// 	}

// 	// update current epoch - TODO: check range need to update
// 	if cs.CurrentEpoch != blockData.EpochNo {
// 		// update ClientState
// 		cs.CurrentEpoch = blockData.EpochNo
// 		// TODO: update NextValidatorSet after set (maybe set when verify BlockData)
// 		// cs.CurrentValidatorSet = getClientSPOs(clientStore, blockData.EpochNo)
// 		// cs.NextValidatorSet = getClientSPOs(clientStore, blockData.EpochNo+1)
// 	}

// 	consensusState := &ConsensusState{
// 		Timestamp: uint64(blockData.GetTime().Unix()),
// 		Slot:      blockData.Slot,
// 	}

// 	// set client state, consensus state and associated metadata
// 	setClientState(clientStore, cdc, &cs)
// 	setConsensusState(clientStore, cdc, consensusState, blockData.GetHeight())
// 	setConsensusMetadata(ctx, clientStore, blockData.GetHeight())
// 	SetConsensusStateBlockHash(clientStore, blockData.GetHeight(), blockData.Hash)

// 	uTXOOutput, regisCerts, deRegisCerts, extractBlockError := ExtractBlockData(blockData.BodyCbor)
// 	if extractBlockError != nil {
// 		panic(fmt.Errorf("extractBlockError: %v", extractBlockError.Error()))
// 	}
// 	// update register cert
// 	UpdateRegisterCert(clientStore, regisCerts, blockData.EpochNo+2, blockData.Height.RevisionHeight)
// 	// update unregister cert
// 	UpdateUnregisterCert(clientStore, deRegisCerts, blockData.Height.RevisionHeight)

// 	// set UTXOs
// 	setUTXOs(ctx, *cs.TokenConfigs, clientStore, uTXOOutput, blockData.GetHeight())

// 	// emit event update validators set
// 	ctx.EventManager().EmitEvent(
// 		sdk.NewEvent("validators-set-updated",
// 			sdk.NewAttribute("register-cert", strings.Join(GetListRegisCertPoolId(regisCerts), ",")),
// 			sdk.NewAttribute("unregister-cert", strings.Join(GetListUnregisCertPoolId(deRegisCerts), ",")),
// 		),
// 	)
// 	return []exported.Height{height}
// }

// // pruneOldestConsensusState will retrieve the earliest consensus state for this clientID and check if it is expired. If it is,
// // that consensus state will be pruned from store along with all associated metadata. This will prevent the client store from
// // becoming bloated with expired consensus states that can no longer be used for updates and packet verification.
// func (cs ClientState) pruneOldestConsensusState(ctx sdk.Context, cdc codec.BinaryCodec, clientStore storetypes.KVStore) {
// 	// Check the earliest consensus state to see if it is expired, if so then set the prune height
// 	// so that we can delete consensus state and all associated metadata.
// 	var (
// 		pruneHeight exported.Height
// 	)

// 	pruneCb := func(height exported.Height) bool {
// 		consState, found := GetConsensusState(clientStore, cdc, height)
// 		// this error should never occur
// 		if !found {
// 			panic(errorsmod.Wrapf(clienttypes.ErrConsensusStateNotFound, "failed to retrieve consensus state at height: %s", height))
// 		}

// 		if cs.IsExpired(consState.GetTime(), ctx.BlockTime()) {
// 			pruneHeight = height
// 		}

// 		return true
// 	}

// 	IterateConsensusStateAscending(clientStore, pruneCb)

// 	// if pruneHeight is set, delete consensus state and metadata
// 	if pruneHeight != nil {
// 		deleteConsensusState(clientStore, pruneHeight)
// 		deleteConsensusMetadata(clientStore, pruneHeight)
// 	}
// }

// // UpdateStateOnMisbehaviour updates state upon misbehaviour, freezing the ClientState. This method should only be called when misbehaviour is detected
// // as it does not perform any misbehaviour checks.
// func (cs ClientState) UpdateStateOnMisbehaviour(ctx sdk.Context, cdc codec.BinaryCodec, clientStore storetypes.KVStore, _ exported.ClientMessage) {
// 	cs.FrozenHeight = &FrozenHeight

// 	clientStore.Set(host.ClientStateKey(), clienttypes.MustMarshalClientState(cdc, &cs))
// }
