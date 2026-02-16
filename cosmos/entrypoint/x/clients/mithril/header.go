package mithril

import (
	"strings"
	"time"

	errorsmod "cosmossdk.io/errors"

	"github.com/cosmos/ibc-go/v8/modules/core/exported"
)

var _ exported.ClientMessage = (*MithrilHeader)(nil)

// ConsensusState returns the updated consensus state associated with the header
func (h MithrilHeader) ConsensusState() *ConsensusState {
	consState := &ConsensusState{
		Timestamp:                h.GetTimestamp(),
		FirstCertHashLatestEpoch: h.MithrilStakeDistributionCertificate,
		LatestCertHashTxSnapshot: h.TransactionSnapshot.CertificateHash,
		IbcStateRoot:             emptyHash,
	}

	// Best-effort extraction of the Cardano IBC root from the HostState transaction
	// carried in the header. The authoritative verification is performed as part of
	// `ClientState.verifyHostStateCommitmentEvidence()` during UpdateClient.
	if len(h.HostStateTxBodyCbor) > 0 {
		if txBody, err := decodeTransactionBody(h.HostStateTxBodyCbor); err == nil {
			outputs := txBody.Outputs()
			outputIndex := int(h.HostStateTxOutputIndex)
			if outputIndex >= 0 && outputIndex < len(outputs) {
				if datum := outputs[outputIndex].Datum(); datum != nil {
					if root, err := ExtractIbcStateRootFromHostStateDatum(datum.Cbor(), nil); err == nil {
						consState.IbcStateRoot = root
					}
				}
			}
		}
	}

	return consState
}

// ClientType defines that the Header is a Mithril header
func (MithrilHeader) ClientType() string {
	return ModuleName
}

// GetHeight returns the current height. It returns 0 if the Mithril
// header is nil.
func (h MithrilHeader) GetHeight() exported.Height {
	return NewHeight(0, h.TransactionSnapshot.BlockNumber)
}

// GetTimestamp returns the current block timestamp. It returns a zero time if
// the Mithril header is nil.
func (h MithrilHeader) GetTimestamp() uint64 {
	sealedAt, _ := time.Parse(time.RFC3339Nano, h.TransactionSnapshotCertificate.Metadata.SealedAt)
	return uint64(sealedAt.UnixNano())
}

func (h MithrilHeader) GetTime() time.Time {
	return time.Unix(int64(h.GetTimestamp()/uint64(time.Second)), int64(h.GetTimestamp()%uint64(time.Second)))
}

// ValidateBasic checks that mithril stake distrbution and  are not nil.
func (h MithrilHeader) ValidateBasic() error {
	if h.MithrilStakeDistribution == nil {
		return errorsmod.Wrap(ErrInvalidMithrilStakeDistribution, "mithril stake distribution cannot be nil")
	}
	if h.TransactionSnapshot == nil {
		return errorsmod.Wrap(ErrInvalidTransactionSnapshot, "transaction snapshot cannot be nil")
	}
	if h.MithrilStakeDistributionCertificate == nil {
		return errorsmod.Wrap(ErrInvalidMithrilStakeDistributionCertificate, "mithril stake distribution certificate cannot be nil")
	}
	if h.TransactionSnapshotCertificate == nil {
		return errorsmod.Wrap(ErrInvalidTransactionSnapshotCertificate, "transaction snapshot certificate cannot be nil")
	}
	if h.MithrilStakeDistribution.Epoch != h.TransactionSnapshot.Epoch {
		return errorsmod.Wrap(ErrInvalidMithrilHeader, "mithril stake distribution epoch does not match transaction snapshot epoch")
	}
	if !strings.EqualFold(h.MithrilStakeDistribution.CertificateHash, h.MithrilStakeDistributionCertificate.Hash) {
		return errorsmod.Wrap(ErrInvalidMithrilHeader, "mithril stake distribution does not match mithril stake distribution certificate")
	}
	if !strings.EqualFold(h.TransactionSnapshot.CertificateHash, h.TransactionSnapshotCertificate.Hash) {
		return errorsmod.Wrap(ErrInvalidMithrilHeader, "transaction snapshot does not match transaction snapshot certificate")
	}
	if strings.TrimSpace(h.HostStateTxHash) == "" {
		return errorsmod.Wrap(ErrInvalidMithrilHeader, "host_state_tx_hash cannot be empty")
	}
	if len(h.HostStateTxBodyCbor) == 0 {
		return errorsmod.Wrap(ErrInvalidMithrilHeader, "host_state_tx_body_cbor cannot be empty")
	}
	if len(h.HostStateTxProof) == 0 {
		return errorsmod.Wrap(ErrInvalidMithrilHeader, "host_state_tx_proof cannot be empty")
	}
	return nil
}
