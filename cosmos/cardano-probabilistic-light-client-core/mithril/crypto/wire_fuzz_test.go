package crypto

import (
	"encoding/hex"
	"encoding/json"
	"testing"
)

func referenceSeeds(f *testing.F) []referenceCase {
	t := &testing.T{}
	cases := loadReferenceCases(t)
	if t.Failed() {
		f.Fatal("reference vectors are unavailable")
	}
	return cases
}

// Decoding never panics, and anything it accepts is complete.
func FuzzDecodeAggregateSignature(f *testing.F) {
	for _, reference := range referenceSeeds(f) {
		raw, _ := hex.DecodeString(reference.Aggregate.MultiSignature)
		f.Add(raw)
	}
	f.Add([]byte(`{"signatures":[],"batch_proof":null}`))
	f.Fuzz(func(t *testing.T, data []byte) {
		var signature StmAggrSig
		if json.Unmarshal(data, &signature) != nil {
			return
		}
		if len(signature.Signatures) == 0 || signature.BatchProof == nil || signature.BatchProof.Hasher == nil {
			t.Fatal("accepted an incomplete aggregate signature")
		}
		for _, value := range signature.BatchProof.Values {
			if len(value) != merkleNodeBytes {
				t.Fatal("accepted a malformed batch proof node")
			}
		}
		for _, party := range signature.Signatures {
			if party.Sig == nil || party.Sig.Sigma == nil || party.Sig.Sigma.BlstSig == nil || party.RegParty == nil || party.RegParty.VerificationKey == nil || len(party.Sig.Indexes) == 0 {
				t.Fatal("accepted an incomplete signature")
			}
		}
	})
}

func FuzzDecodeAggregateVerificationKey(f *testing.F) {
	for _, reference := range referenceSeeds(f) {
		raw, _ := hex.DecodeString(reference.AggregateVerificationKey)
		f.Add(raw)
	}
	f.Fuzz(func(t *testing.T, data []byte) {
		var key StmAggrVerificationKey
		if json.Unmarshal(data, &key) != nil {
			return
		}
		if key.MTCommitment == nil || len(key.MTCommitment.Root) != merkleNodeBytes || key.MTCommitment.NrLeaves == 0 || key.TotalStake == 0 {
			t.Fatal("accepted an incomplete aggregate verification key")
		}
	})
}

// Verification of any decodable aggregate signature returns without panicking.
func FuzzVerifyAggregateSignature(f *testing.F) {
	cases := referenceSeeds(f)
	for index, reference := range cases {
		raw, _ := hex.DecodeString(reference.Aggregate.MultiSignature)
		f.Add(uint8(index), raw)
	}
	f.Fuzz(func(t *testing.T, choice uint8, data []byte) {
		reference := cases[int(choice)%len(cases)]
		var signature StmAggrSig
		if json.Unmarshal(data, &signature) != nil {
			return
		}
		var key StmAggrVerificationKey
		raw, _ := hex.DecodeString(reference.AggregateVerificationKey)
		if err := json.Unmarshal(raw, &key); err != nil {
			t.Fatal(err)
		}
		message, _ := hex.DecodeString(reference.Message)
		params := &StmParameters{K: reference.Params.K, M: reference.Params.M, PhiF: reference.Params.PhiF}
		_ = signature.Verify(message, &key, params)
	})
}
