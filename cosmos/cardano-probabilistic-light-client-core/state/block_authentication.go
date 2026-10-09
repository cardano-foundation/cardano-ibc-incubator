package state

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
	height                               uint64
	slot                                 uint64
	hash                                 string
	prevHash                             string
	bodyHash                             string
	epoch                                uint64
	timestamp                            uint64
	slotLeader                           string
	operationalCertificateSequenceNumber uint64
}

type authenticatedProbabilisticHeader struct {
	anchorBlock                          *authenticatedProbabilisticBlock
	bridgeBlocks                         []*authenticatedProbabilisticBlock
	descendantBlocks                     []*authenticatedProbabilisticBlock
	anchorOperationalCertificateCounters []*OperationalCertificateCounter
	anchorNonceState                     *PraosNonceState
	anchorPoolRegistry                   *PoolRegistryState
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
	trustedCounters, err := operationalCertificateCounterMap(cs.LatestCheckpointOperationalCertificateCounters)
	if err != nil {
		return nil, err
	}
	return cs.authenticateHeaderBlocksWithContexts(header, epochContexts, trustedCounters, &trustedBlockState{height: cs.LatestCheckpointHeight, blockHash: cs.LatestCheckpointBlockHash, slot: cs.LatestCheckpointSlot, epoch: cs.LatestCheckpointEpoch, nonceState: cs.LatestCheckpointNonceState, poolRegistry: cs.LatestCheckpointPoolRegistry})
}

func (cs *ClientState) authenticateHeaderBlocksWithContexts(
	header *ProbabilisticHeader,
	epochContexts []*EpochContext,
	trustedCounters map[string]uint64,
	trusted *trustedBlockState,
) (*authenticatedProbabilisticHeader, error) {
	if header == nil {
		return nil, errorsmod.Wrap(ErrInvalidHeader, "probabilistic header missing")
	}
	if cs.RandomnessStabilisationWindowSlots == 0 {
		return nil, errorsmod.Wrap(ErrIBCInvalidClient, "randomness_stabilisation_window_slots must be configured")
	}
	if err := cs.validateEpochContextParameters(epochContexts); err != nil {
		return nil, err
	}
	tracker, err := newNonceTracker(trusted)
	if err != nil {
		return nil, err
	}
	registry, err := newPoolRegistryTracker(trusted.poolRegistry, trusted.epoch, trusted.slot)
	if err != nil {
		return nil, err
	}
	counters := make(map[string]uint64, len(trustedCounters))
	for poolID, sequenceNumber := range trustedCounters {
		counters[strings.ToLower(poolID)] = sequenceNumber
	}

	bridgeBlocks := make([]*authenticatedProbabilisticBlock, 0, len(header.BridgeBlocks))
	for _, block := range header.BridgeBlocks {
		authenticatedBlock, authErr := cs.authenticateProbabilisticBlock(block, "bridge", epochContexts, counters, true, tracker, registry)
		if authErr != nil {
			return nil, authErr
		}
		bridgeBlocks = append(bridgeBlocks, authenticatedBlock)
	}

	anchorBlock, err := cs.authenticateProbabilisticBlock(
		header.AnchorBlock,
		"anchor",
		epochContexts,
		counters,
		true,
		tracker,
		registry,
	)
	if err != nil {
		return nil, err
	}
	anchorCounters := operationalCertificateCountersFromMap(counters)
	anchorNonceState := clonePraosNonceState(tracker.state)
	anchorPoolRegistry := clonePoolRegistry(registry.state)

	descendantBlocks := make([]*authenticatedProbabilisticBlock, 0, len(header.DescendantBlocks))
	for _, block := range header.DescendantBlocks {
		authenticatedBlock, authErr := cs.authenticateProbabilisticBlock(block, "descendant", epochContexts, counters, false, tracker, registry)
		if authErr != nil {
			return nil, authErr
		}
		descendantBlocks = append(descendantBlocks, authenticatedBlock)
	}

	if header.HostStateTxHash != "" {
		if err := verifyHostStateTxIncludedInAnchorBlock(header); err != nil {
			return nil, err
		}
	}

	return &authenticatedProbabilisticHeader{
		anchorBlock:                          anchorBlock,
		bridgeBlocks:                         bridgeBlocks,
		descendantBlocks:                     descendantBlocks,
		anchorOperationalCertificateCounters: anchorCounters,
		anchorNonceState:                     anchorNonceState,
		anchorPoolRegistry:                   anchorPoolRegistry,
	}, nil
}

func (cs *ClientState) authenticateProbabilisticBlock(
	block *ProbabilisticBlock,
	label string,
	epochContexts []*EpochContext,
	operationalCertificateCounters map[string]uint64,
	requireFullBlock bool,
	tracker *nonceTracker,
	registry *poolRegistryTracker,
) (*authenticatedProbabilisticBlock, error) {
	if block == nil || block.Height == nil {
		return nil, errorsmod.Wrapf(ErrInvalidAcceptedBlock, "%s block missing height", label)
	}
	hasFullBlock := len(block.BlockCbor) > 0
	hasHeader := len(block.HeaderCbor) > 0
	if hasFullBlock && hasHeader {
		return nil, errorsmod.Wrapf(ErrInvalidAcceptedBlock, "%s block cannot contain both block_cbor and header_cbor", label)
	}
	if requireFullBlock && !hasFullBlock {
		return nil, errorsmod.Wrapf(ErrInvalidAcceptedBlock, "%s block requires full block_cbor", label)
	}
	if !hasFullBlock && !hasHeader {
		return nil, errorsmod.Wrapf(ErrInvalidAcceptedBlock, "%s block missing block_cbor or header_cbor", label)
	}

	var decodedBlock ledger.Block
	var decodedHeader ledger.BlockHeader
	var rawHeader *ledger.BabbageBlockHeader
	if hasFullBlock {
		var err error
		decodedBlock, err = decodeLedgerBlock(block.BlockCbor)
		if err != nil {
			return nil, errorsmod.Wrapf(ErrInvalidAcceptedBlock, "failed to decode %s block: %v", label, err)
		}
		decodedHeader = decodedBlock
	} else {
		var err error
		rawHeader, err = probabilisticcore.DecodeLedgerHeader(block.HeaderCbor)
		if err != nil {
			return nil, errorsmod.Wrapf(ErrInvalidAcceptedBlock, "failed to decode %s header: %v", label, err)
		}
		decodedHeader = rawHeader
	}

	if !strings.EqualFold(decodedHeader.Hash().String(), block.Hash) {
		return nil, errorsmod.Wrapf(
			ErrInvalidAcceptedBlock,
			"%s block hash mismatch: got %s expected %s",
			label,
			block.Hash,
			decodedHeader.Hash().String(),
		)
	}
	var decodedPrevHash string
	var decodedBodyHash string
	if decodedBlock != nil {
		var err error
		decodedPrevHash, err = blockPrevHash(decodedBlock)
		if err != nil {
			return nil, err
		}
		decodedBodyHash, err = probabilisticcore.BlockBodyHash(decodedBlock)
		if err != nil {
			return nil, errorsmod.Wrap(ErrInvalidAcceptedBlock, err.Error())
		}
	} else {
		decodedPrevHash = probabilisticcore.HeaderPrevHash(rawHeader)
		decodedBodyHash = probabilisticcore.HeaderBodyHash(rawHeader)
	}
	if decodedHeader.BlockNumber() != block.Height.RevisionHeight {
		return nil, errorsmod.Wrapf(
			ErrInvalidAcceptedBlock,
			"%s block height mismatch: got %d expected %d",
			label,
			block.Height.RevisionHeight,
			decodedHeader.BlockNumber(),
		)
	}
	if decodedHeader.SlotNumber() != block.Slot {
		return nil, errorsmod.Wrapf(
			ErrInvalidAcceptedBlock,
			"%s block slot mismatch: got %d expected %d",
			label,
			block.Slot,
			decodedHeader.SlotNumber(),
		)
	}
	expectedTimestamp, err := cs.DeriveTimestampFromSlot(decodedHeader.SlotNumber())
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
	epoch, err := cs.epochForSlot(decodedHeader.SlotNumber())
	if err != nil {
		return nil, err
	}
	if block.Epoch != epoch {
		return nil, errorsmod.Wrapf(
			ErrInvalidCurrentEpoch,
			"%s block epoch mismatch: got %d expected %d",
			label,
			block.Epoch,
			epoch,
		)
	}
	epochContext := epochContextByEpoch(epochContexts, epoch)
	if epochContext == nil {
		return nil, errorsmod.Wrapf(
			ErrInvalidCurrentEpoch,
			"%s block slot %d outside available epoch context bounds for derived epoch %d",
			label, decodedHeader.SlotNumber(), epoch,
		)
	}
	if err := cs.validateEpochContextParameters([]*EpochContext{epochContext}); err != nil {
		return nil, err
	}
	if err := verifySlotWithinEpochContext(decodedHeader.SlotNumber(), epochContext, label); err != nil {
		return nil, err
	}
	if registry == nil {
		return nil, errorsmod.Wrap(ErrIBCInvalidClient, "pool registration tracker is missing")
	}
	if err := registry.tick(epoch); err != nil {
		return nil, err
	}
	if err := verifyStakeTablePoolBindings(epochContext, registry.state); err != nil {
		return nil, err
	}

	if tracker == nil {
		return nil, errorsmod.Wrap(ErrIBCInvalidClient, "nonce tracker is missing")
	}
	// The checkpoint continuation determines the nonce used for verification.
	// The supplied epoch-context nonce is only compared with that local value.
	if err := tracker.tick(cs, decodedHeader.BlockNumber(), decodedHeader.SlotNumber(), epoch, decodedPrevHash); err != nil {
		return nil, err
	}
	if !bytes.Equal(epochContext.EpochNonce, tracker.state.EpochNonce) {
		return nil, errorsmod.Wrapf(ErrInvalidCurrentEpoch, "epoch %d supplied nonce disagrees with nonce derived from verified history", epoch)
	}
	decodedPoolID := decodedHeader.IssuerVkey().PoolId()
	stakeEntry, err := findStakeDistributionEntryInContext(epochContext, decodedPoolID)
	if err != nil {
		return nil, errorsmod.Wrapf(ErrInvalidCurrentEpoch, "%s block issuer %s is not trusted for epoch %d", label, decodedPoolID, epochContext.Epoch)
	}
	var decodedVrfKeyHash []byte
	var sequenceNumber uint64
	var verifiedVRFOutput []byte
	if decodedBlock != nil {
		decodedVrfKeyHash, sequenceNumber, verifiedVRFOutput, err = cs.verifyNativeProbabilisticBlock(decodedBlock, label, tracker.state.EpochNonce, stakeEntry)
	} else {
		decodedVrfKeyHash, sequenceNumber, verifiedVRFOutput, err = cs.verifyNativeProbabilisticHeader(rawHeader, label, tracker.state.EpochNonce, stakeEntry)
	}
	if err != nil {
		return nil, err
	}
	// The frozen registry determines the registered key. The table was only
	// checked against it above and cannot supply a replacement binding.
	registered, err := poolBindingMap(registry.state.Effective)
	if err != nil {
		return nil, err
	}
	if !bytes.Equal(registered[decodedPoolID].VrfKeyHash, decodedVrfKeyHash) {
		return nil, errorsmod.Wrap(ErrInvalidAcceptedBlock, "header VRF key disagrees with authenticated pool registration")
	}
	if !bytes.Equal(stakeEntry.VrfKeyHash, decodedVrfKeyHash) {
		return nil, errorsmod.Wrapf(
			ErrInvalidAcceptedBlock,
			"%s block VRF key hash mismatch for pool %s",
			label,
			decodedPoolID,
		)
	}
	if requireFullBlock {
		certificates, err := probabilisticcore.AuthenticatedPoolCertificates(decodedBlock)
		if err != nil {
			return nil, errorsmod.Wrap(ErrInvalidAcceptedBlock, err.Error())
		}
		if err := registry.apply(decodedHeader.SlotNumber(), certificates); err != nil {
			return nil, err
		}
	}
	if err := advanceOperationalCertificateCounter(
		operationalCertificateCounters,
		decodedHeader.IssuerVkey().Hash().Bytes(),
		sequenceNumber,
	); err != nil {
		return nil, errorsmod.Wrapf(ErrInvalidAcceptedBlock, "%s block: %v", label, err)
	}

	authenticated := &authenticatedProbabilisticBlock{
		height:                               decodedHeader.BlockNumber(),
		slot:                                 decodedHeader.SlotNumber(),
		hash:                                 decodedHeader.Hash().String(),
		prevHash:                             decodedPrevHash,
		bodyHash:                             decodedBodyHash,
		epoch:                                epoch,
		timestamp:                            expectedTimestamp,
		slotLeader:                           decodedPoolID,
		operationalCertificateSequenceNumber: sequenceNumber,
	}
	if err := tracker.apply(cs, authenticated, verifiedVRFOutput); err != nil {
		return nil, err
	}
	return authenticated, nil
}

func advanceOperationalCertificateCounter(counters map[string]uint64, poolID []byte, sequenceNumber uint64) error {
	if len(poolID) != 28 {
		return errorsmod.Wrapf(
			ErrInvalidAcceptedBlock,
			"operational certificate pool id must be 28 bytes, got %d",
			len(poolID),
		)
	}
	poolKey := hex.EncodeToString(poolID)
	previousSequenceNumber := counters[poolKey]
	if sequenceNumber < previousSequenceNumber {
		return errorsmod.Wrapf(
			ErrInvalidAcceptedBlock,
			"operational certificate sequence number %d for pool %s is older than authenticated counter %d",
			sequenceNumber,
			poolKey,
			previousSequenceNumber,
		)
	}
	counters[poolKey] = sequenceNumber
	return nil
}

func (cs *ClientState) verifyNativeProbabilisticHeader(
	header *ledger.BabbageBlockHeader,
	label string,
	epochNonce []byte,
	stakeEntry *StakeDistributionEntry,
) (vrfKeyHash []byte, sequenceNumber uint64, verifiedVRFOutput []byte, err error) {
	defer func() {
		if recovered := recover(); recovered != nil {
			err = errorsmod.Wrapf(ErrInvalidAcceptedBlock, "native verification panicked for %s header: %v", label, recovered)
		}
	}()

	isValid, result, verifyErr := probabilisticcore.VerifyNativeHeader(
		header,
		epochNonce,
		cs.SlotsPerKesPeriod,
		cs.MaxKesEvolutions,
		cs.praosLeaderEligibilityParameters(stakeEntry),
	)
	if verifyErr != nil {
		return nil, 0, nil, errorsmod.Wrapf(ErrInvalidAcceptedBlock, "native verification failed for %s header: %v", label, verifyErr)
	}
	if !isValid {
		return nil, 0, nil, errorsmod.Wrapf(ErrInvalidAcceptedBlock, "%s header failed native Cardano verification", label)
	}

	vrfKeyHashBytes := blake2b.Sum256(result.VrfKey)
	return vrfKeyHashBytes[:], result.OperationalCertificateSequenceNumber, result.VerifiedVrfOutput, nil
}

func (cs *ClientState) verifyNativeProbabilisticBlock(
	decodedBlock ledger.Block,
	label string,
	epochNonce []byte,
	stakeEntry *StakeDistributionEntry,
) (vrfKeyHash []byte, sequenceNumber uint64, verifiedVRFOutput []byte, err error) {
	defer func() {
		if recovered := recover(); recovered != nil {
			err = errorsmod.Wrapf(ErrInvalidAcceptedBlock, "native verification panicked for %s block: %v", label, recovered)
		}
	}()

	isValid, result, verifyErr := probabilisticcore.VerifyNativeBlock(
		decodedBlock,
		epochNonce,
		cs.SlotsPerKesPeriod,
		cs.MaxKesEvolutions,
		cs.praosLeaderEligibilityParameters(stakeEntry),
	)
	if verifyErr != nil {
		return nil, 0, nil, errorsmod.Wrapf(ErrInvalidAcceptedBlock, "native verification failed for %s block: %v", label, verifyErr)
	}
	if !isValid {
		return nil, 0, nil, errorsmod.Wrapf(ErrInvalidAcceptedBlock, "%s block failed native Cardano verification", label)
	}

	vrfKeyHashBytes := blake2b.Sum256(result.VrfKey)
	return vrfKeyHashBytes[:], result.OperationalCertificateSequenceNumber, result.VerifiedVrfOutput, nil
}

func (cs *ClientState) praosLeaderEligibilityParameters(
	stakeEntry *StakeDistributionEntry,
) probabilisticcore.PraosLeaderEligibilityParameters {
	return probabilisticcore.PraosLeaderEligibilityParameters{
		StakeNumerator:        stakeEntry.RelativeStakeNumerator,
		StakeDenominator:      stakeEntry.RelativeStakeDenominator,
		ActiveSlotNumerator:   cs.ActiveSlotCoefficientNumerator,
		ActiveSlotDenominator: cs.ActiveSlotCoefficientDenominator,
	}
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
