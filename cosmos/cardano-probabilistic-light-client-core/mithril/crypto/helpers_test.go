package crypto_test

import (
	"encoding/hex"
	"testing"

	"github.com/cardano-foundation/cardano-ibc-incubator/cosmos/cardano-probabilistic-light-client-core/mithril/crypto"
	"github.com/cardano-foundation/cardano-ibc-incubator/cosmos/cardano-probabilistic-light-client-core/mithril/mithriltest/signing"
	"github.com/stretchr/testify/assert"
	blst "github.com/supranational/blst/bindings/go"
)

var (
	Const16Bytes = []byte{
		0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
	}

	Const32Bytes = []byte{
		0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
		16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31,
	}

	Const64Bytes = []byte{
		0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
		16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31,
		32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47,
		48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63,
	}
)

func TestVkFromP2Affine(t *testing.T) {
	signingKey, err := signing.Gen(Const32Bytes)
	assert.NoError(t, err, "signing key generation should be success")

	vk, err := signingKey.VerificationKey()
	assert.NoError(t, err, "verification key generation from valid signing key should be success")

	p2 := crypto.VkFromP2AffineForTest(vk)
	p2Bytes := p2.Serialize()
	p2Hex := hex.EncodeToString(p2Bytes)

	expectedP2Hex := "0cfd749941a5bea56796745d1fc91668d63f9522374cb6e9c033433e3216dcad48b4fc1ab7000a365f2861565daa6b0819fd041ac58eed8c441c8b3478df6ceeaf89cc02c8119f63891a1368d7ec1d0c7e2abaaae2ac8579b7eece473478dac70f170ab6ff2c30023a686560aea44adbe4d9938f9dd4e761311f23fc91f81b7c6e3037ece5d4428c88a494c65fbd95420e7dbc1ef1502e48bb553bcc411d4c42bc70170821815c0a8f1431421a099a45a74efd2d70623f02011040ec965316eb"
	assert.Equal(t, expectedP2Hex, p2Hex)
}

func TestSigToP1(t *testing.T) {
	sk, err := signing.Gen(Const32Bytes)
	assert.NoError(t, err, "signing key generation should be success")

	sig := sk.Sign(Const64Bytes)

	p1 := crypto.SigToP1ForTest(sig.BlstSig)
	p1Bytes := p1.Serialize()
	p1Hex := hex.EncodeToString(p1Bytes)

	expectedP1Hex := "173a1b545fe4fe265609093fcfd494d7ff9a70ce14456978af3673dd6da069b701a670e7c1088693662bf91e71239fff157d28f06f38421f52399bdd6827339e0e0890c730d3c84b829f6c01094f54c299dde91ed1cea751f82bd622a06bb7ce"
	assert.Equal(t, expectedP1Hex, p1Hex)
}

func TestP2AffineToVk(t *testing.T) {
	len := uint64(128)

	p2s := generateP2s(t, len)
	p2Affines := blst.P2sToAffine(p2s)
	scalars := generateScalars(t, len)

	p2 := p2Affines.Mult(scalars, int(len))
	blstVk := crypto.P2AffineToVkForTest(p2)
	blstVkBytes := blstVk.Serialize()
	blstVkHex := hex.EncodeToString(blstVkBytes)

	expectedBlstVkHex := "06b24c5978304dd9e318f9715915f72f7470bda0a4b579b26628b73b72ee4bfddf8f2edb77c35e60f759870590b28c221821aaf152fc655015c50cf486cfd6353e46f379617ec1c5ff943b1ecde42b4656bfb4b61949809b8cc565e3612ad90815301f28d821422849fd0e9da2ede5842a887227102d4848b06916ece2eb5dd003ecc4f57e49afb428e3845f54a6b9e502e1c608fe487ce9e2b1b398e7a16dffe7d26053e7eb1cd768a0e39b051d259ad4558890081dc1ff40e65ef7a62ae828"
	assert.Equal(t, expectedBlstVkHex, blstVkHex)
}

func TestP1AffineToSig(t *testing.T) {
	len := uint64(128)

	p1s := generateP1s(t, len)
	p1Affines := blst.P1sToAffine(p1s)
	scalars := generateScalars(t, len)

	p1 := p1Affines.Mult(scalars, int(len))
	blstSig := crypto.P1AffineToSigForTest(p1)
	blstSigBytes := blstSig.Serialize()
	blstSigHex := hex.EncodeToString(blstSigBytes)

	expectedBlstSigHex := "0f74191216e7e6b941eadb4f1e4a26e106f1590af3fa70e3fff317a0ea336073ff1e73a4d36a06d49b441f2d04e5a9ee0f43222044278cd6e4e45bc0d786f04535745431ba401e6fc9490383f0b83b86f7272fbb593d82a4fb069e53b45c764f"
	assert.Equal(t, expectedBlstSigHex, blstSigHex)
}

func generateIkmByIndex(idx uint64) []byte {
	ikm := append([]byte(nil), Const32Bytes...)
	ikm[0] = byte(idx)
	return ikm
}

func generateSigningKeys(t *testing.T, len uint64) []*signing.SigningKey {
	sks := []*signing.SigningKey{}
	for i := 0; i < int(len); i++ {
		ikm := generateIkmByIndex(uint64(i))

		sk, err := signing.Gen(ikm)
		sks = append(sks, sk)
		assert.NoError(t, err, "generate signing key should be success")
	}
	return sks
}

func generateVks(t *testing.T, len uint64) ([]*signing.SigningKey, []*crypto.VerificationKey) {
	sks := generateSigningKeys(t, len)

	vks := []*crypto.VerificationKey{}

	for i := 0; i < int(len); i++ {
		vk, err := sks[i].VerificationKey()
		assert.NoError(t, err, "generate verification key from signing key should be success")

		vks = append(vks, vk)
	}
	return sks, vks
}

func generateP1s(t *testing.T, len uint64) []*blst.P1 {
	_, _, sigs := generateSignatures(t, len)
	p1s := []*blst.P1{}
	for i := 0; i < int(len); i++ {
		p1 := crypto.SigToP1ForTest(sigs[i].BlstSig)
		p1s = append(p1s, p1)
	}
	return p1s
}

func generateP2s(t *testing.T, len uint64) []*blst.P2 {
	_, vks := generateVks(t, len)
	p2s := []*blst.P2{}
	for i := 0; i < int(len); i++ {
		p2 := crypto.VkFromP2AffineForTest(vks[i])
		p2s = append(p2s, p2)
	}
	return p2s
}

func generateScalars(t *testing.T, len uint64) []byte {
	scalars := []byte{}
	for i := 0; i < int(len); i++ {
		scalars = append(scalars, Const16Bytes...)
	}
	return scalars
}

func generateSignatures(t *testing.T, len uint64) ([]*signing.SigningKey, []*crypto.VerificationKey, []*crypto.Signature) {
	sks, vks := generateVks(t, len)

	sigs := []*crypto.Signature{}
	for i := 0; i < int(len); i++ {
		sigs = append(sigs, sks[i].Sign(Const64Bytes))
	}
	return sks, vks, sigs
}
