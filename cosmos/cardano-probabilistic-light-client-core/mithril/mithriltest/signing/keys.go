package signing

import (
	"fmt"

	"github.com/cardano-foundation/cardano-ibc-incubator/cosmos/cardano-probabilistic-light-client-core/mithril/crypto"
	blst "github.com/supranational/blst/bindings/go"
)

// SigningKey is a local certificate-generation key. It has no binary encoding.
type SigningKey struct {
	secret *blst.SecretKey
}

func Gen(ikm []byte) (*SigningKey, error) {
	secret := blst.KeyGen(ikm)
	if secret == nil {
		return nil, fmt.Errorf("invalid signing key seed")
	}
	return &SigningKey{secret: secret}, nil
}

func (sk *SigningKey) Sign(msg []byte) *crypto.Signature {
	return &crypto.Signature{BlstSig: new(blst.P1Affine).Sign(sk.secret, msg, nil)}
}

func (sk *SigningKey) VerificationKey() (*crypto.VerificationKey, error) {
	key := new(blst.P2Affine).From(sk.secret)
	if key == nil {
		return nil, fmt.Errorf("invalid signing key")
	}
	return &crypto.VerificationKey{BlstVk: key}, nil
}
