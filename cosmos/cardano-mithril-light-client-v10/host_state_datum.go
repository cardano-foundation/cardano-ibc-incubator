package mithril

import (
	"bytes"
	"fmt"

	"github.com/fxamacker/cbor/v2"
)

// HostStateDatum is the on-chain datum carried by the Cardano HostState UTxO.
//
// It is encoded as PlutusData (constructor 0) containing two fields:
// 1) state: HostState
// 2) nft_policy: PolicyId (bytes)
//
// We decode it here so the Cosmos-side Mithril light client can extract the
// authenticated `ibc_state_root` from a certified HostState transaction output.
type HostStateDatum struct {
	_         struct{}  `cbor:",toarray"`
	State     HostState `cbor:"0"`
	NftPolicy []byte    `cbor:"1"`
}

// HostState is the canonical IBC host state committed on Cardano.
// Only the `IbcStateRoot` field is required for proof verification, but we keep
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
