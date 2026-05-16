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

type authenticatedStabilityBlock struct {
	height     uint64
	slot       uint64
	hash       string
	prevHash   string
	epoch      uint64
	timestamp  uint64
	slotLeader string
}

type authenticatedStabilityHeader struct {
	anchorBlock      *authenticatedStabilityBlock
	bridgeBlocks     []*authenticatedStabilityBlock
	descendantBlocks []*authenticatedStabilityBlock
}

func (cs *ClientState) authenticateHeaderBlocks(header *StabilityHeader) (*authenticatedStabilityHeader, error) {
	baseEpochContexts, err := cs.normalizedEpochContexts()
	if err != nil {
		return nil, err
	}
	epochContexts, err := mergeEpochContexts(baseEpochContexts, header.NewEpochContext)
	if err != nil {
		return nil, err
	}
	return cs.authenticateHeaderBlocksWithContexts(header, epochContexts)
}

func (cs *ClientState) authenticateHeaderBlocksWithContexts(header *StabilityHeader, epochContexts []*EpochContext) (*authenticatedStabilityHeader, error) {
	if header == nil {
		return nil, errorsmod.Wrap(ErrInvalidHeader, "stability header missing")
	}

	anchorBlock, err := cs.authenticateStabilityBlock(header.AnchorBlock, "anchor", epochContexts)
	if err != nil {
		return nil, err
	}

	bridgeBlocks := make([]*authenticatedStabilityBlock, 0, len(header.BridgeBlocks))
	for _, block := range header.BridgeBlocks {
		authenticatedBlock, authErr := cs.authenticateStabilityBlock(block, "bridge", epochContexts)
		if authErr != nil {
			return nil, authErr
		}
		bridgeBlocks = append(bridgeBlocks, authenticatedBlock)
	}

	descendantBlocks := make([]*authenticatedStabilityBlock, 0, len(header.DescendantBlocks))
	for _, block := range header.DescendantBlocks {
		authenticatedBlock, authErr := cs.authenticateStabilityBlock(block, "descendant", epochContexts)
		if authErr != nil {
			return nil, authErr
		}
		descendantBlocks = append(descendantBlocks, authenticatedBlock)
	}

	if err := verifyHostStateTxIncludedInAnchorBlock(header); err != nil {
		return nil, err
	}

	return &authenticatedStabilityHeader{
		anchorBlock:      anchorBlock,
		bridgeBlocks:     bridgeBlocks,
		descendantBlocks: descendantBlocks,
	}, nil
}

func (cs *ClientState) authenticateStabilityBlock(block *StabilityBlock, label string, epochContexts []*EpochContext) (*authenticatedStabilityBlock, error) {
	if block == nil || block.Height == nil {
		return nil, errorsmod.Wrapf(ErrInvalidAcceptedBlock, "%s block missing height", label)
	}
	if len(block.BlockCbor) == 0 {
		return nil, errorsmod.Wrapf(ErrInvalidAcceptedBlock, "%s block missing block_cbor", label)
	}

	decodedBlock, err := decodeLedgerBlock(block.BlockCbor)
	if err != nil {
		return nil, errorsmod.Wrapf(ErrInvalidAcceptedBlock, "failed to decode %s block: %v", label, err)
	}

	if !strings.EqualFold(decodedBlock.Hash(), block.Hash) {
		return nil, errorsmod.Wrapf(
			ErrInvalidAcceptedBlock,
			"%s block hash mismatch: got %s expected %s",
			label,
			block.Hash,
			decodedBlock.Hash(),
		)
	}
	decodedPrevHash, err := blockPrevHash(decodedBlock)
	if err != nil {
		return nil, err
	}
	if decodedBlock.BlockNumber() != block.Height.RevisionHeight {
		return nil, errorsmod.Wrapf(
			ErrInvalidAcceptedBlock,
			"%s block height mismatch: got %d expected %d",
			label,
			block.Height.RevisionHeight,
			decodedBlock.BlockNumber(),
		)
	}
	if decodedBlock.SlotNumber() != block.Slot {
		return nil, errorsmod.Wrapf(
			ErrInvalidAcceptedBlock,
			"%s block slot mismatch: got %d expected %d",
			label,
			block.Slot,
			decodedBlock.SlotNumber(),
		)
	}
	expectedTimestamp, err := cs.DeriveTimestampFromSlot(block.Slot)
	if err != nil {
		return nil, err
	}
	if block.Timestamp != expectedTimestamp {
		return nil, errorsmod.Wrapf(
			ErrInvalidTimestamp,
			"%s block timestamp mismatch: got %d expected %d",
			label,
			block.Timestamp,
			expectedTimestamp,
		)
	}
	epochContext := epochContextForSlot(epochContexts, decodedBlock.SlotNumber())
	if epochContext == nil {
		return nil, errorsmod.Wrapf(
			ErrInvalidCurrentEpoch,
			"%s block slot %d outside available epoch context bounds",
			label,
			decodedBlock.SlotNumber(),
		)
	}
	if block.Epoch != epochContext.Epoch {
		return nil, errorsmod.Wrapf(
			ErrInvalidCurrentEpoch,
			"%s block epoch mismatch: got %d expected %d",
			label,
			block.Epoch,
			epochContext.Epoch,
		)
	}
	if err := verifySlotWithinEpochContext(decodedBlock.SlotNumber(), epochContext, label); err != nil {
		return nil, err
	}

	decodedPoolID, decodedVrfKeyHash, err := cs.verifyNativeStabilityBlock(decodedBlock, label, epochContext)
	if err != nil {
		return nil, err
	}

	stakeEntry, err := findStakeDistributionEntryInContext(epochContext, decodedPoolID)
	if err != nil {
		return nil, errorsmod.Wrapf(ErrInvalidCurrentEpoch, "%s block issuer %s is not trusted for epoch %d", label, decodedPoolID, epochContext.Epoch)
	}
	if !bytes.Equal(stakeEntry.VrfKeyHash, decodedVrfKeyHash) {
		return nil, errorsmod.Wrapf(
			ErrInvalidAcceptedBlock,
			"%s block VRF key hash mismatch for pool %s",
			label,
			decodedPoolID,
		)
	}

	return &authenticatedStabilityBlock{
		height:     decodedBlock.BlockNumber(),
		slot:       decodedBlock.SlotNumber(),
		hash:       decodedBlock.Hash(),
		prevHash:   decodedPrevHash,
		epoch:      epochContext.Epoch,
		timestamp:  expectedTimestamp,
		slotLeader: decodedPoolID,
	}, nil
}

func (cs *ClientState) verifyNativeStabilityBlock(
	decodedBlock ledger.Block,
	label string,
	epochContext *EpochContext,
) (poolID string, vrfKeyHash []byte, err error) {
	defer func() {
		if recovered := recover(); recovered != nil {
			err = errorsmod.Wrapf(ErrInvalidAcceptedBlock, "native verification panicked for %s block: %v", label, recovered)
		}
	}()

	headerCborHex, bodyCborHex, vrfKeyBytes, err := buildBlockVerificationArtifacts(decodedBlock)
	if err != nil {
		return "", nil, errorsmod.Wrapf(ErrInvalidAcceptedBlock, "failed to build %s native verification payload: %v", label, err)
	}

	verifyErr, isValid, _, _, _ := ledger.VerifyBlock(ledger.BlockHexCbor{
		HeaderCbor:    headerCborHex,
		Eta0:          hex.EncodeToString(epochContext.EpochNonce),
		Spk:           int(epochContext.SlotsPerKesPeriod),
		BlockBodyCbor: bodyCborHex,
	})
	if verifyErr != nil {
		return "", nil, errorsmod.Wrapf(ErrInvalidAcceptedBlock, "native verification failed for %s block: %v", label, verifyErr)
	}
	if !isValid {
		return "", nil, errorsmod.Wrapf(ErrInvalidAcceptedBlock, "%s block failed native Cardano verification", label)
	}

	vrfKeyHashBytes := blake2b.Sum256(vrfKeyBytes)
	return decodedBlock.IssuerVkey().PoolId(), vrfKeyHashBytes[:], nil
}

func buildBlockVerificationArtifacts(decodedBlock ledger.Block) (string, string, []byte, error) {
	switch block := decodedBlock.(type) {
	case *ledger.BabbageBlock:
		bodyHex, err := encodeNativeVerifiedBlockBodyHex(
			len(block.TransactionBodies),
			func(idx int) []byte {
				return block.TransactionBodies[idx].Cbor()
			},
			func(idx int) []byte {
				return block.TransactionWitnessSets[idx].Cbor()
			},
			block.TransactionMetadataSet,
		)
		if err != nil {
			return "", "", nil, err
		}
		return hex.EncodeToString(block.Header.Cbor()), bodyHex, bytes.Clone(block.Header.Body.VrfKey), nil
	case *ledger.ConwayBlock:
		bodyHex, err := encodeNativeVerifiedBlockBodyHex(
			len(block.TransactionBodies),
			func(idx int) []byte {
				return block.TransactionBodies[idx].Cbor()
			},
			func(idx int) []byte {
				return block.TransactionWitnessSets[idx].Cbor()
			},
			block.TransactionMetadataSet,
		)
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

func encodeNativeVerifiedBlockBodyHex(
	txCount int,
	bodyCborAt func(int) []byte,
	witnessCborAt func(int) []byte,
	transactionMetadataSet map[uint]*cbor.LazyValue,
) (string, error) {
	txsRaw := make([][]string, 0, txCount)
	for idx := 0; idx < txCount; idx++ {
		auxHex := ""
		if transactionMetadataSet != nil && transactionMetadataSet[uint(idx)] != nil {
			auxHex = hex.EncodeToString(transactionMetadataSet[uint(idx)].Cbor())
		}
		txsRaw = append(txsRaw, []string{
			hex.EncodeToString(bodyCborAt(idx)),
			hex.EncodeToString(witnessCborAt(idx)),
			auxHex,
		})
	}

	bodyCbor, err := cbor.Encode(txsRaw)
	if err != nil {
		return "", err
	}
	return hex.EncodeToString(bodyCbor), nil
}

func findStakeDistributionEntryInContext(epochContext *EpochContext, poolID string) (*StakeDistributionEntry, error) {
	if epochContext == nil {
		return nil, errorsmod.Wrapf(ErrInvalidCurrentEpoch, "epoch context missing while resolving pool %s", poolID)
	}
	for _, entry := range epochContext.StakeDistribution {
		if entry != nil && strings.EqualFold(entry.PoolId, poolID) {
			return entry, nil
		}
	}
	return nil, errorsmod.Wrapf(ErrInvalidCurrentEpoch, "pool %s not present in epoch %d stake distribution", poolID, epochContext.Epoch)
}

func (cs *ClientState) findStakeDistributionEntry(poolID string) (*StakeDistributionEntry, error) {
	epochContexts, err := cs.normalizedEpochContexts()
	if err != nil {
		return nil, err
	}
	return findStakeDistributionEntryInContext(epochContextByEpoch(epochContexts, cs.CurrentEpoch), poolID)
}

func verifySlotWithinEpochContext(slot uint64, epochContext *EpochContext, label string) error {
	if epochContext == nil {
		return errorsmod.Wrapf(ErrInvalidCurrentEpoch, "%s block missing epoch context", label)
	}
	if slot < epochContext.EpochStartSlot || slot >= epochContext.EpochEndSlotExclusive {
		return errorsmod.Wrapf(
			ErrInvalidCurrentEpoch,
			"%s block slot %d outside trusted epoch %d slot bounds [%d,%d)",
			label,
			slot,
			epochContext.Epoch,
			epochContext.EpochStartSlot,
			epochContext.EpochEndSlotExclusive,
		)
	}
	return nil
}

func (cs *ClientState) verifyCurrentEpoch(slot uint64, label string) error {
	epochContexts, err := cs.normalizedEpochContexts()
	if err != nil {
		return err
	}
	return verifySlotWithinEpochContext(slot, epochContextByEpoch(epochContexts, cs.CurrentEpoch), label)
}

func verifyHostStateTxIncludedInAnchorBlock(header *StabilityHeader) error {
	_, err := extractHostStateTxBodyCborFromAnchorBlock(header)
	return err
}

func extractHostStateTxBodyCborFromAnchorBlock(header *StabilityHeader) ([]byte, error) {
	decodedBlock, err := decodeLedgerBlock(header.AnchorBlock.BlockCbor)
	if err != nil {
		return nil, errorsmod.Wrapf(ErrInvalidAcceptedBlock, "failed to decode anchor block: %v", err)
	}

	for _, tx := range decodedBlock.Transactions() {
		if strings.EqualFold(tx.Hash(), header.HostStateTxHash) {
			txBodyCbor, bodyErr := extractTransactionBodyCbor(tx)
			if bodyErr != nil {
				return nil, errorsmod.Wrapf(ErrInvalidHostStateCommitment, "failed to decode host state tx body: %v", bodyErr)
			}
			return txBodyCbor, nil
		}
	}

	return nil, errorsmod.Wrapf(
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
