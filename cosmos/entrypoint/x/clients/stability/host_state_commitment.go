package stability

import (
	"fmt"
	"strings"

	mithril "entrypoint/x/clients/mithril"
	"github.com/blinklabs-io/gouroboros/ledger"
)

func (cs ClientState) ExtractIbcStateRootFromHostStateTx(header *StabilityHeader) ([]byte, error) {
	return extractIbcStateRootFromTransactionBody(
		header.HostStateTxBodyCbor,
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
	if txHash == "" {
		return nil, fmt.Errorf("missing HostState transaction hash in header")
	}
	if len(txBodyCbor) == 0 {
		return nil, fmt.Errorf("missing HostState transaction body CBOR in header")
	}

	txBody, err := decodeTransactionBody(txBodyCbor)
	if err != nil {
		return nil, fmt.Errorf("failed to decode HostState tx body: %w", err)
	}
	if strings.ToLower(txBody.Hash()) != strings.ToLower(txHash) {
		return nil, fmt.Errorf("HostState tx body hash mismatch")
	}

	outputs := txBody.Outputs()
	idx := int(outputIndex)
	if idx < 0 || idx >= len(outputs) {
		return nil, fmt.Errorf("HostState output index out of range")
	}

	out := outputs[idx]
	if len(hostStateNftPolicyId) > 0 && len(hostStateNftTokenName) > 0 {
		assets := out.Assets()
		if assets == nil {
			return nil, fmt.Errorf("HostState output has no multi-assets")
		}
		policy := ledger.NewBlake2b224(hostStateNftPolicyId)
		if assets.Asset(policy, hostStateNftTokenName) != 1 {
			return nil, fmt.Errorf("HostState output does not contain the expected HostState NFT")
		}
	}

	datum := out.Datum()
	if datum == nil {
		return nil, fmt.Errorf("HostState output has no inline datum")
	}
	return mithril.ExtractIbcStateRootFromHostStateDatum(datum.Cbor(), hostStateNftPolicyId)
}

func decodeTransactionBody(data []byte) (ledger.TransactionBody, error) {
	if body, err := ledger.NewConwayTransactionBodyFromCbor(data); err == nil {
		return body, nil
	}
	if body, err := ledger.NewBabbageTransactionBodyFromCbor(data); err == nil {
		return body, nil
	}
	if body, err := ledger.NewAlonzoTransactionBodyFromCbor(data); err == nil {
		return body, nil
	}
	if body, err := ledger.NewMaryTransactionBodyFromCbor(data); err == nil {
		return body, nil
	}
	if body, err := ledger.NewAllegraTransactionBodyFromCbor(data); err == nil {
		return body, nil
	}
	if body, err := ledger.NewShelleyTransactionBodyFromCbor(data); err == nil {
		return body, nil
	}
	return nil, fmt.Errorf("unsupported transaction body CBOR")
}
