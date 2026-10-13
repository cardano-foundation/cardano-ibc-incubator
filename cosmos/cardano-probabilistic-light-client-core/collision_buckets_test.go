package probabilisticcore

import (
	"encoding/hex"
	"encoding/json"
	"os"
	"testing"

	ics23 "github.com/cosmos/ics23/go"
	"github.com/stretchr/testify/require"
)

type collisionVector struct {
	Name      string          `json:"name"`
	Key       string          `json:"key"`
	Committed string          `json:"committed"`
	Root      string          `json:"root"`
	Proof     json.RawMessage `json:"proof"`
}

func collisionVectors(t *testing.T) []collisionVector {
	t.Helper()
	data, err := os.ReadFile("../../tests/ibc-state-commitment/collision-buckets.json")
	require.NoError(t, err)
	var fixture struct {
		Vectors []collisionVector `json:"vectors"`
	}
	require.NoError(t, json.Unmarshal(data, &fixture))
	require.NotEmpty(t, fixture.Vectors)
	return fixture.Vectors
}

func TestCollisionBucketsMatchGatewayAndAiken(t *testing.T) {
	for _, vector := range collisionVectors(t) {
		t.Run(vector.Name, func(t *testing.T) {
			root, err := hex.DecodeString(vector.Root)
			require.NoError(t, err)
			value, err := hex.DecodeString(vector.Committed)
			require.NoError(t, err)
			laneRoot := PacketLaneRoot{Port: "transfer", Channel: "channel-0", Lane: 2, LaneCount: 4, Height: 11, Version: 1, Root: root}
			if len(value) == 0 {
				proof, err := DecodeJSONNonExistenceProof(vector.Proof)
				require.NoError(t, err)
				require.NoError(t, VerifyIbcStateNonMembershipWithNonExistenceProof(root, []byte(vector.Key), proof))
				require.NoError(t, VerifyPacketLaneNonMembership(laneRoot, 11, []byte(vector.Key), proof))
			} else {
				proof, err := DecodeJSONExistenceProof(vector.Proof)
				require.NoError(t, err)
				require.NoError(t, VerifyIbcStateMembershipWithExistenceProof(root, []byte(vector.Key), value, proof, nil))
				require.NoError(t, VerifyPacketLaneMembership(laneRoot, 11, []byte(vector.Key), value, proof))
			}
		})
	}
}

func TestCollisionBucketRejectsFabricatedRecords(t *testing.T) {
	vector := collisionVectors(t)[1] // Requested key and one synthetic peer share this route.
	root, _ := hex.DecodeString(vector.Root)
	value, _ := hex.DecodeString(vector.Committed)
	fresh := func() *ics23.ExistenceProof {
		proof, err := DecodeJSONExistenceProof(vector.Proof)
		require.NoError(t, err)
		return proof
	}
	for name, mutate := range map[string]func(*ics23.ExistenceProof){
		"wrong marker":     func(p *ics23.ExistenceProof) { p.Path[0].Prefix[0] = 3 },
		"truncated record": func(p *ics23.ExistenceProof) { p.Path[0].Prefix = p.Path[0].Prefix[:128] },
		"wrong path":       func(p *ics23.ExistenceProof) { p.Path[0].Prefix[1] ^= 1 },
		"duplicate key":    func(p *ics23.ExistenceProof) { copy(p.Path[0].Prefix[65:97], p.Path[0].Prefix[1:33]) },
		"unsorted keys": func(p *ics23.ExistenceProof) {
			p.Path[0].Prefix = append(append([]byte{2}, p.Path[0].Prefix[65:]...), p.Path[0].Prefix[1:65]...)
		},
		"empty peer value":      func(p *ics23.ExistenceProof) { copy(p.Path[0].Prefix[33:65], emptyValueHash[:]) },
		"changed peer value":    func(p *ics23.ExistenceProof) { p.Path[0].Prefix[33] ^= 1 },
		"missing requested key": func(p *ics23.ExistenceProof) { p.Path[0].Prefix = p.Path[0].Prefix[:65] },
		"wrong requested value": func(p *ics23.ExistenceProof) { p.Path[0].Prefix[97] ^= 1 },
		"wrong descriptor hash": func(p *ics23.ExistenceProof) { p.Path[0].Hash = ics23.HashOp_SHA512 },
		"descriptor suffix":     func(p *ics23.ExistenceProof) { p.Path[0].Suffix = make([]byte, 32) },
		"nil descriptor":        func(p *ics23.ExistenceProof) { p.Path[0] = nil },
		"short tree path":       func(p *ics23.ExistenceProof) { p.Path = p.Path[:64] },
		"extra descriptor":      func(p *ics23.ExistenceProof) { p.Path = append(p.Path[:1], p.Path...) },
		"omitted bucket":        func(p *ics23.ExistenceProof) { p.Path = p.Path[1:] },
	} {
		t.Run(name, func(t *testing.T) {
			proof := fresh()
			mutate(proof)
			require.Error(t, VerifyIbcStateMembershipWithExistenceProof(root, []byte(vector.Key), value, proof, nil))
		})
	}
	proof := fresh()
	proof.Value = nil
	require.Error(t, VerifyIbcStateNonMembershipWithNonExistenceProof(root, []byte(vector.Key), &ics23.NonExistenceProof{Key: proof.Key, Left: proof}))
	// Membership must compare the committed value before trusting its digest.
	require.Error(t, VerifyIbcStateMembershipWithExistenceProof(root, []byte(vector.Key), []byte{9}, fresh(), nil))
}
