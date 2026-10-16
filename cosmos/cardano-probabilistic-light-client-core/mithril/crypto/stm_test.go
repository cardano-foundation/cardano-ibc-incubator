package crypto_test

import (
	"encoding/hex"
	"testing"

	"github.com/cardano-foundation/cardano-ibc-incubator/cosmos/cardano-probabilistic-light-client-core/mithril/mithriltest/signing"
	"github.com/stretchr/testify/assert"
)

func TestVerificationKeyToBytes(t *testing.T) {
	sk, err := signing.Gen(Const32Bytes)
	assert.NoError(t, err)
	vk, err := sk.VerificationKey()
	assert.NoError(t, err)
	vkBytes := vk.ToBytes()
	vkHex := hex.EncodeToString(vkBytes)
	expectedVkHex := "acfd749941a5bea56796745d1fc91668d63f9522374cb6e9c033433e3216dcad48b4fc1ab7000a365f2861565daa6b0819fd041ac58eed8c441c8b3478df6ceeaf89cc02c8119f63891a1368d7ec1d0c7e2abaaae2ac8579b7eece473478dac7"
	assert.Equal(t, expectedVkHex, vkHex)
}
