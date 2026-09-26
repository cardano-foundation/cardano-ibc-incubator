package probabilistic

import (
	"bytes"
	"encoding/hex"
	"encoding/json"
	"os"
	"testing"
	"time"

	gogotypes "github.com/cosmos/gogoproto/types"

	commitmenttypes "github.com/cosmos/ibc-go/v10/modules/core/23-commitment/types"
	tm "github.com/cosmos/ibc-go/v10/modules/light-clients/07-tendermint"
)

// The shared vectors are generated with the runtime's ICS23MerkleTree and
// encodeConsensusStateValue. Both roots commit the same consensus value.
func TestConsensusProofsBindRevision(t *testing.T) {
	data, err := os.ReadFile("../cardano-probabilistic-light-client-core/testdata/consensus_revision_proofs.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixtures []struct {
		Key   string          `json:"key"`
		Root  string          `json:"root"`
		Proof json.RawMessage `json:"proof"`
	}
	if err := json.Unmarshal(data, &fixtures); err != nil {
		t.Fatal(err)
	}
	consensus := tm.ConsensusState{
		Timestamp:          time.Unix(0, 1000),
		NextValidatorsHash: bytes.Repeat([]byte{0x11}, 32),
		Root:               commitmenttypes.MerkleRoot{Hash: bytes.Repeat([]byte{0x22}, 32)},
	}
	value, err := consensus.Marshal()
	if err != nil {
		t.Fatal(err)
	}
	wrapped := gogotypes.Any{TypeUrl: "/ibc.lightclients.tendermint.v1.ConsensusState", Value: value}
	value, err = wrapped.Marshal()
	if err != nil {
		t.Fatal(err)
	}
	for _, fixture := range fixtures {
		root, err := hex.DecodeString(fixture.Root)
		if err != nil {
			t.Fatal(err)
		}
		for _, path := range []string{
			"clients/07-tendermint-0/consensusStates/1-100",
			"clients/07-tendermint-0/consensusStates/2-100",
			"clients/07-tendermint-0/consensusStates/0-100",
		} {
			t.Run(fixture.Key+"/requested/"+path, func(t *testing.T) {
				key, err := ibcStateKeyFromPath(commitmenttypes.NewMerklePath([]byte("ibc"), []byte(path)))
				if err != nil {
					t.Fatal(err)
				}
				err = VerifyIbcStateMembership(root, key, value, fixture.Proof)
				if path == fixture.Key {
					if err != nil {
						t.Fatalf("rejected matching revision proof: %v", err)
					}
				} else if err == nil {
					t.Fatal("accepted proof for a different revision or a legacy height-only key")
				}
			})
		}
	}
}
