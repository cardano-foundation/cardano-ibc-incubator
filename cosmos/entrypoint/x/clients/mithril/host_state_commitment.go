package mithril

import (
	"fmt"
	"strings"

	"github.com/blinklabs-io/gouroboros/ledger"
)

// ExtractIbcStateRootFromHostStateTx derives the Cardano IBC commitment root (`ibc_state_root`)
// from a transaction body that is expected to create (or update) the HostState UTxO.
//
// Important context:
// - Mithril authenticates *transaction inclusion*, not "all ledger state".
// - Our Cardano IBC root lives in the inline datum of the HostState UTxO.
// - Therefore the Cosmos-side client authenticates the root by:
//  1. verifying the HostState transaction is included in a Mithril-certified transaction snapshot,
//  2. parsing the certified transaction body,
//  3. locating the HostState output by the HostState NFT, and
//  4. extracting `ibc_state_root` from the output datum.
//
// The returned root is stored in consensus state and used to verify membership/non-membership proofs
// for Cardano IBC host state (clients, connections, channels, packet state, etc.).
func (cs ClientState) ExtractIbcStateRootFromHostStateTx(header *MithrilHeader) ([]byte, error) {
	if len(cs.HostStateNftPolicyId) == 0 || len(cs.HostStateNftTokenName) == 0 {
		return nil, fmt.Errorf("missing HostState NFT identification in client state")
	}

	if header.HostStateTxHash == "" {
		return nil, fmt.Errorf("missing HostState transaction hash in header")
	}
	if len(header.HostStateTxBodyCbor) == 0 {
		return nil, fmt.Errorf("missing HostState transaction body CBOR in header")
	}

	txBody, err := decodeTransactionBody(header.HostStateTxBodyCbor)
	if err != nil {
		return nil, fmt.Errorf("failed to decode HostState tx body: %w", err)
	}

	if strings.ToLower(txBody.Hash()) != strings.ToLower(header.HostStateTxHash) {
		return nil, fmt.Errorf("HostState tx body hash mismatch")
	}

	outputs := txBody.Outputs()
	outputIndex := int(header.HostStateTxOutputIndex)
	if outputIndex < 0 || outputIndex >= len(outputs) {
		return nil, fmt.Errorf("HostState output index out of range")
	}

	// The relayer provides `HostStateTxOutputIndex`, but we do not treat it as authoritative.
	// We verify that the selected output actually carries the HostState NFT; otherwise a relayer
	// could point us at an unrelated output with an arbitrary datum.
	out := outputs[outputIndex]
	assets := out.Assets()
	if assets == nil {
		return nil, fmt.Errorf("HostState output has no multi-assets")
	}

	policy := ledger.NewBlake2b224(cs.HostStateNftPolicyId)
	amount := assets.Asset(policy, cs.HostStateNftTokenName)
	if amount != 1 {
		return nil, fmt.Errorf("HostState output does not contain the expected HostState NFT")
	}

	datum := out.Datum()
	if datum == nil {
		return nil, fmt.Errorf("HostState output has no inline datum")
	}

	// The HostState datum is the canonical commitment to Cardano IBC state.
	// We decode it and extract the 32-byte `ibc_state_root` for proof verification.
	return ExtractIbcStateRootFromHostStateDatum(datum.Cbor(), cs.HostStateNftPolicyId)
}

func decodeTransactionBody(data []byte) (ledger.TransactionBody, error) {
	// Prefer the most recent eras first.
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
