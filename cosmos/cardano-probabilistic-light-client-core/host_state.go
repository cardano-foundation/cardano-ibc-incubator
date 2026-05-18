package probabilisticcore

import (
	"bytes"
	"fmt"
	"strings"

	"github.com/blinklabs-io/gouroboros/ledger"
	"github.com/fxamacker/cbor/v2"
)

// HostStateDatum is the on-chain datum carried by the Cardano HostState UTxO.
//
// It is encoded as PlutusData (constructor 0) containing two fields:
// 1) state: HostState
// 2) nft_policy: PolicyId (bytes)
type HostStateDatum struct {
	_         struct{}  `cbor:",toarray"`
	State     HostState `cbor:"0"`
	NftPolicy []byte    `cbor:"1"`
}

// HostState is the canonical IBC host state committed on Cardano.
// Only the IbcStateRoot field is required for proof verification, but we keep
// the full shape so decoding stays aligned with the on-chain type.
type HostState struct {
	_                    struct{} `cbor:",toarray"`
	Version              uint64
	IbcStateRoot         []byte
	NextClientSequence   uint64
	NextConnectionSeq    uint64
	NextChannelSeq       uint64
	BoundPort            []uint64
	LastUpdateTimeMillis uint64
}

func ExtractIbcStateRootFromHostStateDatum(datumCbor []byte, expectedNftPolicyId []byte) ([]byte, error) {
	var datum HostStateDatum
	if err := cbor.Unmarshal(datumCbor, &datum); err != nil {
		return nil, fmt.Errorf("failed to decode HostState datum: %w", err)
	}

	if len(expectedNftPolicyId) > 0 && !bytes.Equal(datum.NftPolicy, expectedNftPolicyId) {
		return nil, fmt.Errorf("unexpected HostState nft_policy in datum")
	}

	if len(datum.State.IbcStateRoot) != 32 {
		return nil, fmt.Errorf("invalid ibc_state_root length: %d", len(datum.State.IbcStateRoot))
	}

	return datum.State.IbcStateRoot, nil
}

func ExtractIbcStateRootFromTransactionBody(
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

	txBody, err := DecodeTransactionBody(txBodyCbor)
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
	return ExtractIbcStateRootFromHostStateDatum(datum.Cbor(), hostStateNftPolicyId)
}

func DecodeTransactionBody(data []byte) (ledger.TransactionBody, error) {
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
