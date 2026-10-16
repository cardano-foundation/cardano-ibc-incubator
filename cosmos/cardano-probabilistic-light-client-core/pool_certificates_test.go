package probabilisticcore

import (
	"crypto/ed25519"
	"testing"

	ledgercbor "github.com/blinklabs-io/gouroboros/cbor"
	"github.com/blinklabs-io/gouroboros/ledger"
	"github.com/fxamacker/cbor/v2"
	"github.com/stretchr/testify/require"
	"golang.org/x/crypto/blake2b"
)

// These are synthetic body fixtures. Native header verification is tested
// separately. This tests certificate extraction at its authenticated-body boundary.
func poolCertificateBlock(t *testing.T, certificates []any, signers []ed25519.PrivateKey, invalid bool) []byte {
	t.Helper()
	body, err := cbor.Marshal(map[uint64]any{0: []any{}, 1: []any{}, 2: uint64(0), 4: certificates})
	require.NoError(t, err)
	txHash := blake2b.Sum256(body)
	witnesses := []any{}
	for _, signer := range signers {
		witnesses = append(witnesses, []any{[]byte(signer.Public().(ed25519.PublicKey)), ed25519.Sign(signer, txHash[:])})
	}
	invalidIndices := []uint{}
	if invalid {
		invalidIndices = append(invalidIndices, 0)
	}
	fields := []any{[]cbor.RawMessage{body}, []any{map[uint64]any{0: cbor.Tag{Number: 258, Content: witnesses}}}, map[uint64]any{}, invalidIndices}
	encoded := make([]cbor.RawMessage, len(fields))
	hashes := []byte{}
	for i, field := range fields {
		encoded[i], err = cbor.Marshal(field)
		require.NoError(t, err)
		hash := blake2b.Sum256(encoded[i])
		hashes = append(hashes, hash[:]...)
	}
	hash := blake2b.Sum256(hashes)
	header := &ledger.ConwayBlockHeader{}
	header.Body.BlockBodyHash = ledger.NewBlake2b256(hash[:])
	rawHeader, err := ledgercbor.Encode(header)
	require.NoError(t, err)
	block, err := cbor.Marshal([]any{cbor.RawMessage(rawHeader), encoded[0], encoded[1], encoded[2], encoded[3]})
	require.NoError(t, err)
	return block
}

func TestPoolCertificatesAuthenticateBodySignaturesAndOrder(t *testing.T) {
	operator := ed25519.NewKeyFromSeed(make([]byte, 32))
	ownerSeed := make([]byte, 32)
	ownerSeed[0] = 1
	owner := ed25519.NewKeyFromSeed(ownerSeed)
	operatorHash := ledger.IssuerVkey(operator.Public().(ed25519.PublicKey)).Hash()
	ownerHash := ledger.IssuerVkey(owner.Public().(ed25519.PublicKey)).Hash()
	rewardAccount := make([]byte, 29)
	rewardAccount[0] = 0xe0
	registration := []any{uint64(3), operatorHash.Bytes(), make([]byte, 32), uint64(0), uint64(0),
		cbor.Tag{Number: 30, Content: []uint64{0, 1}}, rewardAccount, [][]byte{ownerHash.Bytes()}, []any{}, nil}
	retirement := []any{uint64(4), operatorHash.Bytes(), uint64(9)}
	certificates := []any{registration, retirement, registration}
	decode := func(raw []byte) ledger.Block {
		block, err := DecodeLedgerBlock(raw)
		require.NoError(t, err)
		return block
	}
	validBody := poolCertificateBlock(t, certificates, []ed25519.PrivateKey{operator, owner}, false)
	events, err := AuthenticatedPoolCertificates(decode(validBody))
	require.NoError(t, err)
	require.Len(t, events, 3)
	require.Equal(t, operatorHash.Bech32("pool"), events[0].PoolID)
	require.False(t, events[0].Retirement)
	require.True(t, events[1].Retirement)
	require.Equal(t, uint64(9), events[1].RetirementEpoch)
	require.False(t, events[2].Retirement)
	brokenOperator := append(ed25519.PrivateKey(nil), operator...)
	brokenOperator[0] ^= 1
	for _, signers := range [][]ed25519.PrivateKey{nil, {operator}, {owner}, {brokenOperator, owner}} {
		_, err := AuthenticatedPoolCertificates(decode(poolCertificateBlock(t, certificates, signers, false)))
		require.ErrorContains(t, err, "signature")
	}
	events, err = AuthenticatedPoolCertificates(decode(poolCertificateBlock(t, certificates, nil, true)))
	require.NoError(t, err)
	require.Empty(t, events)
	var fields []cbor.RawMessage
	require.NoError(t, cbor.Unmarshal(validBody, &fields))
	fields[3] = cbor.RawMessage{0xa1, 0x00, 0xa0}
	tampered, err := cbor.Marshal(fields)
	require.NoError(t, err)
	_, err = AuthenticatedPoolCertificates(decode(tampered))
	require.ErrorContains(t, err, "not authenticated")
}
