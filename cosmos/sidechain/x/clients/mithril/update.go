package mithril

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"

	errorsmod "cosmossdk.io/errors"
	storetypes "cosmossdk.io/store/types"
	"github.com/cosmos/cosmos-sdk/codec"
	sdk "github.com/cosmos/cosmos-sdk/types"
	clienttypes "github.com/cosmos/ibc-go/v8/modules/core/02-client/types"
	host "github.com/cosmos/ibc-go/v8/modules/core/24-host"
	"github.com/cosmos/ibc-go/v8/modules/core/exported"
)

// VerifyClientMessage checks if the clientMessage is of type MithrilHeader or Misbehaviour and verifies the message
func (cs *ClientState) VerifyClientMessage(
	ctx sdk.Context, cdc codec.BinaryCodec, clientStore storetypes.KVStore,
	clientMsg exported.ClientMessage,
) error {
	switch msg := clientMsg.(type) {
	case *MithrilHeader:
		return cs.verifyHeader(ctx, clientStore, cdc, msg)
	case *Misbehaviour:
		return cs.verifyMisbehaviour(ctx, clientStore, cdc, msg)
	default:
		return clienttypes.ErrInvalidClientType
	}
}

func (cs *ClientState) verifyHeader(
	_ sdk.Context, clientStore storetypes.KVStore, _ codec.BinaryCodec,
	header *MithrilHeader,
) error {
	nilCertificate := MithrilCertificate{}
	expectedPreviousCerForTs := nilCertificate

	firstCertInEpoch := getFcInEpoch(clientStore, header.MithrilStakeDistribution.Epoch)
	firstCertInPrevEpoch := getFcInEpoch(clientStore, header.MithrilStakeDistribution.Epoch-1)

	if firstCertInEpoch != nilCertificate {
		if header.MithrilStakeDistribution.CertificateHash != firstCertInEpoch.Hash {
			return errorsmod.Wrapf(ErrInvalidCertificate, "%s received: %v, expected: %v", "invalid latest mithril state distribution certificate:", header.MithrilStakeDistribution.CertificateHash, firstCertInEpoch.Hash)
		}
		expectedPreviousCerForTs = firstCertInEpoch
	} else {
		if firstCertInPrevEpoch == nilCertificate {
			return errorsmod.Wrapf(ErrInvalidCertificate, "prev epoch didn't store first mithril stake distribution certificate")
		}
		expectedPreviousCerForTs = *header.MithrilStakeDistributionCertificate
		if header.MithrilStakeDistributionCertificate.PreviousHash != firstCertInPrevEpoch.Hash {
			return errorsmod.Wrapf(ErrInvalidCertificate, "%s received: %v, expected: %v", "invalid first mithril state distribution certificate ", header.MithrilStakeDistributionCertificate.PreviousHash, firstCertInPrevEpoch.Hash)
		}
	}

	if header.TransactionSnapshotCertificate.PreviousHash != expectedPreviousCerForTs.Hash {
		return errorsmod.Wrapf(ErrInvalidCertificate, "%s received: %v, expected: %v", "invalid first transaction snapshot certificate", header.TransactionSnapshotCertificate.PreviousHash, expectedPreviousCerForTs.Hash)
	}

	_, err := time.Parse(time.RFC3339Nano, header.TransactionSnapshotCertificate.Metadata.SealedAt)
	if err != nil {
		return errorsmod.Wrapf(ErrInvalidTimestamp, "%s received: %v, expected: %v", "invalid timestamp layout", header.TransactionSnapshotCertificate.Metadata.SealedAt, time.RFC3339Nano)
	}

	msdVerifier := &MithrilCertificateVerifier{
		CertificateRetriever: &MSDCertificateRetriever{
			ClientStore: clientStore,
		},
	}

	// new epoch
	if firstCertInEpoch == nilCertificate {
		msdCertificate, parseMSDCertificateError := FromCertificateProto(header.MithrilStakeDistributionCertificate)
		if parseMSDCertificateError != nil {
			return errorsmod.Wrapf(ErrInvalidTimestamp, "%s received: %v", "invalid MithrilStakeDistributionCertificate", header.MithrilStakeDistributionCertificate)
		}

		protocolMultiSignature, err := FromCertificateSignatureProto(header.MithrilStakeDistributionCertificate.SignedEntityType, header.MithrilStakeDistributionCertificate.MultiSignature, "")

		if err != nil {
			return errorsmod.Wrapf(ErrInvalidCertificate, "mithril state distribution certificate cannot be parsed: error: %v", err)
		}

		_, verifyStandardCertificateError := msdVerifier.VerifyStandardCertificate(
			msdCertificate,
			protocolMultiSignature.MultiSignature.ProtocolMultiSignature,
		)

		if verifyStandardCertificateError != nil {
			return errorsmod.Wrapf(ErrInvalidCertificate, "mithril state distribution certificate is invalid: error: %v", verifyStandardCertificateError)
		}

		setMSDCertificateWithHash(clientStore, *header.MithrilStakeDistributionCertificate)
	}

	tsCertificate, parseTsCertificateError := FromCertificateProto(header.TransactionSnapshotCertificate)
	if parseTsCertificateError != nil {
		return errorsmod.Wrapf(ErrInvalidTimestamp, "%s received: %v : error: %v", "invalid TransactionSnapshotCertificate", header.TransactionSnapshotCertificate, parseTsCertificateError)
	}

	tsMultiSignature, err := FromCertificateSignatureProto(header.TransactionSnapshotCertificate.SignedEntityType, header.TransactionSnapshotCertificate.MultiSignature, "")

	if err != nil {
		return errorsmod.Wrapf(ErrInvalidCertificate, "mithril transaction snapshot certificate cannot be parsed: error: %v", err)
	}

	_, verifyTsStandardCertificateError := msdVerifier.VerifyStandardCertificate(
		tsCertificate,
		tsMultiSignature.MultiSignature.ProtocolMultiSignature,
	)

	if verifyTsStandardCertificateError != nil {
		return errorsmod.Wrapf(ErrInvalidCertificate, "mithril transaction snapshot certificate is invalid: error: %v", verifyTsStandardCertificateError)
	}

	// compare data TransactionSnapshot and TransactionSnapshotCertificate
	if header.TransactionSnapshot.CertificateHash != header.TransactionSnapshotCertificate.Hash {
		return errorsmod.Wrapf(ErrInvalidCertificate, "mithril transaction snapshot certificate hash not match: TS.CertHash: %v, TSC.Hash: %v", header.TransactionSnapshot.CertificateHash, header.TransactionSnapshotCertificate.Hash)
	}

	tsCertificateProtocolMessage := tsCertificate.ProtocolMessage
	cardanoTxMerkleRoot, merkleRootExist := tsCertificateProtocolMessage.GetMessagePart("cardano_transactions_merkle_root")

	if !merkleRootExist || cardanoTxMerkleRoot == "" {
		return errorsmod.Wrapf(ErrInvalidCertificate, "mithril transaction snapshot certificate merkle root not exist")
	}

	if strings.Compare(header.TransactionSnapshot.MerkleRoot, string(cardanoTxMerkleRoot)) != 0 {
		return errorsmod.Wrapf(ErrInvalidCertificate, "mithril transaction snapshot certificate merkle root not match: TS.MerkleRoot: %v, TSC.cardano_transactions_merkle_root: %v", header.TransactionSnapshot.MerkleRoot, string(cardanoTxMerkleRoot))
	}

	tscCardanoTransactions := header.TransactionSnapshotCertificate.SignedEntityType.GetCardanoTransactions()

	if tscCardanoTransactions == nil {
		return errorsmod.Wrapf(ErrInvalidCertificate, "mithril transaction snapshot certificate CardanoTransactions not found")
	}

	if header.TransactionSnapshot.Epoch != tscCardanoTransactions.Epoch {
		return errorsmod.Wrapf(ErrInvalidCertificate, "mithril transaction snapshot certificate epoch not match: TS.Epoch: %v, TSC.Epoch: %v", header.TransactionSnapshot.Epoch, tscCardanoTransactions.Epoch)
	}

	if header.TransactionSnapshot.BlockNumber != tscCardanoTransactions.BlockNumber {
		return errorsmod.Wrapf(ErrInvalidCertificate, "mithril transaction snapshot certificate BlockNumber not match: TS.BlockNumber: %v, TSC.BlockNumber: %v", header.TransactionSnapshot.BlockNumber, tscCardanoTransactions.BlockNumber)
	}

	// not allow old one
	if header.TransactionSnapshot.Epoch < cs.CurrentEpoch || header.TransactionSnapshot.BlockNumber < cs.LatestHeight.RevisionHeight {
		return errorsmod.Wrapf(ErrInvalidCertificate, "Expect newer header: TS.Epoch: %v, cs.Epoch: %v, TS.BlockNumber: %v, cs.LatestHeight.RevisionHeight: %v", header.TransactionSnapshot.Epoch, cs.CurrentEpoch, header.TransactionSnapshot.BlockNumber, cs.LatestHeight.RevisionHeight)
	}

	// Verify that this header carries enough evidence to authenticate the
	// Cardano IBC commitment root (`ibc_state_root`) at this height.
	//
	// Plainly:
	// - Mithril certifies that a specific transaction happened at this block height (inclusion proof).
	// - Our `ibc_state_root` is not stored in Mithril; it is stored inside Cardano, in the HostState UTxO datum.
	// - So we authenticate the root by authenticating the *transaction that created the HostState output*,
	//   then extracting `ibc_state_root` from that output's inline datum.
	//
	// Without this step, membership/non-membership proofs for Cardano IBC state would be anchored to an
	// unauthenticated root and the light client would effectively be trusting the relayer/Gateway.
	if err := cs.verifyHostStateCommitmentEvidence(header); err != nil {
		return err
	}

	return nil
}

func (cs *ClientState) verifyHostStateCommitmentEvidence(header *MithrilHeader) error {
	if header.TransactionSnapshot == nil || header.TransactionSnapshotCertificate == nil {
		return errorsmod.Wrapf(ErrInvalidMithrilHeader, "missing transaction snapshot certificate")
	}

	if header.HostStateTxHash == "" || len(header.HostStateTxBodyCbor) == 0 || len(header.HostStateTxProof) == 0 {
		return errorsmod.Wrapf(ErrInvalidMithrilHeader, "missing host state commitment evidence")
	}

	// Step 1: Verify the Mithril transaction-set proof.
	//
	// This proves that `HostStateTxHash` is part of the Mithril-certified set of transactions for
	// `header.TransactionSnapshot.BlockNumber`, and ties that proof to the snapshot certificate.
	var proofs CardanoTransactionsProofsMessage
	if err := json.Unmarshal(header.HostStateTxProof, &proofs); err != nil {
		return errorsmod.Wrapf(ErrInvalidCardanoTransactionsProofs, "malformed host state tx proof: %v", err)
	}

	verified, err := proofs.Verify()
	if err != nil {
		return err
	}

	if strings.ToLower(verified.MerkleRoot) != strings.ToLower(header.TransactionSnapshot.MerkleRoot) {
		return errorsmod.Wrapf(
			ErrInvalidCardanoTransactionsProofs,
			"transaction proof merkle root mismatch: expected %s, got %s",
			header.TransactionSnapshot.MerkleRoot,
			verified.MerkleRoot,
		)
	}

	// The proof must be tied to the same snapshot certificate as the header.
	if proofs.CertificateHash != "" && proofs.CertificateHash != header.TransactionSnapshotCertificate.Hash {
		return errorsmod.Wrapf(
			ErrInvalidCardanoTransactionsProofs,
			"transaction proof certificate hash mismatch: expected %s, got %s",
			header.TransactionSnapshotCertificate.Hash,
			proofs.CertificateHash,
		)
	}

	found := false
	for _, txHash := range verified.CertifiedTransactions {
		if strings.ToLower(txHash) == strings.ToLower(header.HostStateTxHash) {
			found = true
			break
		}
	}
	if !found {
		return errorsmod.Wrapf(
			ErrInvalidCardanoTransactionsProofs,
			"host state tx hash not certified by transaction proof",
		)
	}

	// Step 2: Use the certified transaction body to derive the authenticated `ibc_state_root`.
	//
	// The relayer/Gateway provides:
	// - the transaction body CBOR
	// - an output index (which output is the HostState output)
	//
	// We do not "trust" that output index blindly: we check the output contains the HostState NFT
	// (stored in `ClientState`) and carries an inline datum. The datum is then decoded and the
	// `ibc_state_root` extracted. That root is the one we store in consensus state and use for proof verification.
	if _, err := cs.ExtractIbcStateRootFromHostStateTx(header); err != nil {
		return errorsmod.Wrapf(ErrInvalidMithrilHeader, "invalid host state tx body: %v", err)
	}

	return nil
}

func (cs *ClientState) UpdateState(
	ctx sdk.Context,
	cdc codec.BinaryCodec,
	clientStore storetypes.KVStore,
	clientMsg exported.ClientMessage,
) []exported.Height {
	// Type assert the client message to MithrilHeader
	header, ok := clientMsg.(*MithrilHeader)
	if !ok {
		panic(fmt.Errorf("expected type %T, got %T", &MithrilHeader{}, clientMsg))
	}

	cs.pruneOldestConsensusState(ctx, cdc, clientStore)

	// Retrieve the previous consensus state
	prevConsensusState, _ := GetConsensusState(clientStore, cdc, cs.LatestHeight)

	// Check for duplicate update
	if prevConsensusState.LatestCertHashTxSnapshot == header.TransactionSnapshotCertificate.Hash {
		return []exported.Height{header.GetHeight()} // No-op on duplicate update
	}

	// Update the latest height and current epoch
	height := NewHeight(0, header.TransactionSnapshot.BlockNumber)
	cs.LatestHeight = &height
	cs.CurrentEpoch = header.TransactionSnapshot.Epoch

	// Create a new consensus state.
	//
	// At this point `VerifyClientMessage` has already called `verifyHostStateCommitmentEvidence`,
	// which (a) verifies Mithril inclusion and (b) verifies we can extract `ibc_state_root` from
	// the HostState output datum. So this extraction should only fail if the header is internally
	// inconsistent (programming error) rather than because it is untrusted user input.
	ibcStateRoot, err := cs.ExtractIbcStateRootFromHostStateTx(header)
	if err != nil {
		panic(fmt.Errorf("failed to extract ibc_state_root from verified MithrilHeader: %w", err))
	}

	newConsensusState := &ConsensusState{
		Timestamp:                header.GetTimestamp(),
		FirstCertHashLatestEpoch: header.MithrilStakeDistributionCertificate,
		LatestCertHashTxSnapshot: header.TransactionSnapshotCertificate.Hash,
		IbcStateRoot:             ibcStateRoot,
	}

	// Set the latest certificate of transaction snapshot for the epoch
	setLcTsInEpoch(clientStore, *header.TransactionSnapshotCertificate, cs.CurrentEpoch)
	setFcInEpoch(clientStore, *header.MithrilStakeDistributionCertificate, cs.CurrentEpoch)

	// Update the client state, consensus state, and associated metadata in the store
	setClientState(clientStore, cdc, cs)
	setConsensusState(clientStore, cdc, newConsensusState, header.GetHeight())
	setConsensusMetadata(ctx, clientStore, header.GetHeight())

	return []exported.Height{height}
}

// pruneOldestConsensusState will retrieve the earliest consensus state for this clientID and check if it is expired. If it is,
// that consensus state will be pruned from store along with all associated metadata. This will prevent the client store from
// becoming bloated with expired consensus states that can no longer be used for updates and packet verification.
func (cs ClientState) pruneOldestConsensusState(ctx sdk.Context, cdc codec.BinaryCodec, clientStore storetypes.KVStore) {
	// Check the earliest consensus state to see if it is expired, if so then set the prune height
	// so that we can delete consensus state and all associated metadata.
	var (
		pruneHeight exported.Height
	)

	pruneCb := func(height exported.Height) bool {
		consState, found := GetConsensusState(clientStore, cdc, height)
		// this error should never occur
		if !found {
			panic(errorsmod.Wrapf(clienttypes.ErrConsensusStateNotFound, "failed to retrieve consensus state at height: %s", height))
		}

		if cs.IsExpired(consState.GetTimestamp(), ctx.BlockTime()) {
			pruneHeight = height
		}

		return true
	}

	IterateConsensusStateAscending(clientStore, pruneCb)

	// if pruneHeight is set, delete consensus state and metadata
	if pruneHeight != nil {
		deleteConsensusState(clientStore, pruneHeight)
		deleteConsensusMetadata(clientStore, pruneHeight)
	}
}

// UpdateStateOnMisbehaviour updates state upon misbehaviour, freezing the ClientState. This method should only be called when misbehaviour is detected
// as it does not perform any misbehaviour checks.
func (cs ClientState) UpdateStateOnMisbehaviour(ctx sdk.Context, cdc codec.BinaryCodec, clientStore storetypes.KVStore, _ exported.ClientMessage) {
	// cs.FrozenHeight = &FrozenHeight
	clientStore.Set(host.ClientStateKey(), clienttypes.MustMarshalClientState(cdc, &cs))
}
