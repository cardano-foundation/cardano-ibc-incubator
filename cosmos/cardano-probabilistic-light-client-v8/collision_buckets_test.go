package probabilistic

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	core "github.com/cardano-foundation/cardano-ibc-incubator/cosmos/cardano-probabilistic-light-client-core"
	commitmenttypes "github.com/cosmos/ibc-go/v8/modules/core/23-commitment/types"
	ics23 "github.com/cosmos/ics23/go"
	"github.com/fxamacker/cbor/v2"
	"os"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestCollisionBucketGatewayProtobufProofs(t *testing.T) {
	data, err := os.ReadFile("../../tests/ibc-state-commitment/collision-buckets.json")
	require.NoError(t, err)
	var fixture struct {
		Vectors []struct {
			Name      string `json:"name"`
			Key       string `json:"key"`
			Committed string `json:"committed"`
			Root      string `json:"root"`
			Protobuf  string `json:"protobuf"`
		} `json:"vectors"`
	}
	require.NoError(t, json.Unmarshal(data, &fixture))
	require.NotEmpty(t, fixture.Vectors)
	for _, vector := range fixture.Vectors {
		t.Run(vector.Name, func(t *testing.T) {
			root, err := hex.DecodeString(vector.Root)
			require.NoError(t, err)
			value, err := hex.DecodeString(vector.Committed)
			require.NoError(t, err)
			proof, err := hex.DecodeString(vector.Protobuf)
			require.NoError(t, err)
			if len(value) == 0 {
				require.NoError(t, VerifyIbcStateNonMembership(root, []byte(vector.Key), proof))
				root[0] ^= 1
				require.Error(t, VerifyIbcStateNonMembership(root, []byte(vector.Key), proof))
			} else {
				// These original vectors use generic payloads. Keep their roots pinned.
				existence, err := decodeExistenceProof(proof)
				require.NoError(t, err)
				originalRoot, err := core.ComputeRootFromProofPath([]byte(vector.Key), value, existence.Path)
				require.NoError(t, err)
				require.Equal(t, root, originalRoot)
				// A packet leaf commits the CBOR bytestring rather than the raw packet.
				existence.Value, err = cbor.Marshal(value)
				require.NoError(t, err)
				if len(existence.Path) == 65 {
					keyHash := sha256.Sum256([]byte(vector.Key))
					valueHash := sha256.Sum256(existence.Value)
					bucket := existence.Path[0].Prefix
					for offset := 1; offset < len(bucket); offset += 64 {
						if bytes.Equal(bucket[offset:offset+32], keyHash[:]) {
							copy(bucket[offset+32:offset+64], valueHash[:])
						}
					}
				}
				root, err = core.ComputeRootFromProofPath([]byte(vector.Key), existence.Value, existence.Path)
				require.NoError(t, err)
				proof, err = (&commitmenttypes.MerkleProof{Proofs: []*ics23.CommitmentProof{{Proof: &ics23.CommitmentProof_Exist{Exist: existence}}}}).Marshal()
				require.NoError(t, err)
				require.NoError(t, VerifyIbcStateMembership(root, []byte(vector.Key), value, proof))
				require.Error(t, VerifyIbcStateMembership(root, []byte(vector.Key), []byte{9}, proof))
				root[0] ^= 1
				require.Error(t, VerifyIbcStateMembership(root, []byte(vector.Key), value, proof))
			}
		})
	}
}
