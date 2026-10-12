package probabilisticcore

import (
	"encoding/hex"
	"encoding/json"
	"os"
	"testing"

	ics23 "github.com/cosmos/ics23/go"
	"github.com/stretchr/testify/require"
)

func TestIbcStateProofsFromGatewayAndAiken(t *testing.T) {
	data, err := os.ReadFile("../../tests/ibc-state-commitment/proofs.json")
	require.NoError(t, err)
	var fixture struct {
		Version int `json:"version"`
		Vectors []struct {
			Name, Key, Committed, Root string
			Proof                      json.RawMessage
		}
	}
	require.NoError(t, json.Unmarshal(data, &fixture))
	require.Equal(t, 1, fixture.Version)
	require.Len(t, fixture.Vectors, 7)
	for _, vector := range fixture.Vectors {
		t.Run(vector.Name, func(t *testing.T) {
			root, err := hex.DecodeString(vector.Root)
			require.NoError(t, err)
			value, err := hex.DecodeString(vector.Committed)
			require.NoError(t, err)
			key := []byte(vector.Key)
			if len(value) == 0 {
				proof, err := DecodeJSONNonExistenceProof(vector.Proof)
				require.NoError(t, err)
				require.NoError(t, VerifyIbcStateNonMembershipWithNonExistenceProof(root, key, proof))
				proof.Left.Key = []byte("different-key")
				require.Error(t, VerifyIbcStateNonMembershipWithNonExistenceProof(root, key, proof))
				proof.Left.Key = key
				proof.Right = proof.Left
				require.Error(t, VerifyIbcStateNonMembershipWithNonExistenceProof(root, key, proof))
				proof.Right = nil
				proof.Left.Value = []byte{1}
				require.Error(t, VerifyIbcStateNonMembershipWithNonExistenceProof(root, key, proof))
				return
			}
			fresh := func() *ics23.ExistenceProof {
				proof, err := DecodeJSONExistenceProof(vector.Proof)
				require.NoError(t, err)
				return proof
			}
			require.NoError(t, VerifyIbcStateMembershipWithExistenceProof(root, key, value, fresh(), nil))
			for name, mutate := range map[string]func(*ics23.ExistenceProof){
				"different key":   func(p *ics23.ExistenceProof) { p.Key = []byte("different-key") },
				"different value": func(p *ics23.ExistenceProof) { p.Value = []byte{1} },
				"short path":      func(p *ics23.ExistenceProof) { p.Path = p.Path[:63] },
				"long path":       func(p *ics23.ExistenceProof) { p.Path = append(p.Path, p.Path[0]) },
				"nil operation":   func(p *ics23.ExistenceProof) { p.Path[0] = nil },
				"wrong prefix":    func(p *ics23.ExistenceProof) { p.Path[0].Prefix = []byte{0} },
				"wrong hash":      func(p *ics23.ExistenceProof) { p.Path[0].Hash = ics23.HashOp_SHA512 },
			} {
				t.Run(name, func(t *testing.T) {
					proof := fresh()
					mutate(proof)
					require.Error(t, VerifyIbcStateMembershipWithExistenceProof(root, key, value, proof, nil))
				})
			}
			root[0] ^= 1
			require.Error(t, VerifyIbcStateMembershipWithExistenceProof(root, key, value, fresh(), nil))
		})
	}
}

func TestMalformedProofsFailWithoutPanicking(t *testing.T) {
	for _, data := range []string{"", "null", "{}", `{"proofs":[]}`, `{"proofs":[null]}`, `{"proofs":[{"exist":{"key":"zz"}}]}`, `{"proofs":[{"exist":{},"nonexist":{}}]}`, `{"proofs":[{"exist":{}},{"exist":{}}]}`} {
		_, err := DecodeJSONExistenceProof([]byte(data))
		require.Error(t, err)
		_, err = DecodeJSONNonExistenceProof([]byte(data))
		require.Error(t, err)
	}
	require.Error(t, VerifyIbcStateMembershipWithExistenceProof(make([]byte, 32), nil, nil, &ics23.ExistenceProof{}, nil))
	require.Error(t, VerifyIbcStateMembershipWithExistenceProof(nil, nil, []byte{1}, nil, nil))
	require.Error(t, VerifyIbcStateNonMembershipWithNonExistenceProof(nil, nil, nil))
	require.Error(t, VerifyIbcStateNonMembershipWithNonExistenceProof(nil, nil, &ics23.NonExistenceProof{}))
}
