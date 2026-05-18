package probabilistic

import (
	"bytes"
	"encoding/hex"
	"strings"

	errorsmod "cosmossdk.io/errors"
	"github.com/blinklabs-io/gouroboros/cbor"
	"github.com/blinklabs-io/gouroboros/ledger"
	probabilisticcore "github.com/cardano-foundation/cardano-ibc-incubator/cosmos/cardano-probabilistic-light-client-core"
	"golang.org/x/crypto/blake2b"
)

type authenticatedProbabilisticBlock struct {
	height     uint64
	slot       uint64
	hash       string
	prevHash   string
	epoch      uint64
	timestamp  uint64
	slotLeader string
}

type authenticatedProbabilisticHeader struct {
	anchorBlock      *authenticatedProbabilisticBlock
	bridgeBlocks     []*authenticatedProbabilisticBlock
	descendantBlocks []*authenticatedProbabilisticBlock
}

func (cs *ClientState) authenticateHeaderBlocks(header *ProbabilisticHeader) (*authenticatedProbabilisticHeader, error) {
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

func (cs *ClientState) authenticateHeaderBlocksWithContexts(header *ProbabilisticHeader, epochContexts []*EpochContext) (*authenticatedProbabilisticHeader, error) {
	if header == nil {
		return nil, errorsmod.Wrap(ErrInvalidHeader, "probabilistic header missing")
	}

	anchorBlock, err := cs.authenticateProbabilisticBlock(header.AnchorBlock, "anchor", epochContexts)
	if err != nil {
		return nil, err
	}

	bridgeBlocks := make([]*authenticatedProbabilisticBlock, 0, len(header.BridgeBlocks))
	for _, block := range header.BridgeBlocks {
		authenticatedBlock, authErr := cs.authenticateProbabilisticBlock(block, "bridge", epochContexts)
		if authErr != nil {
			return nil, authErr
		}
		bridgeBlocks = append(bridgeBlocks, authenticatedBlock)
	}

	descendantBlocks := make([]*authenticatedProbabilisticBlock, 0, len(header.DescendantBlocks))
	for _, block := range header.DescendantBlocks {
		authenticatedBlock, authErr := cs.authenticateProbabilisticBlock(block, "descendant", epochContexts)
		if authErr != nil {
			return nil, authErr
		}
		descendantBlocks = append(descendantBlocks, authenticatedBlock)
	}

	if err := verifyHostStateTxIncludedInAnchorBlock(header); err != nil {
		return nil, err
	}

	return &authenticatedProbabilisticHeader{
		anchorBlock:      anchorBlock,
		bridgeBlocks:     bridgeBlocks,
		descendantBlocks: descendantBlocks,
	}, nil
}

func (cs *ClientState) authenticateProbabilisticBlock(block *ProbabilisticBlock, label string, epochContexts []*EpochContext) (*authenticatedProbabilisticBlock, error) {
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

	decodedPoolID, decodedVrfKeyHash, err := cs.verifyNativeProbabilisticBlock(decodedBlock, label, epochContext)
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

	return &authenticatedProbabilisticBlock{
		height:     decodedBlock.BlockNumber(),
		slot:       decodedBlock.SlotNumber(),
		hash:       decodedBlock.Hash(),
		prevHash:   decodedPrevHash,
		epoch:      epochContext.Epoch,
		timestamp:  expectedTimestamp,
		slotLeader: decodedPoolID,
	}, nil
}

func (cs *ClientState) verifyNativeProbabilisticBlock(
	decodedBlock ledger.Block,
	label string,
	epochContext *EpochContext,
) (poolID string, vrfKeyHash []byte, err error) {
	defer func() {
		if recovered := recover(); recovered != nil {
			err = errorsmod.Wrapf(ErrInvalidAcceptedBlock, "native verification panicked for %s block: %v", label, recovered)
		}
	}()

	headerCborHex, bodyCborHex, vrfKeyBytes, err := probabilisticcore.BuildBlockVerificationArtifacts(decodedBlock)
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
	return probabilisticcore.BuildBlockVerificationArtifacts(decodedBlock)
}

func blockPrevHash(decodedBlock ledger.Block) (string, error) {
	prevHash, err := probabilisticcore.BlockPrevHash(decodedBlock)
	if err != nil {
		return "", errorsmod.Wrap(ErrInvalidAcceptedBlock, err.Error())
	}
	return prevHash, nil
}

func encodeNativeVerifiedBlockBodyHex(
	txCount int,
	bodyCborAt func(int) []byte,
	witnessCborAt func(int) []byte,
	transactionMetadataSet map[uint]*cbor.LazyValue,
) (string, error) {
	return probabilisticcore.EncodeNativeVerifiedBlockBodyHex(txCount, bodyCborAt, witnessCborAt, transactionMetadataSet)
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

func verifyHostStateTxIncludedInAnchorBlock(header *ProbabilisticHeader) error {
	_, err := extractHostStateTxBodyCborFromAnchorBlock(header)
	return err
}

func extractHostStateTxBodyCborFromAnchorBlock(header *ProbabilisticHeader) ([]byte, error) {
	txBodyCbor, err := probabilisticcore.ExtractHostStateTxBodyCborFromAnchorBlock(header.AnchorBlock.BlockCbor, header.HostStateTxHash)
	if err != nil {
		return nil, errorsmod.Wrap(ErrInvalidHostStateCommitment, err.Error())
	}
	return txBodyCbor, nil
}

func extractTransactionBodyCbor(tx ledger.Transaction) ([]byte, error) {
	txBodyCbor, err := probabilisticcore.ExtractTransactionBodyCbor(tx)
	if err != nil {
		return nil, errorsmod.Wrap(ErrInvalidHostStateCommitment, err.Error())
	}
	return txBodyCbor, nil
}

func decodeLedgerBlock(blockCbor []byte) (ledger.Block, error) {
	return probabilisticcore.DecodeLedgerBlock(blockCbor)
}
