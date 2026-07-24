package probabilisticcore

import (
	"bytes"
	"testing"

	"github.com/fxamacker/cbor/v2"
)

func TestExtractIbcStateRootFromFourFieldHostStateDatum(t *testing.T) {
	root := bytes.Repeat([]byte{0x42}, 32)
	nftPolicy := bytes.Repeat([]byte{0x24}, 28)
	deployer := bytes.Repeat([]byte{0x17}, 28)

	datum := HostStateDatum{
		State: HostState{
			Version:              1,
			IbcStateRoot:         root,
			NextClientSequence:   2,
			NextConnectionSeq:    3,
			NextChannelSeq:       4,
			BoundPort:            []uint64{5, 6},
			LastUpdateTimeMillis: 7,
		},
		NftPolicy: nftPolicy,
		Deployer:  deployer,
		Shutdown:  cbor.RawMessage{0x80},
	}

	encoded, err := cbor.Marshal(datum)
	if err != nil {
		t.Fatalf("marshal datum: %v", err)
	}

	got, err := ExtractIbcStateRootFromHostStateDatum(encoded, nftPolicy)
	if err != nil {
		t.Fatalf("extract ibc state root: %v", err)
	}
	if !bytes.Equal(got, root) {
		t.Fatalf("unexpected root: got %x want %x", got, root)
	}
}

func TestExtractIbcStateRootRejectsUnexpectedNftPolicy(t *testing.T) {
	root := bytes.Repeat([]byte{0x42}, 32)
	nftPolicy := bytes.Repeat([]byte{0x24}, 28)
	otherPolicy := bytes.Repeat([]byte{0x25}, 28)

	encoded, err := cbor.Marshal(HostStateDatum{
		State: HostState{
			Version:              1,
			IbcStateRoot:         root,
			LastUpdateTimeMillis: 7,
		},
		NftPolicy: nftPolicy,
		Deployer:  bytes.Repeat([]byte{0x17}, 28),
		Shutdown:  cbor.RawMessage{0x80},
	})
	if err != nil {
		t.Fatalf("marshal datum: %v", err)
	}

	_, err = ExtractIbcStateRootFromHostStateDatum(encoded, otherPolicy)
	if err == nil {
		t.Fatal("expected unexpected nft_policy error")
	}
}
