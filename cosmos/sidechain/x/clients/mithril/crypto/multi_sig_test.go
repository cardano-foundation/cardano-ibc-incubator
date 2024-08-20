package crypto

import (
	"crypto/rand"
	"encoding/hex"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestSig(t *testing.T) {
	sk := generateSigningKeys(t, 1)[0]
	vk, err := new(VerificationKey).FromSigningKey(sk)
	assert.NoError(t, err, "generate verification key from valid signing key should be success")

	sig := sk.Sign(Const64Bytes)

	valid := sig.Verify(Const64Bytes, vk)
	assert.NoError(t, valid, "verify valid signature should be success")
}

func TestInvalidSig(t *testing.T) {
	sks := generateSigningKeys(t, 2)
	sk0, sk1 := sks[0], sks[1]

	vk0, err := new(VerificationKey).FromSigningKey(sk0)
	assert.NoError(t, err, "generate verification key from valid signing key should be success")

	fakeSig := sk1.Sign(Const64Bytes)

	valid := fakeSig.Verify(Const64Bytes, vk0)

	assert.Error(t, valid, "verify fake signature should be fail")
}

func TestAggregateSig(t *testing.T) {
	len := uint64(128)

	_, vks, sigs := generateSignatures(t, len)
	valid := new(Signature).VerifyAggregate(Const64Bytes, vks, sigs)

	assert.NoError(t, valid, "verify valid aggregate signatures should be success")
}

func TestSerializeDeserializeVk(t *testing.T) {
	_, vks := generateVks(t, 1)
	vk0 := vks[0]
	vk0Bytes := vk0.ToBytes()

	vk1, err := new(VerificationKey).FromBytes(vk0Bytes)
	assert.NoError(t, err, "deserialize verification key from valid bytes should be success")
	assert.Equal(t, vk0, vk1, "deserialized verification key does not match the original after deserialization from serialized bytes")
}

func TestSerializeDeserializeSk(t *testing.T) {
	sk0 := generateSigningKeys(t, 1)[0]
	sk0Bytes := sk0.ToBytes()

	sk1, err := new(SigningKey).FromBytes(sk0Bytes)
	assert.NoError(t, err, "deserialize signing key from valid bytes should be success")
	assert.Equal(t, sk0, sk1, "deserialized signing key does not match the original after deserialization from serialized bytes")
}

func TestBatchVerify(t *testing.T) {
	numBatches := 10
	numSigs := 10

	batchMsgs := [][]byte{}
	batchVk := []*VerificationKey{}
	batchSig := []*Signature{}

	for i := 0; i < numBatches; i++ {
		msg := make([]byte, 64)
		_, err := rand.Read(msg)
		assert.NoError(t, err, "generate random message should be success")

		mvks := []*VerificationKey{}
		sigs := []*Signature{}

		for j := 0; j < numSigs; j++ {
			ikm := make([]byte, 32)
			_, err := rand.Read(ikm)
			assert.NoError(t, err, "generate random ikm should be success")
			sk, err := Gen(ikm)
			assert.NoError(t, err, "generate signing key should be success")
			vk, err := new(VerificationKey).FromSigningKey(sk)
			assert.NoError(t, err, "derive verification key from valid signing key should be success")
			sig := sk.Sign(msg)
			sigs = append(sigs, sig)
			mvks = append(mvks, vk)
		}
		assert.NoError(t, new(Signature).VerifyAggregate(msg, mvks, sigs))
		aggVk, aggSig, err := new(Signature).Aggregate(mvks, sigs)
		assert.NoError(t, err, "verification keys aggregation and signtures aggregation should be success")
		batchMsgs = append(batchMsgs, msg)
		batchVk = append(batchVk, aggVk)
		batchSig = append(batchSig, aggSig)
	}
	assert.NoError(t, new(Signature).BatchVerifyAggregates(batchMsgs, batchVk, batchSig), "batch verification should be success")

	// If we have an invalid signature, the batch verification will fail
	sk := generateSigningKeys(t, 1)[0]
	fakeSig := sk.Sign(Const64Bytes)
	batchSig[0] = fakeSig

	assert.Error(t, new(Signature).BatchVerifyAggregates(batchMsgs, batchVk, batchSig), "batch verification with fake sig should be fail")
}

func TestEval(t *testing.T) {
	sk, err := Gen(Const32Bytes)
	assert.NoError(t, err)
	sig := sk.Sign(Const64Bytes)
	ev, err := sig.Eval(Const64Bytes, 0)
	evHex := hex.EncodeToString(ev)
	assert.NoError(t, err)
	expectedEvHex := "6357c6598357712cfe46f9cca981a2aeb627557b8f448d090ed884edae9e9fda36c571f3c3697549a8b0bca514b623c9903e6f64e7d4720c9f2da7e767634c02"
	assert.Equal(t, expectedEvHex, evHex)
}
