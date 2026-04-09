package stability

import (
	"bytes"
	"encoding/hex"
	"strings"

	errorsmod "cosmossdk.io/errors"
	"github.com/blinklabs-io/gouroboros/cbor"
	"github.com/blinklabs-io/gouroboros/ledger"
	"golang.org/x/crypto/blake2b"
)

func (cs *ClientState) authenticateHeaderBlocks(header *StabilityHeader) error {
	if err := cs.authenticateStabilityBlock(header.AnchorBlock, "anchor"); err != nil {
		return err
	}

	for _, block := range header.BridgeBlocks {
		if err := cs.authenticateStabilityBlock(block, "bridge"); err != nil {
			return err
		}
	}

	for _, block := range header.DescendantBlocks {
		if err := cs.authenticateStabilityBlock(block, "descendant"); err != nil {
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
	decodedPrevHash, err := blockPrevHash(decodedBlock)
	if err != nil {
		return err
	}
	if !strings.EqualFold(decodedPrevHash, block.PrevHash) {
		return errorsmod.Wrapf(
			ErrInvalidAcceptedBlock,
			"%s block prev_hash mismatch: got %s expected %s",
			label,
			block.PrevHash,
			decodedPrevHash,
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

	decodedPoolID, decodedVrfKeyHash, err := cs.verifyNativeStabilityBlock(decodedBlock, label)
	if err != nil {
		return err
	}

	if block.SlotLeader != "" && decodedPoolID != "" && !strings.EqualFold(block.SlotLeader, decodedPoolID) {
		return errorsmod.Wrapf(
			ErrInvalidAcceptedBlock,
			"%s block slot leader mismatch: got %s expected %s",
			label,
			block.SlotLeader,
			decodedPoolID,
		)
	}

	stakeEntry, err := cs.findStakeDistributionEntry(decodedPoolID)
	if err != nil {
		return errorsmod.Wrapf(ErrInvalidCurrentEpoch, "%s block issuer %s is not trusted for current epoch", label, decodedPoolID)
	}
	if !bytes.Equal(stakeEntry.VrfKeyHash, decodedVrfKeyHash) {
		return errorsmod.Wrapf(
			ErrInvalidAcceptedBlock,
			"%s block VRF key hash mismatch for pool %s",
			label,
			decodedPoolID,
		)
	}

	block.SlotLeader = decodedPoolID

	return cs.verifyCurrentEpoch(block, label)
}

func (cs *ClientState) verifyNativeStabilityBlock(
	decodedBlock ledger.Block,
	label string,
) (string, []byte, error) {
	headerCborHex, bodyCborHex, vrfKeyBytes, err := buildBlockVerificationArtifacts(decodedBlock)
	if err != nil {
		return "", nil, errorsmod.Wrapf(ErrInvalidAcceptedBlock, "failed to build %s native verification payload: %v", label, err)
	}

	verifyErr, isValid, _, _, _ := ledger.VerifyBlock(ledger.BlockHexCbor{
		HeaderCbor:    headerCborHex,
		Eta0:          hex.EncodeToString(cs.EpochNonce),
		Spk:           int(cs.SlotsPerKesPeriod),
		BlockBodyCbor: bodyCborHex,
	})
	if verifyErr != nil {
		return "", nil, errorsmod.Wrapf(ErrInvalidAcceptedBlock, "native verification failed for %s block: %v", label, verifyErr)
	}
	if !isValid {
		return "", nil, errorsmod.Wrapf(ErrInvalidAcceptedBlock, "%s block failed native Cardano verification", label)
	}

	vrfKeyHash := blake2b.Sum256(vrfKeyBytes)
	return decodedBlock.IssuerVkey().PoolId(), vrfKeyHash[:], nil
}

func buildBlockVerificationArtifacts(decodedBlock ledger.Block) (string, string, []byte, error) {
	switch block := decodedBlock.(type) {
	case *ledger.BabbageBlock:
		bodyHex, err := encodeBabbageLikeBlockBodyHex(block.TransactionBodies, block.TransactionWitnessSets, block.TransactionMetadataSet)
		if err != nil {
			return "", "", nil, err
		}
		return hex.EncodeToString(block.Header.Cbor()), bodyHex, bytes.Clone(block.Header.Body.VrfKey), nil
	case *ledger.ConwayBlock:
		bodyHex, err := encodeBabbageLikeBlockBodyHex(block.TransactionBodies, block.TransactionWitnessSets, block.TransactionMetadataSet)
		if err != nil {
			return "", "", nil, err
		}
		return hex.EncodeToString(block.Header.Cbor()), bodyHex, bytes.Clone(block.Header.Body.VrfKey), nil
	default:
		return "", "", nil, errorsmod.Wrapf(ErrInvalidAcceptedBlock, "unsupported block era %T", decodedBlock)
	}
}

func blockPrevHash(decodedBlock ledger.Block) (string, error) {
	switch block := decodedBlock.(type) {
	case *ledger.BabbageBlock:
		return block.Header.Body.PrevHash.String(), nil
	case *ledger.ConwayBlock:
		return block.Header.Body.PrevHash.String(), nil
	default:
		return "", errorsmod.Wrapf(ErrInvalidAcceptedBlock, "unsupported block era %T", decodedBlock)
	}
}

func encodeBabbageLikeBlockBodyHex[Body any, Witness any](
	transactionBodies []Body,
	transactionWitnessSets []Witness,
	transactionMetadataSet map[uint]*cbor.LazyValue,
) (string, error) {
	txsRaw := make([][]string, 0, len(transactionBodies))
	for idx := range transactionBodies {
		bodyCbor, err := cbor.Encode(transactionBodies[idx])
		if err != nil {
			return "", err
		}
		witnessCbor, err := cbor.Encode(transactionWitnessSets[idx])
		if err != nil {
			return "", err
		}
		auxHex := ""
		if transactionMetadataSet != nil && transactionMetadataSet[uint(idx)] != nil {
			auxHex = hex.EncodeToString(transactionMetadataSet[uint(idx)].Cbor())
		}
		txsRaw = append(txsRaw, []string{
			hex.EncodeToString(bodyCbor),
			hex.EncodeToString(witnessCbor),
			auxHex,
		})
	}

	bodyCbor, err := cbor.Encode(txsRaw)
	if err != nil {
		return "", err
	}
	return hex.EncodeToString(bodyCbor), nil
}

func (cs *ClientState) findStakeDistributionEntry(poolID string) (*StakeDistributionEntry, error) {
	for _, entry := range cs.EpochStakeDistribution {
		if entry != nil && strings.EqualFold(entry.PoolId, poolID) {
			return entry, nil
		}
	}
	return nil, errorsmod.Wrapf(ErrInvalidCurrentEpoch, "pool %s not present in epoch stake distribution", poolID)
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
	if block.Slot < cs.CurrentEpochStartSlot || block.Slot >= cs.CurrentEpochEndSlotExclusive {
		return errorsmod.Wrapf(
			ErrInvalidCurrentEpoch,
			"%s block slot %d outside trusted epoch slot bounds [%d,%d)",
			label,
			block.Slot,
			cs.CurrentEpochStartSlot,
			cs.CurrentEpochEndSlotExclusive,
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
			txBodyCbor, bodyErr := extractTransactionBodyCbor(tx)
			if bodyErr != nil {
				return errorsmod.Wrapf(ErrInvalidHostStateCommitment, "failed to decode host state tx body: %v", bodyErr)
			}
			if !bytes.Equal(txBodyCbor, header.HostStateTxBodyCbor) {
				return errorsmod.Wrapf(
					ErrInvalidHostStateCommitment,
					"host state tx body does not match authenticated anchor block tx %s",
					header.HostStateTxHash,
				)
			}
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

func extractTransactionBodyCbor(tx ledger.Transaction) ([]byte, error) {
	switch typedTx := tx.(type) {
	case *ledger.BabbageTransaction:
		return typedTx.Body.Cbor(), nil
	case *ledger.ConwayTransaction:
		return typedTx.Body.Cbor(), nil
	default:
		return nil, errorsmod.Wrapf(ErrInvalidHostStateCommitment, "unsupported anchor transaction type %T", tx)
	}
}

func decodeLedgerBlock(blockCbor []byte) (ledger.Block, error) {
	blockType, err := ledger.DetermineBlockType(blockCbor)
	if err != nil {
		return nil, err
	}
	return ledger.NewBlockFromCbor(blockType, blockCbor)
}
