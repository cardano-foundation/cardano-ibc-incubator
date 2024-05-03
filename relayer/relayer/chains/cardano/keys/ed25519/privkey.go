package ed25519

import (
	"bytes"
	"crypto/ed25519"

	"github.com/cosmos/cosmos-sdk/crypto/types"
	"github.com/jsambuo/go-cardano-serialization/bip32"
)

const (
	PrivKeySize = 96
	PrivKeyName = "ouroboros/PrivKeyEd25519"
)

var _ types.PrivKey = (*PrivKey)(nil)

// PrivKey interface
func (p *PrivKey) Bytes() []byte {
	return p.Key
}

func (p *PrivKey) Equals(other types.LedgerPrivKey) bool {
	pk2, ok := other.(*PrivKey)
	if !ok {
		return false
	}
	return bytes.Equal(p.Bytes(), pk2.Bytes())
}

func (p *PrivKey) PubKey() types.PubKey {
	xprv := bip32.XPrv(p.Key)
	return &PubKey{
		Key: ed25519.PublicKey(xprv.Public()),
	}
}

func (p *PrivKey) Sign(msg []byte) ([]byte, error) {
	xprv := bip32.XPrv(p.Key)
	sig := xprv.Sign(msg)
	return sig[:], nil
}

func (p *PrivKey) Type() string {
	return keyType
}

// PrivKey Generator
func GenPrivKeyFromSecret(secret []byte) *PrivKey {
	return &PrivKey{
		Key: []byte(bip32.XPrv(secret).
			Derive(0).  // account key
			Derive(0)), // address key
	}
}
