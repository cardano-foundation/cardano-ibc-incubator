package state

import (
	"strings"

	errorsmod "cosmossdk.io/errors"
	storetypes "cosmossdk.io/store/types"
)

func (cs ClientState) CheckForMisbehaviour(ctx Context, cdc StateCodec, clientStore storetypes.KVStore, msg any) bool {
	switch msg := msg.(type) {
	case *ProbabilisticHeader:
		return headerConflictsWithStoredConsensus(clientStore, cdc, msg)
	case *Misbehaviour:
		return headersConflict(msg.ProbabilisticHeader1, msg.ProbabilisticHeader2) ||
			headerConflictsWithStoredConsensus(clientStore, cdc, msg.ProbabilisticHeader1) ||
			headerConflictsWithStoredConsensus(clientStore, cdc, msg.ProbabilisticHeader2)
	}

	return false
}

func (cs *ClientState) verifyMisbehaviour(ctx Context, clientStore storetypes.KVStore, cdc StateCodec, misbehaviour *Misbehaviour) error {
	return cs.verifyMisbehaviourWithAuthenticator(ctx, clientStore, cdc, misbehaviour, nil)
}

func (cs *ClientState) verifyMisbehaviourWithAuthenticator(
	ctx Context,
	clientStore storetypes.KVStore,
	cdc StateCodec,
	misbehaviour *Misbehaviour,
	authenticateHeader headerAuthenticator,
) error {
	if err := cs.verifyHeaderAgainstTrustedStateWithAuthenticator(ctx, clientStore, cdc, misbehaviour.ProbabilisticHeader1, authenticateHeader); err != nil {
		return errorsmod.Wrap(err, "verifying ProbabilisticHeader1 in Misbehaviour failed")
	}
	if err := cs.verifyHeaderAgainstTrustedStateWithAuthenticator(ctx, clientStore, cdc, misbehaviour.ProbabilisticHeader2, authenticateHeader); err != nil {
		return errorsmod.Wrap(err, "verifying ProbabilisticHeader2 in Misbehaviour failed")
	}
	if !headersConflict(misbehaviour.ProbabilisticHeader1, misbehaviour.ProbabilisticHeader2) &&
		!headerConflictsWithStoredConsensus(clientStore, cdc, misbehaviour.ProbabilisticHeader1) &&
		!headerConflictsWithStoredConsensus(clientStore, cdc, misbehaviour.ProbabilisticHeader2) {
		return errorsmod.Wrap(ErrIBCInvalidMisbehaviour, "probabilistic headers do not conflict")
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
	cdc StateCodec,
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
