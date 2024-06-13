package mithril

import (
	"fmt"
	"time"

	errorsmod "cosmossdk.io/errors"
	storetypes "cosmossdk.io/store/types"
	"github.com/cosmos/cosmos-sdk/codec"
	sdk "github.com/cosmos/cosmos-sdk/types"
	clienttypes "github.com/cosmos/ibc-go/v8/modules/core/02-client/types"
	host "github.com/cosmos/ibc-go/v8/modules/core/24-host"
	"github.com/cosmos/ibc-go/v8/modules/core/exported"
)

// VerifyClientMessage checks if the clientMessage is of type MithrilHeader or Misbehaviour and verifies the message
func (cs *ClientState) VerifyClientMessage(
	ctx sdk.Context, cdc codec.BinaryCodec, clientStore storetypes.KVStore,
	clientMsg exported.ClientMessage,
) error {
	switch msg := clientMsg.(type) {
	case *MithrilHeader:
		return cs.verifyHeader(ctx, clientStore, cdc, msg)
	case *Misbehaviour:
		return cs.verifyMisbehaviour(ctx, clientStore, cdc, msg)
	default:
		return clienttypes.ErrInvalidClientType
	}
}

func (cs *ClientState) verifyHeader(
	_ sdk.Context, clientStore storetypes.KVStore, _ codec.BinaryCodec,
	header *MithrilHeader,
) error {
	nilCertificate := MithrilCertificate{}
	expectedPreviousCerForTs := nilCertificate

	firstCertInEpoch := getFcInEpoch(clientStore, header.MithrilStakeDistribution.Epoch)
	firstCertInPrevEpoch := getFcInEpoch(clientStore, header.MithrilStakeDistribution.Epoch-1)

	if firstCertInEpoch != nilCertificate {
		if header.MithrilStakeDistribution.CertificateHash != firstCertInEpoch.Hash {
			return errorsmod.Wrapf(ErrInvalidCertificate, "%s received: %v, expected: %v", "invalid latest mithril state distribution certificate:", header.MithrilStakeDistribution.CertificateHash, firstCertInEpoch.Hash)
		}
		expectedPreviousCerForTs = firstCertInEpoch
	} else {
		if firstCertInPrevEpoch == nilCertificate {
			return errorsmod.Wrapf(ErrInvalidCertificate, "prev epoch didn't store first mithril stake distribution certificate")
		}
		expectedPreviousCerForTs = *header.MithrilStakeDistributionCertificate
		if header.MithrilStakeDistributionCertificate.PreviousHash != firstCertInPrevEpoch.Hash {
			return errorsmod.Wrapf(ErrInvalidCertificate, "%s received: %v, expected: %v", "invalid first mithril state distribution certificate ", header.MithrilStakeDistributionCertificate.PreviousHash, firstCertInPrevEpoch.Hash)
		}
	}

	if header.TransactionSnapshotCertificate.PreviousHash != expectedPreviousCerForTs.Hash {
		return errorsmod.Wrapf(ErrInvalidCertificate, "%s received: %v, expected: %v", "invalid first transaction snapshot certificate", header.TransactionSnapshotCertificate.PreviousHash, expectedPreviousCerForTs.Hash)
	}

	_, err := time.Parse(Layout, header.TransactionSnapshotCertificate.Metadata.SealedAt)
	if err != nil {
		return errorsmod.Wrapf(ErrInvalidTimestamp, "%s received: %v, expected: %v", "invalid timestamp layout", header.TransactionSnapshotCertificate.Metadata.SealedAt, Layout)
	}

	err = header.MithrilStakeDistributionCertificate.verifyCertificate()
	if err != nil {
		return errorsmod.Wrapf(ErrInvalidCertificate, "mithril state distribution certificate is invalid")
	}

	err = header.TransactionSnapshotCertificate.verifyCertificate()
	if err != nil {
		return errorsmod.Wrapf(ErrInvalidCertificate, "transaction snapshot certificate is invalid")
	}
	return nil
}

func (c *MithrilCertificate) verifyCertificate() error {
	// TO-DO: not implemented
	return nil
}

func (cs *ClientState) UpdateState(
	ctx sdk.Context,
	cdc codec.BinaryCodec,
	clientStore storetypes.KVStore,
	clientMsg exported.ClientMessage,
) []exported.Height {
	// Type assert the client message to MithrilHeader
	header, ok := clientMsg.(*MithrilHeader)
	if !ok {
		panic(fmt.Errorf("expected type %T, got %T", &MithrilHeader{}, clientMsg))
	}

	cs.pruneOldestConsensusState(ctx, cdc, clientStore)

	// Retrieve the previous consensus state
	prevConsensusState, _ := GetConsensusState(clientStore, cdc, cs.LatestHeight)

	// Check for duplicate update
	if prevConsensusState.LatestCertHashTxSnapshot == header.TransactionSnapshotCertificate.Hash {
		return []exported.Height{header.GetHeight()} // No-op on duplicate update
	}

	// Update the latest height and current epoch
	height := NewHeight(0, header.TransactionSnapshot.BlockNumber)
	cs.LatestHeight = &height
	cs.CurrentEpoch = header.TransactionSnapshot.Epoch

	// Create a new consensus state
	newConsensusState := &ConsensusState{
		Timestamp:                header.GetTimestamp(),
		FirstCertHashLatestEpoch: header.MithrilStakeDistributionCertificate.Hash,
		LatestCertHashTxSnapshot: header.TransactionSnapshotCertificate.Hash,
	}

	// Set the latest certificate of transaction snapshot for the epoch
	setLcTsInEpoch(clientStore, *header.TransactionSnapshotCertificate, cs.CurrentEpoch)

	// Update the client state, consensus state, and associated metadata in the store
	setClientState(clientStore, cdc, cs)
	setConsensusState(clientStore, cdc, newConsensusState, header.GetHeight())
	setConsensusMetadata(ctx, clientStore, header.GetHeight())

	return []exported.Height{height}
}

// pruneOldestConsensusState will retrieve the earliest consensus state for this clientID and check if it is expired. If it is,
// that consensus state will be pruned from store along with all associated metadata. This will prevent the client store from
// becoming bloated with expired consensus states that can no longer be used for updates and packet verification.
func (cs ClientState) pruneOldestConsensusState(ctx sdk.Context, cdc codec.BinaryCodec, clientStore storetypes.KVStore) {
	// Check the earliest consensus state to see if it is expired, if so then set the prune height
	// so that we can delete consensus state and all associated metadata.
	var (
		pruneHeight exported.Height
	)

	pruneCb := func(height exported.Height) bool {
		consState, found := GetConsensusState(clientStore, cdc, height)
		// this error should never occur
		if !found {
			panic(errorsmod.Wrapf(clienttypes.ErrConsensusStateNotFound, "failed to retrieve consensus state at height: %s", height))
		}

		if cs.IsExpired(consState.GetTimestamp(), ctx.BlockTime()) {
			pruneHeight = height
		}

		return true
	}

	IterateConsensusStateAscending(clientStore, pruneCb)

	// if pruneHeight is set, delete consensus state and metadata
	if pruneHeight != nil {
		deleteConsensusState(clientStore, pruneHeight)
		deleteConsensusMetadata(clientStore, pruneHeight)
	}
}

// UpdateStateOnMisbehaviour updates state upon misbehaviour, freezing the ClientState. This method should only be called when misbehaviour is detected
// as it does not perform any misbehaviour checks.
func (cs ClientState) UpdateStateOnMisbehaviour(ctx sdk.Context, cdc codec.BinaryCodec, clientStore storetypes.KVStore, _ exported.ClientMessage) {
	// cs.FrozenHeight = &FrozenHeight
	clientStore.Set(host.ClientStateKey(), clienttypes.MustMarshalClientState(cdc, &cs))
}
