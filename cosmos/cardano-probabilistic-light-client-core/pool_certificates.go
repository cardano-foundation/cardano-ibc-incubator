package probabilisticcore

import (
	"crypto/ed25519"
	"encoding/hex"
	"fmt"

	ledgercbor "github.com/blinklabs-io/gouroboros/cbor"
	"github.com/blinklabs-io/gouroboros/ledger"
	"github.com/blinklabs-io/gouroboros/ledger/common"
	"github.com/fxamacker/cbor/v2"
)

// PoolCertificate is a registration projection of a certificate in an
// authenticated block body. It deliberately contains no stake amounts.
type PoolCertificate struct {
	PoolID          string
	VRFKeyHash      []byte
	Retirement      bool
	RetirementEpoch uint64
}

// AuthenticatedPoolCertificates authenticates the complete body and preserves
// transaction and certificate order. Phase-two-invalid transactions do not
// apply certificates. Pool operators and registration owners must sign the
// transaction body. Other ledger rules still rely on the consensus assumption
// that accepted bodies are ledger-valid, as with packet-state reapplication.
func AuthenticatedPoolCertificates(block ledger.Block) ([]PoolCertificate, error) {
	bodyHash, err := BlockBodyHash(block)
	if err != nil {
		return nil, err
	}
	valid, err := verifyNativeBlockBody(block, bodyHash)
	if err != nil || !valid {
		return nil, fmt.Errorf("pool certificate block body is not authenticated: %v", err)
	}
	var result []PoolCertificate
	for index, tx := range block.Transactions() {
		if transactionIndexIsInvalid(block, uint(index)) || !tx.IsValid() {
			continue
		}
		var signedKeys map[string]bool
		for _, certificate := range tx.Certificates() {
			var event PoolCertificate
			var required [][]byte
			switch certificate := certificate.(type) {
			case *ledger.PoolRegistrationCertificate:
				event.PoolID = certificate.Operator.Bech32("pool")
				event.VRFKeyHash = append([]byte(nil), certificate.VrfKeyHash.Bytes()...)
				required = append(required, certificate.Operator.Bytes())
				for _, owner := range certificate.PoolOwners {
					required = append(required, owner.Bytes())
				}
			case *ledger.PoolRetirementCertificate:
				event.PoolID = certificate.PoolKeyHash.Bech32("pool")
				event.Retirement, event.RetirementEpoch = true, certificate.Epoch
				required = append(required, certificate.PoolKeyHash.Bytes())
			default:
				continue
			}
			if signedKeys == nil {
				signedKeys = make(map[string]bool)
				if tx.Witnesses() == nil {
					return nil, fmt.Errorf("pool certificate transaction has no witnesses")
				}
				// The raw-body decoder intentionally keeps witness sets as raw
				// CBOR. Read the vkey subset from those authenticated bytes rather
				// than rely on an unpopulated decoded-witness cache.
				rawWitness, ok := tx.Witnesses().(interface{ Cbor() []byte })
				if !ok {
					return nil, fmt.Errorf("pool certificate raw witnesses are unavailable")
				}
				var fields map[uint64]cbor.RawMessage
				if err := cbor.Unmarshal(rawWitness.Cbor(), &fields); err != nil {
					return nil, fmt.Errorf("pool certificate witnesses cannot be decoded: %w", err)
				}
				var witnesses ledgercbor.SetType[common.VkeyWitness]
				if raw := fields[0]; len(raw) != 0 {
					if _, err := ledgercbor.Decode(raw, &witnesses); err != nil {
						return nil, fmt.Errorf("pool certificate vkey witnesses cannot be decoded: %w", err)
					}
				}
				for _, witness := range witnesses.Items() {
					if len(witness.Vkey) == ed25519.PublicKeySize &&
						ed25519.Verify(witness.Vkey, tx.Hash().Bytes(), witness.Signature) {
						keyHash := ledger.IssuerVkey(witness.Vkey).Hash()
						signedKeys[hex.EncodeToString(keyHash.Bytes())] = true
					}
				}
			}
			for _, keyHash := range required {
				if !signedKeys[hex.EncodeToString(keyHash)] {
					return nil, fmt.Errorf("pool certificate for %s is missing an authenticated operator or owner signature", event.PoolID)
				}
			}
			result = append(result, event)
		}
	}
	return result, nil
}
