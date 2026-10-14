package state

import (
	"strings"

	errorsmod "cosmossdk.io/errors"
	storetypes "cosmossdk.io/store/types"
)

func (cs ClientState) CheckForMisbehaviour(ctx Context, cdc StateCodec, clientStore storetypes.KVStore, msg any) bool {
	if cs.StorageVersion == StorageVersionSharedSnapshots {
		if evidence, ok := msg.(*Misbehaviour); ok {
			conflict, err := cs.verifiedReceiptConflict(ctx, evidence)
			return err == nil && conflict
		}
		return false
	}
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
	if cs.StorageVersion == StorageVersionSharedSnapshots {
		conflict, err := cs.verifiedReceiptConflict(ctx, misbehaviour)
		if err != nil {
			return err
		}
		if !conflict {
			return ErrIBCInvalidMisbehaviour
		}
		return nil
	}
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

	header1Blocks := collectSettledHeaderBlocksByHeight(header1)
	header2Blocks := collectSettledHeaderBlocksByHeight(header2)
	for height, hash1 := range header1Blocks {
		hash2, found := header2Blocks[height]
		if found && !strings.EqualFold(hash1, hash2) {
			return true
		}
	}

	return false
}

// A verified header settles its anchor and the ancestry leading to it. Its
// descendants establish settlement depth but do not themselves make settled
// claims. A difference in that temporary suffix is not misbehaviour, even when
// another observation or stored consensus state settles a higher block.
func collectSettledHeaderBlocksByHeight(header *ProbabilisticHeader) map[uint64]string {
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

	// The first committed block authenticates its predecessor too. Include
	// that hash so an earlier anchor at the later header's trusted checkpoint
	// remains comparable, including when that checkpoint has no IBC root.
	first := header.AnchorBlock
	if len(header.BridgeBlocks) > 0 {
		first = header.BridgeBlocks[0]
	}
	if first != nil && first.Height != nil && header.TrustedHeight != nil &&
		first.Height.RevisionHeight > 0 && first.Height.RevisionHeight-1 == header.TrustedHeight.RevisionHeight {
		decoded, err := decodeLedgerBlock(first.BlockCbor)
		if err == nil {
			if previousHash, err := blockPrevHash(decoded); err == nil {
				blocksByHeight[header.TrustedHeight.RevisionHeight] = previousHash
			}
		}
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

	for height, hash := range collectSettledHeaderBlocksByHeight(header) {
		consensusState, found := GetConsensusState(clientStore, cdc, NewHeight(0, height))
		if found && !strings.EqualFold(consensusState.AcceptedBlockHash, hash) {
			return true
		}
	}

	return false
}
