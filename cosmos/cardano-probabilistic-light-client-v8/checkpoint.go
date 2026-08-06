package probabilistic

import (
	"strings"

	errorsmod "cosmossdk.io/errors"
	storetypes "cosmossdk.io/store/types"
	"github.com/cosmos/cosmos-sdk/codec"
	clienttypes "github.com/cosmos/ibc-go/v8/modules/core/02-client/types"
)

// trustedBlockState is the authenticated Cardano block cursor used to verify
// continuity. It is deliberately separate from an IBC consensus state: a
// checkpoint has no HostState commitment root and cannot verify IBC proofs.
type trustedBlockState struct {
	height    *Height
	blockHash string
	epoch     uint64
}

func (cs ClientState) validateCheckpointFields() error {
	if cs.LatestCheckpointHeight == nil || cs.LatestCheckpointHeight.IsZero() {
		if cs.LatestCheckpointBlockHash != "" || cs.LatestCheckpointEpoch != 0 {
			return errorsmod.Wrap(ErrInvalidHeaderHeight, "checkpoint hash and epoch require a checkpoint height")
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
		state := &trustedBlockState{
			height:    NewHeight(height.RevisionNumber, height.RevisionHeight),
			blockHash: cs.LatestCheckpointBlockHash,
			epoch:     cs.LatestCheckpointEpoch,
		}
		if cs.LatestHeight != nil && height.EQ(cs.LatestHeight) {
			consensusState, found := GetConsensusState(clientStore, cdc, height)
			if !found {
				return nil, errorsmod.Wrapf(clienttypes.ErrConsensusStateNotFound, "height (%s)", height.String())
			}
			if !strings.EqualFold(state.blockHash, consensusState.AcceptedBlockHash) || state.epoch != consensusState.AcceptedEpoch {
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
	return &trustedBlockState{
		height:    NewHeight(height.RevisionNumber, height.RevisionHeight),
		blockHash: consensusState.AcceptedBlockHash,
		epoch:     consensusState.AcceptedEpoch,
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
	cs.setLatestCheckpoint(NewHeight(0, anchor.height), anchor.hash, anchor.epoch)
	setClientState(clientStore, cdc, cs)
	return nil
}
