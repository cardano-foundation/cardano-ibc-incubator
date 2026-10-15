package crypto

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"

	"golang.org/x/crypto/blake2b"
)

// The JSON that mithril-stm's serde derives produce for aggregate keys and
// signatures. Decoding is strict: every integer goes into a typed field, so
// fractions, exponents, signs and overflow are rejected. Byte strings must be
// JSON arrays of their exact length. Unknown fields, duplicate keys and
// trailing data are rejected, and PhantomData hashers must be null.

const (
	signatureBytes       = 48
	verificationKeyBytes = 96
	merkleNodeBytes      = 32
)

type wireBytes []byte

func (b *wireBytes) UnmarshalJSON(data []byte) error {
	if len(data) == 0 || data[0] != '[' {
		return fmt.Errorf("byte string must be a JSON array")
	}
	var values []uint8
	if err := json.Unmarshal(data, &values); err != nil {
		return err
	}
	*b = values
	return nil
}

type wireMerkleCommitment struct {
	Root     wireBytes `json:"root"`
	NrLeaves uint64    `json:"nr_leaves"`
	Hasher   *struct{} `json:"hasher"`
}

type wireAggregateKey struct {
	MTCommitment *wireMerkleCommitment `json:"mt_commitment"`
	TotalStake   Stake                 `json:"total_stake"`
}

type wireSignature struct {
	Sigma       wireBytes `json:"sigma"`
	Indexes     []Index   `json:"indexes"`
	SignerIndex Index     `json:"signer_index"`
}

type wireBatchPath struct {
	Values  []wireBytes `json:"values"`
	Indices []uint64    `json:"indices"`
	Hasher  *struct{}   `json:"hasher"`
}

type wireAggregateSignature struct {
	// Each entry is a [signature, [verification key, stake]] pair.
	Signatures []json.RawMessage `json:"signatures"`
	BatchProof *wireBatchPath    `json:"batch_proof"`
}

func (k *StmAggrVerificationKey) UnmarshalJSON(data []byte) error {
	var wire wireAggregateKey
	if err := strictJSON(data, &wire); err != nil {
		return fmt.Errorf("aggregate verification key: %w", err)
	}
	commitment := wire.MTCommitment
	if commitment == nil || len(commitment.Root) != merkleNodeBytes || commitment.NrLeaves == 0 || commitment.Hasher != nil || wire.TotalStake == 0 {
		return fmt.Errorf("aggregate verification key is incomplete or malformed")
	}
	hasher, _ := blake2b.New256(nil)
	k.MTCommitment = &MerkleTreeCommitmentBatchCompat{Root: commitment.Root, NrLeaves: commitment.NrLeaves, Hasher: hasher}
	k.TotalStake = wire.TotalStake
	return nil
}

func (s *StmAggrSig) UnmarshalJSON(data []byte) error {
	var wire wireAggregateSignature
	if err := strictJSON(data, &wire); err != nil {
		return fmt.Errorf("aggregate signature: %w", err)
	}
	proof := wire.BatchProof
	if len(wire.Signatures) == 0 || proof == nil || proof.Hasher != nil || len(proof.Indices) == 0 {
		return fmt.Errorf("aggregate signature is incomplete or malformed")
	}
	values := make([][]byte, 0, len(proof.Values))
	for _, value := range proof.Values {
		if len(value) != merkleNodeBytes {
			return fmt.Errorf("batch proof node must be %d bytes", merkleNodeBytes)
		}
		values = append(values, value)
	}
	signatures := make([]StmSigRegParty, 0, len(wire.Signatures))
	for _, entry := range wire.Signatures {
		signature, err := decodeSignatureEntry(entry)
		if err != nil {
			return err
		}
		signatures = append(signatures, *signature)
	}
	hasher, _ := blake2b.New256(nil)
	s.Signatures = signatures
	s.BatchProof = &BatchPath{Values: values, Indices: proof.Indices, Hasher: hasher}
	return nil
}

func decodeSignatureEntry(entry json.RawMessage) (*StmSigRegParty, error) {
	var pair []json.RawMessage
	if err := strictJSON(entry, &pair); err != nil || len(pair) != 2 {
		return nil, fmt.Errorf("signature entry must be a [signature, registered party] pair")
	}
	var signature wireSignature
	if err := strictJSON(pair[0], &signature); err != nil {
		return nil, fmt.Errorf("signature: %w", err)
	}
	if len(signature.Sigma) != signatureBytes || len(signature.Indexes) == 0 {
		return nil, fmt.Errorf("signature must have a %d-byte sigma and at least one index", signatureBytes)
	}
	var party []json.RawMessage
	if err := strictJSON(pair[1], &party); err != nil || len(party) != 2 {
		return nil, fmt.Errorf("registered party must be a [verification key, stake] pair")
	}
	var key wireBytes
	if err := strictJSON(party[0], &key); err != nil || len(key) != verificationKeyBytes {
		return nil, fmt.Errorf("registered party verification key must be %d bytes", verificationKeyBytes)
	}
	var stake Stake
	if err := strictJSON(party[1], &stake); err != nil {
		return nil, fmt.Errorf("registered party stake: %w", err)
	}
	sigma, err := new(Signature).FromBytes(signature.Sigma)
	if err != nil {
		return nil, err
	}
	verificationKey, err := new(VerificationKey).FromBytes(key)
	if err != nil {
		return nil, err
	}
	return &StmSigRegParty{
		Sig:      &StmSig{Sigma: sigma, Indexes: signature.Indexes, SignerIndex: signature.SignerIndex},
		RegParty: &RegParty{VerificationKey: verificationKey, Stake: stake},
	}, nil
}

// strictJSON decodes exactly one JSON value into v, rejecting unknown fields,
// duplicate object keys and trailing data.
func strictJSON(data []byte, v any) error {
	if err := rejectDuplicateKeys(data); err != nil {
		return err
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(v); err != nil {
		return err
	}
	if _, err := decoder.Token(); err != io.EOF {
		return fmt.Errorf("unexpected data after the JSON value")
	}
	return nil
}

func rejectDuplicateKeys(data []byte) error {
	type frame struct {
		object, expectKey bool
		keys              map[string]bool
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	var stack []*frame
	for {
		token, err := decoder.Token()
		if err == io.EOF {
			return nil
		}
		if err != nil {
			return err
		}
		if n := len(stack); n > 0 && stack[n-1].object && stack[n-1].expectKey {
			top := stack[n-1]
			if token == json.Delim('}') {
				stack = stack[:n-1]
				continue
			}
			key, _ := token.(string)
			if top.keys[key] {
				return fmt.Errorf("duplicate JSON key %q", key)
			}
			top.keys[key] = true
			top.expectKey = false
			continue
		}
		if n := len(stack); n > 0 && stack[n-1].object {
			stack[n-1].expectKey = true
		}
		switch token {
		case json.Delim('{'):
			stack = append(stack, &frame{object: true, expectKey: true, keys: map[string]bool{}})
		case json.Delim('['):
			stack = append(stack, &frame{})
		case json.Delim(']'):
			stack = stack[:len(stack)-1]
		}
	}
}
