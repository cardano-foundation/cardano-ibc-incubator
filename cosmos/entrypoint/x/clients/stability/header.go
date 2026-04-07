package stability

import (
	"time"

	errorsmod "cosmossdk.io/errors"

	"github.com/cosmos/ibc-go/v10/modules/core/exported"
)

var _ exported.ClientMessage = (*StabilityHeader)(nil)

func (h StabilityHeader) ConsensusState() *ConsensusState {
	consState := &ConsensusState{
		Timestamp:         h.GetTimestamp(),
		IbcStateRoot:      make([]byte, 32),
		AcceptedBlockHash: h.AnchorBlock.Hash,
		AcceptedEpoch:     h.AnchorBlock.Epoch,
		UniquePoolsCount:  h.UniquePoolsCount,
		UniqueStakeBps:    h.UniqueStakeBps,
		SecurityScoreBps:  h.SecurityScoreBps,
	}

	if len(h.HostStateTxBodyCbor) > 0 {
		if root, err := extractIbcStateRootFromTransactionBody(h.HostStateTxBodyCbor, h.HostStateTxHash, h.HostStateTxOutputIndex, nil, nil); err == nil {
			consState.IbcStateRoot = root
		}
	}

	return consState
}

func (StabilityHeader) ClientType() string {
	return ModuleName
}

func (h StabilityHeader) GetHeight() exported.Height {
	return NewHeight(0, h.AnchorBlock.Height.RevisionHeight)
}

func (h StabilityHeader) GetTimestamp() uint64 {
	return h.AnchorBlock.Timestamp
}

func (h StabilityHeader) GetTime() time.Time {
	return time.Unix(int64(h.GetTimestamp()/uint64(time.Second)), int64(h.GetTimestamp()%uint64(time.Second)))
}

func (h StabilityHeader) ValidateBasic() error {
	if h.AnchorBlock == nil || h.AnchorBlock.Height == nil {
		return errorsmod.Wrap(ErrInvalidHeader, "anchor block must be present")
	}
	if h.AnchorBlock.Height.RevisionHeight == 0 {
		return errorsmod.Wrap(ErrInvalidHeaderHeight, "anchor block height cannot be zero")
	}
	if h.AnchorBlock.Hash == "" {
		return errorsmod.Wrap(ErrInvalidAcceptedBlock, "anchor block hash cannot be empty")
	}
	if len(h.HostStateTxBodyCbor) == 0 {
		return errorsmod.Wrap(ErrInvalidHostStateCommitment, "host_state_tx_body_cbor cannot be empty")
	}
	return nil
}
