package probabilistic

import probabilisticcore "github.com/cardano-foundation/cardano-ibc-incubator/cosmos/cardano-probabilistic-light-client-core"

func (cs ClientState) ExtractIbcStateRootFromHostStateTx(header *ProbabilisticHeader) ([]byte, error) {
	txBodyCbor, err := extractHostStateTxBodyCborFromAnchorBlock(header)
	if err != nil {
		return nil, err
	}
	return extractIbcStateRootFromTransactionBody(
		txBodyCbor,
		header.HostStateTxHash,
		header.HostStateTxOutputIndex,
		cs.HostStateNftPolicyId,
		cs.HostStateNftTokenName,
	)
}

func extractIbcStateRootFromTransactionBody(
	txBodyCbor []byte,
	txHash string,
	outputIndex uint32,
	hostStateNftPolicyId []byte,
	hostStateNftTokenName []byte,
) ([]byte, error) {
	return probabilisticcore.ExtractIbcStateRootFromTransactionBody(
		txBodyCbor,
		txHash,
		outputIndex,
		hostStateNftPolicyId,
		hostStateNftTokenName,
	)
}

var decodeTransactionBody = probabilisticcore.DecodeTransactionBody
