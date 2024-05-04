package ed25519

import (
	"bytes"

	"github.com/cometbft/cometbft/crypto"
	"github.com/cosmos/cosmos-sdk/crypto/types"
	"github.com/jsambuo/go-cardano-serialization/bip32"
)

const (
	PubKeyName = "ouroboros/PubKeyEd25519"
	keyType    = "ed25519"
)

var _ types.PubKey = (*PubKey)(nil)

// PubKey interface
func (p *PubKey) Address() types.Address {
	utxoPubKeyHash := bip32.XPub(p.Key).PublicKey().Hash()

	return crypto.Address(utxoPubKeyHash[:])
}

func (p *PubKey) Bytes() []byte {
	return bip32.XPub(p.Key).PublicKey()
}

func (p *PubKey) VerifySignature(msg []byte, sig []byte) bool {
	// not implemented
	return true
}

func (p *PubKey) Equals(other types.PubKey) bool {
	pk2, ok := other.(*PubKey)
	if !ok {
		return false
	}
	return bytes.Equal(p.Bytes(), pk2.Bytes())
}

func (p *PubKey) Type() string {
	return "ed25519"
}

func (p *PubKey) String() string {
	return string(p.Bytes())
}
