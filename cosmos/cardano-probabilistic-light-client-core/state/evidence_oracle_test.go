package state

import (
	"bytes"
	"encoding/hex"
	"fmt"
	"math"
	"math/big"
	"strings"

	errorsmod "cosmossdk.io/errors"
	"github.com/blinklabs-io/gouroboros/cbor"
	"github.com/blinklabs-io/gouroboros/ledger"
	probabilisticcore "github.com/cardano-foundation/cardano-ibc-incubator/cosmos/cardano-probabilistic-light-client-core"
	"golang.org/x/crypto/blake2b"
)

// This batch oracle checks signed fixture evidence independently of staged
// verification. Production accepts only bounded operations and receipt challenges.
func decodedHeaderView(
	bridge []*decodedProbabilisticBlock,
	anchor *decodedProbabilisticBlock,
	descendants []*decodedProbabilisticBlock,
) *authenticatedProbabilisticHeader {
	fields := func(witnesses []*decodedProbabilisticBlock) []*authenticatedProbabilisticBlock {
		blocks := make([]*authenticatedProbabilisticBlock, len(witnesses))
		for index, witness := range witnesses {
			blocks[index] = &witness.fields
		}
		return blocks
	}
	return &authenticatedProbabilisticHeader{
		bridgeBlocks:     fields(bridge),
		anchorBlock:      &anchor.fields,
		descendantBlocks: fields(descendants),
	}
}

func (cs *ClientState) decodeProbabilisticBlock(
	block *ProbabilisticBlock,
	label string,
	requireFullBlock bool,
) (*decodedProbabilisticBlock, error) {
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
	return &decodedProbabilisticBlock{
		label:            label,
		requireFullBlock: requireFullBlock,
		block:            decodedBlock,
		rawHeader:        rawHeader,
		header:           decodedHeader,
		fields: authenticatedProbabilisticBlock{
			height:    decodedHeader.BlockNumber(),
			slot:      decodedHeader.SlotNumber(),
			hash:      decodedHeader.Hash().String(),
			prevHash:  decodedPrevHash,
			bodyHash:  decodedBodyHash,
			epoch:     epoch,
			timestamp: expectedTimestamp,
		},
	}, nil
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

func (cs *ClientState) findStakeDistributionEntry(poolID string) (*StakeDistributionEntry, error) {
	epochContexts, err := cs.normalizedEpochContexts()
	if err != nil {
		return nil, err
	}
	return findStakeDistributionEntryInContext(epochContextByEpoch(epochContexts, cs.CurrentEpoch), poolID)
}

func acceptedNativeVerification(witness *decodedProbabilisticBlock) ([]byte, uint64, []byte, error) {
	var result probabilisticcore.NativeBlockVerificationResult
	if witness.block != nil {
		var err error
		result, err = probabilisticcore.AcceptedNativeBlockResult(witness.block)
		if err != nil {
			return nil, 0, nil, errorsmod.Wrapf(ErrInvalidAcceptedBlock, "%s block: %v", witness.label, err)
		}
	} else {
		result = probabilisticcore.AcceptedNativeHeaderResult(witness.rawHeader)
	}
	vrfKeyHash := blake2b.Sum256(result.VrfKey)
	return vrfKeyHash[:], result.OperationalCertificateSequenceNumber, result.VerifiedVrfOutput, nil
}

func (cs *ClientState) replayVerifiedHeaderBlocks(
	header *ProbabilisticHeader,
	epochContexts []*EpochContext,
	trustedCounters map[string]uint64,
	trusted *trustedBlockState,
) (*authenticatedProbabilisticHeader, error) {
	return cs.authenticateHeaderWitnesses(header, epochContexts, trustedCounters, trusted, nil, true)
}

func encodeNativeVerifiedBlockBodyHex(
	txCount int,
	bodyCborAt func(int) []byte,
	witnessCborAt func(int) []byte,
	transactionMetadataSet map[uint]*cbor.LazyValue,
) (string, error) {
	return probabilisticcore.EncodeNativeVerifiedBlockBodyHex(txCount, bodyCborAt, witnessCborAt, transactionMetadataSet)
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

func (cs *ClientState) authenticateHeaderBlocksWithContexts(
	header *ProbabilisticHeader,
	epochContexts []*EpochContext,
	trustedCounters map[string]uint64,
	trusted *trustedBlockState,
) (*authenticatedProbabilisticHeader, error) {
	return cs.authenticateHeaderWitnesses(header, epochContexts, trustedCounters, trusted, nil, false)
}

func buildBlockVerificationArtifacts(decodedBlock ledger.Block) (string, string, []byte, error) {
	return probabilisticcore.BuildBlockVerificationArtifacts(decodedBlock)
}

func (cs *ClientState) authenticateHeaderWitnesses(
	header *ProbabilisticHeader,
	epochContexts []*EpochContext,
	trustedCounters map[string]uint64,
	trusted *trustedBlockState,
	checkLinkage func(decoded *authenticatedProbabilisticHeader) error,
	replay bool,
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

	bridgeWitnesses := make([]*decodedProbabilisticBlock, 0, len(header.BridgeBlocks))
	for _, block := range header.BridgeBlocks {
		witness, decodeErr := cs.decodeProbabilisticBlock(block, "bridge", true)
		if decodeErr != nil {
			return nil, decodeErr
		}
		bridgeWitnesses = append(bridgeWitnesses, witness)
	}
	anchorWitness, err := cs.decodeProbabilisticBlock(header.AnchorBlock, "anchor", true)
	if err != nil {
		return nil, err
	}
	descendantWitnesses := make([]*decodedProbabilisticBlock, 0, len(header.DescendantBlocks))
	for _, block := range header.DescendantBlocks {
		witness, decodeErr := cs.decodeProbabilisticBlock(block, "descendant", false)
		if decodeErr != nil {
			return nil, decodeErr
		}
		descendantWitnesses = append(descendantWitnesses, witness)
	}
	if checkLinkage != nil {
		if err := checkLinkage(decodedHeaderView(bridgeWitnesses, anchorWitness, descendantWitnesses)); err != nil {
			return nil, err
		}
	}

	bridgeBlocks := make([]*authenticatedProbabilisticBlock, 0, len(bridgeWitnesses))
	for _, witness := range bridgeWitnesses {
		authenticatedBlock, authErr := cs.authenticateDecodedBlock(witness, epochContexts, counters, tracker, registry, replay)
		if authErr != nil {
			return nil, authErr
		}
		bridgeBlocks = append(bridgeBlocks, authenticatedBlock)
	}

	anchorBlock, err := cs.authenticateDecodedBlock(anchorWitness, epochContexts, counters, tracker, registry, replay)
	if err != nil {
		return nil, err
	}
	anchorCounters := operationalCertificateCountersFromMap(counters)
	anchorNonceState := clonePraosNonceState(tracker.state)
	anchorPoolRegistry := clonePoolRegistry(registry.state)

	descendantBlocks := make([]*authenticatedProbabilisticBlock, 0, len(descendantWitnesses))
	for _, witness := range descendantWitnesses {
		authenticatedBlock, authErr := cs.authenticateDecodedBlock(witness, epochContexts, counters, tracker, registry, replay)
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
		settlementPoolRegistry:               clonePoolRegistry(registry.state),
	}, nil
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

func (cs *ClientState) authenticateProbabilisticBlock(
	block *ProbabilisticBlock,
	label string,
	epochContexts []*EpochContext,
	operationalCertificateCounters map[string]uint64,
	requireFullBlock bool,
	tracker *nonceTracker,
	registry *poolRegistryTracker,
) (*authenticatedProbabilisticBlock, error) {
	witness, err := cs.decodeProbabilisticBlock(block, label, requireFullBlock)
	if err != nil {
		return nil, err
	}
	return cs.authenticateDecodedBlock(witness, epochContexts, operationalCertificateCounters, tracker, registry, false)
}

func (cs *ClientState) verifyCurrentEpoch(slot uint64, label string) error {
	epochContexts, err := cs.normalizedEpochContexts()
	if err != nil {
		return err
	}
	return verifySlotWithinEpochContext(slot, epochContextByEpoch(epochContexts, cs.CurrentEpoch), label)
}

func (cs *ClientState) authenticateDecodedBlock(
	witness *decodedProbabilisticBlock,
	epochContexts []*EpochContext,
	operationalCertificateCounters map[string]uint64,
	tracker *nonceTracker,
	registry *poolRegistryTracker,
	replay bool,
) (*authenticatedProbabilisticBlock, error) {
	label := witness.label
	epoch := witness.fields.epoch
	slot := witness.fields.slot
	epochContext := epochContextByEpoch(epochContexts, epoch)
	if epochContext == nil {
		return nil, errorsmod.Wrapf(
			ErrInvalidCurrentEpoch,
			"%s block slot %d outside available epoch context bounds for derived epoch %d",
			label, slot, epoch,
		)
	}
	if err := cs.validateEpochContextParameters([]*EpochContext{epochContext}); err != nil {
		return nil, err
	}
	if err := verifySlotWithinEpochContext(slot, epochContext, label); err != nil {
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
	if err := tracker.tick(cs, witness.fields.height, slot, epoch, witness.fields.prevHash); err != nil {
		return nil, err
	}
	if !bytes.Equal(epochContext.EpochNonce, tracker.state.EpochNonce) {
		return nil, errorsmod.Wrapf(ErrInvalidCurrentEpoch, "epoch %d supplied nonce disagrees with nonce derived from verified history", epoch)
	}
	decodedPoolID := witness.header.IssuerVkey().PoolId()
	stakeEntry, err := findStakeDistributionEntryInContext(epochContext, decodedPoolID)
	if err != nil {
		return nil, errorsmod.Wrapf(ErrInvalidCurrentEpoch, "%s block issuer %s is not trusted for epoch %d", label, decodedPoolID, epochContext.Epoch)
	}
	var decodedVrfKeyHash []byte
	var sequenceNumber uint64
	var verifiedVRFOutput []byte
	switch {
	case replay:
		decodedVrfKeyHash, sequenceNumber, verifiedVRFOutput, err = acceptedNativeVerification(witness)
	case witness.block != nil:
		decodedVrfKeyHash, sequenceNumber, verifiedVRFOutput, err = cs.verifyNativeProbabilisticBlock(witness.block, label, tracker.state.EpochNonce, stakeEntry)
	default:
		decodedVrfKeyHash, sequenceNumber, verifiedVRFOutput, err = cs.verifyNativeProbabilisticHeader(witness.rawHeader, label, tracker.state.EpochNonce, stakeEntry)
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
	if witness.requireFullBlock {
		certificates, err := probabilisticcore.AuthenticatedPoolCertificates(witness.block)
		if err != nil {
			return nil, errorsmod.Wrap(ErrInvalidAcceptedBlock, err.Error())
		}
		if err := registry.apply(slot, certificates); err != nil {
			return nil, err
		}
	}
	if err := advanceOperationalCertificateCounter(
		operationalCertificateCounters,
		witness.header.IssuerVkey().Hash().Bytes(),
		sequenceNumber,
	); err != nil {
		return nil, errorsmod.Wrapf(ErrInvalidAcceptedBlock, "%s block: %v", label, err)
	}

	authenticated := witness.fields
	authenticated.slotLeader = decodedPoolID
	authenticated.operationalCertificateSequenceNumber = sequenceNumber
	if err := tracker.apply(cs, &authenticated, verifiedVRFOutput); err != nil {
		return nil, err
	}
	return &authenticated, nil
}

type authenticatedProbabilisticHeader struct {
	settlementStakeLimits                map[string]*big.Rat
	settlementPoolRegistry               *PoolRegistryState
	anchorBlock                          *authenticatedProbabilisticBlock
	bridgeBlocks                         []*authenticatedProbabilisticBlock
	descendantBlocks                     []*authenticatedProbabilisticBlock
	anchorOperationalCertificateCounters []*OperationalCertificateCounter
	anchorNonceState                     *PraosNonceState
	anchorPoolRegistry                   *PoolRegistryState
	anchorSettlementCredit               *SettlementCreditState
	anchorPoolProduction                 *PoolProductionHistory
}

type decodedProbabilisticBlock struct {
	label            string
	requireFullBlock bool
	block            ledger.Block               // set for a block_cbor witness
	rawHeader        *ledger.BabbageBlockHeader // set for a header_cbor witness
	header           ledger.BlockHeader
	// The slot leader and certificate sequence stay unset until authentication.
	fields authenticatedProbabilisticBlock
}

func (cs ClientState) verifyHeaderTemporalContinuity(
	ctx Context,
	header *authenticatedProbabilisticHeader,
	trustedBlock *trustedBlockState,
) error {
	if trustedBlock == nil || trustedBlock.height == nil {
		return errorsmod.Wrap(ErrInvalidTimestamp, "trusted Cardano temporal cursor is missing")
	}
	if trustedBlock.timestamp == 0 {
		return errorsmod.Wrap(ErrInvalidTimestamp, "trusted Cardano timestamp is missing")
	}
	if header == nil || header.anchorBlock == nil {
		return errorsmod.Wrap(ErrInvalidTimestamp, "authenticated anchor block is missing")
	}

	maxTimestamp, err := cs.maximumAllowedCardanoTimestamp(ctx)
	if err != nil {
		return err
	}

	blocks := make([]authenticatedTemporalBlock, 0, len(header.bridgeBlocks)+len(header.descendantBlocks)+1)
	for index, block := range header.bridgeBlocks {
		blocks = append(blocks, authenticatedTemporalBlock{
			label: fmt.Sprintf("bridge block at index %d", index),
			block: block,
		})
	}
	blocks = append(blocks, authenticatedTemporalBlock{label: "anchor block", block: header.anchorBlock})
	for index, block := range header.descendantBlocks {
		blocks = append(blocks, authenticatedTemporalBlock{
			label: fmt.Sprintf("descendant block at index %d", index),
			block: block,
		})
	}

	previousSlot := trustedBlock.slot
	previousTimestamp := trustedBlock.timestamp
	for _, candidate := range blocks {
		if candidate.block == nil {
			return errorsmod.Wrapf(ErrInvalidTimestamp, "%s is missing", candidate.label)
		}
		expectedTimestamp, err := cs.DeriveTimestampFromSlot(candidate.block.slot)
		if err != nil {
			return errorsmod.Wrapf(err, "%s has an invalid slot", candidate.label)
		}
		if candidate.block.timestamp != expectedTimestamp {
			return errorsmod.Wrapf(
				ErrInvalidTimestamp,
				"%s timestamp %d does not match slot %d timestamp %d",
				candidate.label,
				candidate.block.timestamp,
				candidate.block.slot,
				expectedTimestamp,
			)
		}
		if candidate.block.slot <= previousSlot {
			return errorsmod.Wrapf(
				ErrInvalidTimestamp,
				"%s slot %d must be greater than previous authenticated slot %d",
				candidate.label,
				candidate.block.slot,
				previousSlot,
			)
		}
		if candidate.block.timestamp <= previousTimestamp {
			return errorsmod.Wrapf(
				ErrInvalidTimestamp,
				"%s timestamp %d must be later than previous authenticated timestamp %d",
				candidate.label,
				candidate.block.timestamp,
				previousTimestamp,
			)
		}
		if candidate.block.timestamp > maxTimestamp {
			return errorsmod.Wrapf(
				ErrInvalidTimestamp,
				"%s timestamp %d exceeds Cosmos host time plus max clock drift %d",
				candidate.label,
				candidate.block.timestamp,
				maxTimestamp,
			)
		}
		previousSlot = candidate.block.slot
		previousTimestamp = candidate.block.timestamp
	}

	return nil
}

type authenticatedTemporalBlock struct {
	label string
	block *authenticatedProbabilisticBlock
}

func advanceSettlementCredit(trusted *trustedBlockState, contexts []*EpochContext, epoch uint64) (*SettlementCreditState, error) {
	if trusted == nil {
		return nil, errorsmod.Wrap(ErrIBCInvalidClient, "settlement trusted checkpoint is missing")
	}
	if err := validateSettlementCredit(trusted.settlementCredit, trusted.epoch); err != nil {
		return nil, err
	}
	if epoch == trusted.epoch {
		return cloneSettlementCredit(trusted.settlementCredit), nil
	}
	if trusted.epoch == math.MaxUint64 || epoch != trusted.epoch+1 {
		return nil, errorsmod.Wrap(ErrInvalidCurrentEpoch, "settlement reference advances only at an adjacent epoch transition")
	}
	// Advance all pool references using their old capped credit. Neither a raw
	// table claim nor another update within the same epoch grants an allowance.
	credits, err := currentSettlementCredits(trusted.settlementCredit, epochContextByEpoch(contexts, trusted.epoch))
	if err != nil {
		return nil, err
	}
	result := &SettlementCreditState{Epoch: epoch, Reference: creditsFromMap(credits)}
	return result, validateSettlementCredit(result, epoch)
}

func attachSettlementCredit(header *authenticatedProbabilisticHeader, trusted *trustedBlockState, contexts []*EpochContext) error {
	credit, err := advanceSettlementCredit(trusted, contexts, header.anchorBlock.epoch)
	if err != nil {
		return err
	}
	header.anchorSettlementCredit = credit
	if settlementEvidenceEpoch(header) > header.anchorBlock.epoch {
		context := epochContextByEpoch(contexts, settlementEvidenceEpoch(header))
		if context == nil {
			return errorsmod.Wrap(ErrInvalidCurrentEpoch, "next epoch settlement context is missing")
		}
		var total uint64
		for _, entry := range context.StakeDistribution {
			var ok bool
			total, ok = checkedAddStake(total, entry.Stake)
			if !ok {
				return errorsmod.Wrap(ErrInvalidCurrentEpoch, "next epoch stake total overflows uint64")
			}
		}
		if total == 0 {
			return errorsmod.Wrap(ErrInvalidCurrentEpoch, "next epoch stake total is zero")
		}
		header.settlementStakeLimits = make(map[string]*big.Rat, len(context.StakeDistribution))
		for _, entry := range context.StakeDistribution {
			header.settlementStakeLimits[strings.ToLower(entry.PoolId)] = new(big.Rat).SetFrac(new(big.Int).SetUint64(entry.Stake), new(big.Int).SetUint64(total))
		}
	}
	return nil
}

func attachPoolProduction(header *authenticatedProbabilisticHeader, trusted *trustedBlockState) error {
	if trusted == nil || header == nil || header.anchorBlock == nil {
		return errorsmod.Wrap(ErrInvalidAcceptedBlock, "production checkpoint or anchor is missing")
	}
	records, err := productionRecordMap(trusted.poolProduction, trusted.epoch)
	if err != nil {
		return err
	}
	epoch := trusted.epoch
	apply := func(block *authenticatedProbabilisticBlock) error {
		if block == nil || block.slotLeader == "" {
			return errorsmod.Wrap(ErrInvalidAcceptedBlock, "authenticated production observation has no issuer")
		}
		if err := advanceProductionEpoch(records, epoch, block.epoch); err != nil {
			return err
		}
		epoch = block.epoch
		pool := strings.ToLower(block.slotLeader)
		record := records[pool]
		if record == nil {
			record = &PoolProductionRecord{PoolId: pool}
			records[pool] = record
		}
		record.ProducedCurrentEpoch = true
		return nil
	}
	for _, block := range header.bridgeBlocks {
		if err := apply(block); err != nil {
			return err
		}
	}
	if err := apply(header.anchorBlock); err != nil {
		return err
	}
	// The completed bits are frozen for settlement in this epoch. Current flags
	// include the anchor, but neither it nor descendants can qualify a pool now.
	header.anchorPoolProduction = productionHistoryFromMap(epoch, records)
	return nil
}

func settlementEvidenceEpoch(header *authenticatedProbabilisticHeader) uint64 {
	epoch := header.anchorBlock.epoch
	for _, block := range header.descendantBlocks {
		if block != nil && block.epoch > epoch {
			epoch = block.epoch
		}
	}
	return epoch
}

func verifyHeaderEpochTransition(
	header *ProbabilisticHeader,
	trustedBlock *trustedBlockState,
	authenticatedHeader *authenticatedProbabilisticHeader,
) error {
	if header == nil {
		return errorsmod.Wrap(ErrInvalidHeader, "probabilistic header missing")
	}
	if trustedBlock == nil {
		return errorsmod.Wrap(ErrIBCConsensusStateNotFound, "trusted block state missing")
	}
	if authenticatedHeader == nil || authenticatedHeader.anchorBlock == nil {
		return errorsmod.Wrap(ErrInvalidAcceptedBlock, "authenticated anchor block missing")
	}

	trustedEpoch := trustedBlock.epoch
	anchorEpoch := authenticatedHeader.anchorBlock.epoch
	evidenceEpoch := settlementEvidenceEpoch(authenticatedHeader)

	switch {
	case anchorEpoch < trustedEpoch:
		return errorsmod.Wrapf(
			ErrInvalidCurrentEpoch,
			"accepted epoch %d must not be older than trusted epoch %d",
			anchorEpoch,
			trustedEpoch,
		)
	case evidenceEpoch == trustedEpoch:
		if header.NewEpochContext != nil {
			if header.NewEpochContext.Epoch != anchorEpoch {
				return errorsmod.Wrapf(
					ErrInvalidCurrentEpoch,
					"same-epoch new_epoch_context epoch %d must match accepted epoch %d",
					header.NewEpochContext.Epoch,
					anchorEpoch,
				)
			}
		}
	case trustedEpoch != ^uint64(0) && evidenceEpoch == trustedEpoch+1:
		if header.NewEpochContext == nil {
			return errorsmod.Wrap(
				ErrInvalidCurrentEpoch,
				"new_epoch_context must be present for adjacent epoch rollover",
			)
		}
		if header.NewEpochContext.Epoch != evidenceEpoch {
			return errorsmod.Wrapf(
				ErrInvalidCurrentEpoch,
				"new_epoch_context epoch %d must match evidence epoch %d",
				header.NewEpochContext.Epoch,
				evidenceEpoch,
			)
		}
	default:
		return errorsmod.Wrapf(
			ErrInvalidCurrentEpoch,
			"probabilistic rollover currently supports only adjacent epoch transitions; trusted epoch %d, accepted epoch %d",
			trustedEpoch,
			anchorEpoch,
		)
	}

	for _, block := range authenticatedHeader.bridgeBlocks {
		if block == nil {
			return errorsmod.Wrap(ErrInvalidAcceptedBlock, "authenticated bridge block missing")
		}
		if block.epoch != trustedEpoch && block.epoch != anchorEpoch {
			return errorsmod.Wrapf(
				ErrInvalidCurrentEpoch,
				"bridge block %d crosses unsupported epoch %d for transition %d -> %d",
				block.height,
				block.epoch,
				trustedEpoch,
				anchorEpoch,
			)
		}
	}

	for _, block := range authenticatedHeader.descendantBlocks {
		if block == nil {
			return errorsmod.Wrap(ErrInvalidAcceptedBlock, "authenticated descendant block missing")
		}
		if block.epoch < anchorEpoch || block.epoch > evidenceEpoch {
			return errorsmod.Wrapf(
				ErrInvalidCurrentEpoch,
				"descendant block %d must remain in accepted epoch %d, got epoch %d",
				block.height,
				anchorEpoch,
				block.epoch,
			)
		}
	}

	return nil
}

func verifyBridgeContinuity(
	authenticatedHeader *authenticatedProbabilisticHeader,
	trustedBlock *trustedBlockState,
) error {
	if trustedBlock == nil || trustedBlock.height == nil {
		return errorsmod.Wrap(ErrIBCConsensusStateNotFound, "trusted block state missing")
	}
	if authenticatedHeader == nil || authenticatedHeader.anchorBlock == nil {
		return errorsmod.Wrap(ErrInvalidAcceptedBlock, "authenticated anchor block missing")
	}

	expectedPrevHash := trustedBlock.blockHash
	expectedHeight := trustedBlock.height.RevisionHeight + 1

	for _, block := range authenticatedHeader.bridgeBlocks {
		if block == nil {
			return errorsmod.Wrap(ErrInvalidAcceptedBlock, "authenticated bridge block missing")
		}
		if block.prevHash != expectedPrevHash {
			return errorsmod.Wrapf(
				ErrInvalidAcceptedBlock,
				"bridge block %s does not connect to trusted chain",
				block.hash,
			)
		}
		if block.height != expectedHeight {
			return errorsmod.Wrapf(
				ErrInvalidAcceptedBlock,
				"bridge height gap at block %s: got %d expected %d",
				block.hash,
				block.height,
				expectedHeight,
			)
		}

		expectedPrevHash = block.hash
		expectedHeight++
	}

	if authenticatedHeader.anchorBlock.prevHash != expectedPrevHash {
		return errorsmod.Wrapf(
			ErrInvalidAcceptedBlock,
			"anchor block %s does not connect to trusted chain",
			authenticatedHeader.anchorBlock.hash,
		)
	}
	if authenticatedHeader.anchorBlock.height != expectedHeight {
		return errorsmod.Wrapf(
			ErrInvalidAcceptedBlock,
			"anchor height mismatch: got %d expected %d",
			authenticatedHeader.anchorBlock.height,
			expectedHeight,
		)
	}

	return nil
}

func (cs *ClientState) computeHeaderSecurityMetrics(
	header *authenticatedProbabilisticHeader,
	epochContext *EpochContext,
) (uint64, uint64, uint64, error) {
	seenPools := make(map[string]struct{})
	qualifiedUniquePools := uint64(0)
	qualifiedUniqueStake := new(big.Rat)
	totalActiveStake := uint64(0)
	if header == nil || header.anchorPoolRegistry == nil {
		return 0, 0, 0, errorsmod.Wrap(ErrInvalidCurrentEpoch, "authenticated anchor pool registry is missing")
	}
	registeredPools, err := poolBindingMap(header.anchorPoolRegistry.Effective)
	if err != nil {
		return 0, 0, 0, err
	}
	if err := verifyStakeTablePoolBindings(epochContext, header.anchorPoolRegistry); err != nil {
		return 0, 0, 0, err
	}

	if epochContext == nil {
		return 0, 0, 0, errorsmod.Wrap(ErrInvalidCurrentEpoch, "anchor epoch context must be present")
	}

	if len(epochContext.StakeDistribution) == 0 {
		return 0, 0, 0, errorsmod.Wrapf(ErrInvalidCurrentEpoch, "epoch %d stake distribution must not be empty", epochContext.Epoch)
	}

	for _, entry := range epochContext.StakeDistribution {
		if entry == nil {
			continue
		}
		nextTotalActiveStake, ok := checkedAddStake(totalActiveStake, entry.Stake)
		if !ok {
			return 0, 0, 0, errorsmod.Wrapf(
				ErrInvalidCurrentEpoch,
				"epoch %d stake distribution total overflows uint64",
				epochContext.Epoch,
			)
		}
		totalActiveStake = nextTotalActiveStake
	}
	if totalActiveStake == 0 {
		return 0, 0, 0, errorsmod.Wrapf(ErrInvalidCurrentEpoch, "epoch %d stake distribution must have positive total stake", epochContext.Epoch)
	}

	if header == nil || header.anchorBlock == nil {
		return 0, 0, 0, errorsmod.Wrap(ErrInvalidAcceptedBlock, "authenticated anchor block missing")
	}
	poolRegistrationCutoffSlot, err := cs.poolRegistrationCutoffSlotExclusive(header.anchorBlock.slot)
	if err != nil {
		return 0, 0, 0, err
	}

	credits, err := currentSettlementCredits(header.anchorSettlementCredit, epochContext)
	if err != nil {
		return 0, 0, 0, err
	}

	production, err := productionRecordMap(header.anchorPoolProduction, epochContext.Epoch)
	if err != nil {
		return 0, 0, 0, err
	}

	anchorEpoch := header.anchorBlock.epoch
	prevHash := header.anchorBlock.hash
	prevHeight := header.anchorBlock.height
	for _, block := range header.descendantBlocks {
		if block == nil {
			return 0, 0, 0, errorsmod.Wrap(ErrInvalidAcceptedBlock, "authenticated descendant block missing")
		}
		if block.prevHash != prevHash {
			return 0, 0, 0, errorsmod.Wrapf(ErrInvalidAcceptedBlock, "descendant chain is not contiguous at block %s", block.hash)
		}
		if block.height != prevHeight+1 {
			return 0, 0, 0, errorsmod.Wrapf(ErrInvalidAcceptedBlock, "descendant height gap at block %s", block.hash)
		}
		if block.epoch < anchorEpoch || (block.epoch != anchorEpoch && (anchorEpoch == ^uint64(0) || block.epoch != anchorEpoch+1)) {
			return 0, 0, 0, errorsmod.Wrapf(
				ErrInvalidCurrentEpoch,
				"descendant block %d must remain in accepted epoch %d, got %d",
				block.height,
				anchorEpoch,
				block.epoch,
			)
		}

		poolID := strings.ToLower(block.slotLeader)
		if poolID != "" {
			if _, exists := seenPools[poolID]; !exists {
				seenPools[poolID] = struct{}{}
				// A later epoch can contain newly effective identities. They are
				// valid producers but do not qualify under the frozen anchor view.
				if registeredPools[poolID] == nil && block.epoch > anchorEpoch {
					prevHash, prevHeight = block.hash, block.height
					continue
				}
				eligible, err := poolRegisteredBeforeCutoff(poolRegistrationCutoffSlot, registeredPools[poolID])
				if err != nil {
					return 0, 0, 0, err
				}
				observed := production[poolID]
				if eligible && observed != nil && observed.CompletedEpochsBitmap != 0 {
					credit := credits[poolID]
					if credit == nil {
						// A valid next-epoch producer can have zero anchor-epoch
						// stake. It does not qualify under that frozen table.
						if block.epoch > anchorEpoch {
							prevHash, prevHeight = block.hash, block.height
							continue
						}
						return 0, 0, 0, errorsmod.Wrap(ErrInvalidCurrentEpoch, "qualified producer missing from stake table")
					}
					qualifiedUniquePools++
					if header.settlementStakeLimits != nil {
						limit := header.settlementStakeLimits[poolID]
						if limit == nil {
							credit = new(big.Rat)
						} else if credit.Cmp(limit) > 0 {
							credit = limit
						}
					}
					qualifiedUniqueStake.Add(qualifiedUniqueStake, credit)
				}
			}
		}

		prevHash = block.hash
		prevHeight = block.height
	}

	qualifiedUniqueStakeBps := settlementCreditBps(qualifiedUniqueStake)

	score := cs.computeSecurityScore(uint64(len(header.descendantBlocks)), qualifiedUniquePools, qualifiedUniqueStakeBps)
	return qualifiedUniquePools, qualifiedUniqueStakeBps, score, nil
}

type headerAuthenticator func(
	header *ProbabilisticHeader,
	epochContexts []*EpochContext,
	trustedCounters map[string]uint64,
	trusted *trustedBlockState,
) (*authenticatedProbabilisticHeader, error)

func poolRegisteredBeforeCutoff(cutoffSlotExclusive uint64, entry *PoolRegistrationBinding) (bool, error) {
	if entry == nil {
		return false, errorsmod.Wrap(ErrInvalidCurrentEpoch, "descendant slot leader missing from epoch stake distribution")
	}
	return entry.FirstRegistrationSlot < cutoffSlotExclusive, nil
}

func (h ProbabilisticHeader) validateObservationEvidence() error {
	if h.ObservationChunk != nil {
		return fmt.Errorf("logical evidence cannot contain an observation operation")
	}
	if len(h.BridgeBlocks) > MaxBridgeBlocks || 1+len(h.BridgeBlocks)+len(h.DescendantBlocks) > MaxHeaderBlocks {
		return errorsmod.Wrap(ErrInvalidHeader, "block count exceeds the challenge capacity bound")
	}
	if h.TrustedHeight == nil {
		return errorsmod.Wrap(ErrInvalidHeader, "trusted height must be present")
	}
	if h.TrustedHeight.RevisionHeight == 0 {
		return errorsmod.Wrap(ErrInvalidHeaderHeight, "trusted height cannot be zero")
	}
	if h.AnchorBlock == nil || h.AnchorBlock.Height == nil {
		return errorsmod.Wrap(ErrInvalidHeader, "anchor block must be present")
	}
	if h.AnchorBlock.Height.RevisionHeight == 0 {
		return errorsmod.Wrap(ErrInvalidHeaderHeight, "anchor block height cannot be zero")
	}
	if h.AnchorBlock.Hash == "" {
		return errorsmod.Wrap(ErrInvalidAcceptedBlock, "anchor block hash cannot be empty")
	}
	if err := validateProbabilisticBlockWitness(h.AnchorBlock, "anchor", true); err != nil {
		return err
	}
	if h.TrustedHeight.RevisionHeight >= h.AnchorBlock.Height.RevisionHeight {
		return errorsmod.Wrapf(
			ErrInvalidHeaderHeight,
			"trusted height %d must be less than anchor height %d",
			h.TrustedHeight.RevisionHeight,
			h.AnchorBlock.Height.RevisionHeight,
		)
	}
	if h.IsCheckpoint {
		if h.HostStateTxHash != "" || h.HostStateTxOutputIndex != 0 {
			return errorsmod.Wrap(ErrInvalidHostStateCommitment, "checkpoint header must not contain HostState transaction fields")
		}
	}
	if h.NewEpochContext != nil {
		if err := validateEpochContext(h.NewEpochContext); err != nil {
			return err
		}
	}
	for _, block := range h.BridgeBlocks {
		if block == nil {
			return errorsmod.Wrap(ErrInvalidAcceptedBlock, "bridge block cannot be nil")
		}
		if err := validateProbabilisticBlockWitness(block, "bridge", false); err != nil {
			return err
		}
	}
	for _, block := range h.DescendantBlocks {
		if block == nil {
			return errorsmod.Wrap(ErrInvalidAcceptedBlock, "descendant block cannot be nil")
		}
		if err := validateProbabilisticBlockWitness(block, "descendant", false); err != nil {
			return err
		}
	}
	return nil
}
