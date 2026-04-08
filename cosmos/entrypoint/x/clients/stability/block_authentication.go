package stability

import (
	"strings"

	errorsmod "cosmossdk.io/errors"
	"github.com/blinklabs-io/gouroboros/ledger"
)

func (cs *ClientState) authenticateHeaderBlocks(header *StabilityHeader) error {
	if err := cs.authenticateStabilityBlock(header.AnchorBlock, "anchor"); err != nil {
		return err
	}
	if err := cs.verifyCurrentEpoch(header.AnchorBlock, "anchor"); err != nil {
		return err
	}

	for _, block := range header.BridgeBlocks {
		if err := cs.authenticateStabilityBlock(block, "bridge"); err != nil {
			return err
		}
		if err := cs.verifyCurrentEpoch(block, "bridge"); err != nil {
			return err
		}
	}

	for _, block := range header.DescendantBlocks {
		if err := cs.authenticateStabilityBlock(block, "descendant"); err != nil {
			return err
		}
		if err := cs.verifyCurrentEpoch(block, "descendant"); err != nil {
			return err
		}
	}

	if err := verifyHostStateTxIncludedInAnchorBlock(header); err != nil {
		return err
	}

	return nil
}

func (cs *ClientState) authenticateStabilityBlock(block *StabilityBlock, label string) error {
	if block == nil || block.Height == nil {
		return errorsmod.Wrapf(ErrInvalidAcceptedBlock, "%s block missing height", label)
	}
	if len(block.BlockCbor) == 0 {
		return errorsmod.Wrapf(ErrInvalidAcceptedBlock, "%s block missing block_cbor", label)
	}

	decodedBlock, err := decodeLedgerBlock(block.BlockCbor)
	if err != nil {
		return errorsmod.Wrapf(ErrInvalidAcceptedBlock, "failed to decode %s block: %v", label, err)
	}

	if !strings.EqualFold(decodedBlock.Hash(), block.Hash) {
		return errorsmod.Wrapf(
			ErrInvalidAcceptedBlock,
			"%s block hash mismatch: got %s expected %s",
			label,
			block.Hash,
			decodedBlock.Hash(),
		)
	}
	if !strings.EqualFold(decodedBlock.PrevHash(), block.PrevHash) {
		return errorsmod.Wrapf(
			ErrInvalidAcceptedBlock,
			"%s block prev_hash mismatch: got %s expected %s",
			label,
			block.PrevHash,
			decodedBlock.PrevHash(),
		)
	}
	if decodedBlock.BlockNumber() != block.Height.RevisionHeight {
		return errorsmod.Wrapf(
			ErrInvalidAcceptedBlock,
			"%s block height mismatch: got %d expected %d",
			label,
			block.Height.RevisionHeight,
			decodedBlock.BlockNumber(),
		)
	}
	if decodedBlock.SlotNumber() != block.Slot {
		return errorsmod.Wrapf(
			ErrInvalidAcceptedBlock,
			"%s block slot mismatch: got %d expected %d",
			label,
			block.Slot,
			decodedBlock.SlotNumber(),
		)
	}

	decodedPoolID := decodedBlock.IssuerVkey().PoolId()
	if block.SlotLeader != "" && decodedPoolID != "" && !strings.EqualFold(block.SlotLeader, decodedPoolID) {
		return errorsmod.Wrapf(
			ErrInvalidAcceptedBlock,
			"%s block slot leader mismatch: got %s expected %s",
			label,
			block.SlotLeader,
			decodedPoolID,
		)
	}

	return nil
}

func (cs *ClientState) verifyCurrentEpoch(block *StabilityBlock, label string) error {
	if block == nil {
		return errorsmod.Wrapf(ErrInvalidAcceptedBlock, "%s block missing", label)
	}
	if block.Epoch != cs.CurrentEpoch {
		return errorsmod.Wrapf(
			ErrInvalidCurrentEpoch,
			"%s block epoch mismatch: got %d expected %d",
			label,
			block.Epoch,
			cs.CurrentEpoch,
		)
	}
	return nil
}

func verifyHostStateTxIncludedInAnchorBlock(header *StabilityHeader) error {
	decodedBlock, err := decodeLedgerBlock(header.AnchorBlock.BlockCbor)
	if err != nil {
		return errorsmod.Wrapf(ErrInvalidAcceptedBlock, "failed to decode anchor block: %v", err)
	}

	for _, tx := range decodedBlock.Transactions() {
		if strings.EqualFold(tx.Hash(), header.HostStateTxHash) {
			return nil
		}
	}

	return errorsmod.Wrapf(
		ErrInvalidHostStateCommitment,
		"host state tx %s not found in authenticated anchor block %s",
		header.HostStateTxHash,
		header.AnchorBlock.Hash,
	)
}

func decodeLedgerBlock(blockCbor []byte) (ledger.Block, error) {
	blockType, err := ledger.DetermineBlockType(blockCbor)
	if err != nil {
		return nil, err
	}
	return ledger.NewBlockFromCbor(blockType, blockCbor)
}
