package probabilistic

import (
	"bytes"
	"compress/gzip"
	"encoding/hex"
	"encoding/json"
	"io"
	"os"
	"testing"
	"time"

	"github.com/blinklabs-io/gouroboros/cbor"
	"github.com/stretchr/testify/require"

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

func readBoundaryGzip(t *testing.T, name string) []byte {
	t.Helper()
	file, err := os.Open("../cardano-probabilistic-light-client-core/testdata/" + name)
	require.NoError(t, err)
	defer file.Close()
	reader, err := gzip.NewReader(file)
	require.NoError(t, err)
	defer reader.Close()
	data, err := io.ReadAll(reader)
	require.NoError(t, err)
	return data
}

// Reuse signed contiguous history while moving the anchor and retaining only
// compact headers in the temporary suffix.
func boundaryCheckpointAt(t *testing.T, original *ProbabilisticHeader, trusted, anchor uint64) *ProbabilisticHeader {
	t.Helper()
	header := fromCoreProbabilisticHeader(toCoreProbabilisticHeader(original))
	blocks := append(header.BridgeBlocks, header.AnchorBlock)
	blocks = append(blocks, header.DescendantBlocks...)
	header.TrustedHeight = NewHeight(0, trusted)
	header.BridgeBlocks, header.DescendantBlocks = nil, nil
	for _, block := range blocks {
		height := block.Height.RevisionHeight
		if height <= trusted {
			continue
		}
		if height < anchor {
			header.BridgeBlocks = append(header.BridgeBlocks, block)
		} else if height == anchor {
			header.AnchorBlock = block
		} else {
			if len(block.BlockCbor) > 0 {
				var fields []cbor.RawMessage
				_, err := cbor.Decode(block.BlockCbor, &fields)
				require.NoError(t, err)
				block.HeaderCbor, block.BlockCbor = bytes.Clone(fields[0]), nil
			}
			header.DescendantBlocks = append(header.DescendantBlocks, block)
		}
	}
	return header
}
