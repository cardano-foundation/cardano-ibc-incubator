package state

import (
	"errors"

	errorsmod "cosmossdk.io/errors"
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

// decodedProbabilisticBlock is a witness whose bytes decoded and whose claimed
// hash, height, slot, timestamp and epoch match its own header. No signature,
// KES, VRF or body check has run on it yet.

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

func blockPrevHash(decodedBlock ledger.Block) (string, error) {
	prevHash, err := probabilisticcore.BlockPrevHash(decodedBlock)
	if err != nil {
		return "", errorsmod.Wrap(ErrInvalidAcceptedBlock, err.Error())
	}
	return prevHash, nil
}

func verifyHostStateTxIncludedInAnchorBlock(header *ProbabilisticHeader) error {
	_, err := extractHostStateTxBodyCborFromAnchorBlock(header)
	return err
}

func extractHostStateTxBodyCborFromAnchorBlock(header *ProbabilisticHeader) ([]byte, error) {
	txBodyCbor, err := probabilisticcore.ExtractHostStateTxBodyCborFromAnchorBlock(header.AnchorBlock.BlockCbor, header.HostStateTxHash)
	if err != nil {
		return nil, hostStateExtractionError(err)
	}
	return txBodyCbor, nil
}

// hostStateExtractionError classifies a failure to read the HostState
// transaction from the anchor block. A decoder panic means the block bytes are
// malformed, not that the HostState commitment is wrong.
func hostStateExtractionError(err error) error {
	if errors.Is(err, probabilisticcore.ErrDecodePanicked) {
		return errorsmod.Wrap(ErrInvalidAcceptedBlock, err.Error())
	}
	return errorsmod.Wrap(ErrInvalidHostStateCommitment, err.Error())
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
