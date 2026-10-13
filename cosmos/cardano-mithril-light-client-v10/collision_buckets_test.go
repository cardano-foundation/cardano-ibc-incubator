package mithril

import (
	"encoding/hex"
	"encoding/json"
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
				require.NoError(t, VerifyIbcStateMembership(root, []byte(vector.Key), value, proof))
				require.Error(t, VerifyIbcStateMembership(root, []byte(vector.Key), []byte{9}, proof))
				root[0] ^= 1
				require.Error(t, VerifyIbcStateMembership(root, []byte(vector.Key), value, proof))
			}
		})
	}
}
