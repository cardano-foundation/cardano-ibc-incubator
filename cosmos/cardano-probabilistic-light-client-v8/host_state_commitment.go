package probabilistic

import (
	errorsmod "cosmossdk.io/errors"
	probabilisticcore "github.com/cardano-foundation/cardano-ibc-incubator/cosmos/cardano-probabilistic-light-client-core"
)

func (cs ClientState) ExtractIbcStateRootFromHostStateTx(header *ProbabilisticHeader) ([]byte, error) {
	ibcStateRoot, err := probabilisticcore.ExtractIbcStateRootFromAnchorBlock(
		header.AnchorBlock.BlockCbor,
		header.HostStateTxHash,
		header.HostStateTxOutputIndex,
		cs.HostStateNftPolicyId,
		cs.HostStateNftTokenName,
	)
	if err != nil {
		return nil, errorsmod.Wrap(ErrInvalidHostStateCommitment, err.Error())
	}
	return ibcStateRoot, nil
}
