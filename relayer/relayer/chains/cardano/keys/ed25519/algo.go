package ed25519

import (
	"github.com/cosmos/cosmos-sdk/crypto/hd"
	"github.com/cosmos/cosmos-sdk/crypto/keyring"
	"github.com/cosmos/cosmos-sdk/crypto/types"
	"github.com/jsambuo/go-cardano-serialization/bip32"
	"github.com/tyler-smith/go-bip39"
)

type Ed25519Algo struct {
}

var _ keyring.SignatureAlgo = (*Ed25519Algo)(nil)

func (a Ed25519Algo) Name() hd.PubKeyType {
	return hd.Ed25519Type
}

// Derive derives and returns the ed25519 private key for the given seed and HD path.
func (a Ed25519Algo) Derive() hd.DeriveFn {
	return func(mnemonic string, bip39Passphrase, hdPath string) ([]byte, error) {
		entropy, err := bip39.EntropyFromMnemonic(mnemonic)
		if err != nil {
			return nil, err
		}

		masterPriv := bip32.FromBip39Entropy(entropy, []byte(bip39Passphrase))

		harden := func(num uint) uint32 {
			return uint32(0x80000000 + num)
		}

		derivedKey := masterPriv.Derive(harden(1852)).Derive(harden(1815)).Derive(harden(0))

		return derivedKey, nil
	}
}

// Generate generates a ed25519 private key from the given bytes.
func (a Ed25519Algo) Generate() hd.GenerateFn {
	return func(bz []byte) types.PrivKey {
		return GenPrivKeyFromSecret(bz)
	}
}
