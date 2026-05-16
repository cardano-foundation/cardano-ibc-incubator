package probabilistic

import (
	"strings"

	errorsmod "cosmossdk.io/errors"
	storetypes "cosmossdk.io/store/types"
	"github.com/cosmos/cosmos-sdk/codec"
	sdk "github.com/cosmos/cosmos-sdk/types"

	clienttypes "github.com/cosmos/ibc-go/v10/modules/core/02-client/types"
	"github.com/cosmos/ibc-go/v10/modules/core/exported"
)

func (cs ClientState) CheckForMisbehaviour(ctx sdk.Context, cdc codec.BinaryCodec, clientStore storetypes.KVStore, msg exported.ClientMessage) bool {
	switch msg := msg.(type) {
	case *ProbabilisticHeader:
		return headerConflictsWithStoredConsensus(clientStore, cdc, msg) ||
			cs.headerEpochContextConflictsWithStored(msg)
	case *Misbehaviour:
		return headersConflict(msg.ProbabilisticHeader1, msg.ProbabilisticHeader2) ||
			headersEpochContextConflict(msg.ProbabilisticHeader1, msg.ProbabilisticHeader2) ||
			headerConflictsWithStoredConsensus(clientStore, cdc, msg.ProbabilisticHeader1) ||
			headerConflictsWithStoredConsensus(clientStore, cdc, msg.ProbabilisticHeader2) ||
			cs.headerEpochContextConflictsWithStored(msg.ProbabilisticHeader1) ||
			cs.headerEpochContextConflictsWithStored(msg.ProbabilisticHeader2)
	}

	return false
}

func (cs *ClientState) verifyMisbehaviour(_ sdk.Context, clientStore storetypes.KVStore, cdc codec.BinaryCodec, misbehaviour *Misbehaviour) error {
	if err := cs.verifyHeaderAgainstTrustedState(clientStore, cdc, misbehaviour.ProbabilisticHeader1); err != nil {
		return errorsmod.Wrap(err, "verifying ProbabilisticHeader1 in Misbehaviour failed")
	}
	if err := cs.verifyHeaderAgainstTrustedState(clientStore, cdc, misbehaviour.ProbabilisticHeader2); err != nil {
		return errorsmod.Wrap(err, "verifying ProbabilisticHeader2 in Misbehaviour failed")
	}
	if !headersConflict(misbehaviour.ProbabilisticHeader1, misbehaviour.ProbabilisticHeader2) &&
		!headersEpochContextConflict(misbehaviour.ProbabilisticHeader1, misbehaviour.ProbabilisticHeader2) &&
		!headerConflictsWithStoredConsensus(clientStore, cdc, misbehaviour.ProbabilisticHeader1) &&
		!headerConflictsWithStoredConsensus(clientStore, cdc, misbehaviour.ProbabilisticHeader2) &&
		!cs.headerEpochContextConflictsWithStored(misbehaviour.ProbabilisticHeader1) &&
		!cs.headerEpochContextConflictsWithStored(misbehaviour.ProbabilisticHeader2) {
		return errorsmod.Wrap(clienttypes.ErrInvalidMisbehaviour, "probabilistic headers do not conflict")
	}
	return nil
}

func headersConflict(header1, header2 *ProbabilisticHeader) bool {
	if header1 == nil || header2 == nil {
		return false
	}

	if header1.GetHeight().EQ(header2.GetHeight()) {
		return !strings.EqualFold(header1.AnchorBlock.Hash, header2.AnchorBlock.Hash)
	}

	header1Blocks := collectHeaderBlocksByHeight(header1)
	header2Blocks := collectHeaderBlocksByHeight(header2)
	for height, hash1 := range header1Blocks {
		hash2, found := header2Blocks[height]
		if found && !strings.EqualFold(hash1, hash2) {
			return true
		}
	}

	return false
}

func headersEpochContextConflict(header1, header2 *ProbabilisticHeader) bool {
	if header1 == nil || header2 == nil || header1.NewEpochContext == nil || header2.NewEpochContext == nil {
		return false
	}
	if header1.NewEpochContext.Epoch != header2.NewEpochContext.Epoch {
		return false
	}
	return !epochContextsEqual(header1.NewEpochContext, header2.NewEpochContext)
}

func (cs ClientState) headerEpochContextConflictsWithStored(header *ProbabilisticHeader) bool {
	if header == nil || header.NewEpochContext == nil {
		return false
	}

	contexts, err := cs.normalizedEpochContexts()
	if err != nil {
		return false
	}
	stored := epochContextByEpoch(contexts, header.NewEpochContext.Epoch)
	return stored != nil && !epochContextsEqual(stored, header.NewEpochContext)
}

func collectHeaderBlocksByHeight(header *ProbabilisticHeader) map[uint64]string {
	blocksByHeight := make(map[uint64]string)
	if header == nil {
		return blocksByHeight
	}

	appendBlock := func(block *ProbabilisticBlock) {
		if block == nil || block.Height == nil {
			return
		}
		blocksByHeight[block.Height.RevisionHeight] = block.Hash
	}

	for _, block := range header.BridgeBlocks {
		appendBlock(block)
	}
	appendBlock(header.AnchorBlock)
	for _, block := range header.DescendantBlocks {
		appendBlock(block)
	}

	return blocksByHeight
}

func headerConflictsWithStoredConsensus(
	clientStore storetypes.KVStore,
	cdc codec.BinaryCodec,
	header *ProbabilisticHeader,
) bool {
	if header == nil {
		return false
	}

	for height, hash := range collectHeaderBlocksByHeight(header) {
		consensusState, found := GetConsensusState(clientStore, cdc, NewHeight(0, height))
		if found && !strings.EqualFold(consensusState.AcceptedBlockHash, hash) {
			return true
		}
	}

	return false
}
