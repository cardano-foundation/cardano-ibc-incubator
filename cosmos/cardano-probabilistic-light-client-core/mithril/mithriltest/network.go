// Package mithriltest signs Mithril certificates with locally generated keys.
// It exists for tests: its certificates verify only against its own anchors.
package mithriltest

import (
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strconv"

	"github.com/cardano-foundation/cardano-ibc-incubator/cosmos/cardano-probabilistic-light-client-core/mithril"
	"github.com/cardano-foundation/cardano-ibc-incubator/cosmos/cardano-probabilistic-light-client-core/mithril/crypto"
	"github.com/cardano-foundation/cardano-ibc-incubator/cosmos/cardano-probabilistic-light-client-core/mithril/mithriltest/signing"
)

// Network is one epoch's Mithril signers.
type Network struct {
	params  crypto.StmParameters
	signers []*signing.StmSigner
	clerk   *signing.StmClerk
	// AggregateVerificationKey is hex-encoded JSON, as Mithril publishes it.
	AggregateVerificationKey string
	ProtocolParametersHash   string
}

// NewNetwork registers one signer per stake with small test parameters.
func NewNetwork(stakes ...uint64) (*Network, error) {
	params := crypto.StmParameters{K: 5, M: 50, PhiF: 0.8}
	registration := &signing.KeyReg{Keys: map[*crypto.VerificationKey]crypto.Stake{}}
	initializers := make([]*signing.StmInitializer, 0, len(stakes))
	for _, stake := range stakes {
		initializer, err := new(signing.StmInitializer).Setup(&params, crypto.Stake(stake))
		if err != nil {
			return nil, err
		}
		registration.Keys[initializer.Pk] = crypto.Stake(stake)
		initializers = append(initializers, initializer)
	}
	closed, err := registration.Close()
	if err != nil {
		return nil, err
	}
	network := &Network{params: params, clerk: signing.FromRegistration(&params, closed)}
	for _, initializer := range initializers {
		signer, err := initializer.NewSigner(closed)
		if err != nil {
			return nil, err
		}
		network.signers = append(network.signers, signer)
	}
	// mithril-stm's serde layout: byte strings as number arrays, null hashers.
	avk := network.clerk.ComputeAVK()
	encoded, err := json.Marshal(map[string]any{
		"mt_commitment": map[string]any{"root": numbers(avk.MTCommitment.Root), "nr_leaves": avk.MTCommitment.NrLeaves, "hasher": nil},
		"total_stake":   avk.TotalStake,
	})
	if err != nil {
		return nil, err
	}
	network.AggregateVerificationKey = hex.EncodeToString(encoded)
	network.ProtocolParametersHash, err = mithril.ProtocolParametersHash(params.K, params.M, params.PhiF)
	return network, err
}

// Anchor is the trust anchor for this network signing the given epoch.
func (n *Network) Anchor(epoch uint64) mithril.Anchor {
	return mithril.Anchor{Epoch: epoch, AggregateVerificationKey: n.AggregateVerificationKey, ProtocolParametersHash: n.ProtocolParametersHash}
}

// StakeCertificate signs a certificate for epoch that hands over to next and
// certifies root as the stake distribution of epoch-1, which elects the
// leaders of epoch+1.
func (n *Network) StakeCertificate(epoch uint64, next *Network, root string) (string, error) {
	parts := map[string]string{
		"next_aggregate_verification_key":        next.AggregateVerificationKey,
		"next_protocol_parameters":               next.ProtocolParametersHash,
		"current_epoch":                          strconv.FormatUint(epoch, 10),
		"cardano_stake_distribution_epoch":       strconv.FormatUint(epoch-1, 10),
		"cardano_stake_distribution_merkle_root": root,
	}
	return n.Certificate(parts)
}

// Bootstrap returns the anchor and the certificate that bootstrap a client in
// epoch whose stake table has root.
func (n *Network) Bootstrap(epoch uint64, root string) (mithril.Anchor, string, error) {
	certificate, err := n.StakeCertificate(epoch-1, n, root)
	return n.Anchor(epoch - 1), certificate, err
}

// Certificate signs arbitrary protocol message parts.
func (n *Network) Certificate(parts map[string]string) (string, error) {
	signedMessage, err := mithril.ProtocolMessageHash(parts)
	if err != nil {
		return "", err
	}
	message := []byte(signedMessage)
	var signatures []*crypto.StmSig
	for _, signer := range n.signers {
		signature, err := signer.Sign(message)
		if err != nil {
			return "", err
		}
		if signature != nil {
			signatures = append(signatures, signature)
		}
	}
	aggregate, err := n.clerk.Aggregate(signatures, message)
	if err != nil {
		return "", err
	}
	multiSignature, err := encodeAggregate(aggregate)
	if err != nil {
		return "", err
	}
	certificate := map[string]any{
		"signed_message":             signedMessage,
		"aggregate_verification_key": n.AggregateVerificationKey,
		"multi_signature":            multiSignature,
		"genesis_signature":          "",
		"metadata": map[string]any{"parameters": map[string]any{
			"k": n.params.K, "m": n.params.M, "phi_f": n.params.PhiF,
		}},
		"protocol_message": map[string]any{"message_parts": parts},
	}
	encoded, err := json.Marshal(certificate)
	return string(encoded), err
}

// encodeAggregate writes the aggregator's JSON layout: each signature with its
// registered party as [verification key bytes, stake].
func encodeAggregate(aggregate *crypto.StmAggrSig) (string, error) {
	entries := make([][]any, 0, len(aggregate.Signatures))
	for _, party := range aggregate.Signatures {
		if party.Sig == nil || party.RegParty == nil {
			return "", fmt.Errorf("incomplete aggregate signature")
		}
		entries = append(entries, []any{
			map[string]any{"sigma": numbers(party.Sig.Sigma.ToBytes()), "indexes": party.Sig.Indexes, "signer_index": party.Sig.SignerIndex},
			[]any{numbers(party.RegParty.VerificationKey.ToBytes()), party.RegParty.Stake},
		})
	}
	values := make([][]int, 0, len(aggregate.BatchProof.Values))
	for _, value := range aggregate.BatchProof.Values {
		values = append(values, numbers(value))
	}
	proof := map[string]any{"values": values, "indices": aggregate.BatchProof.Indices, "hasher": nil}
	encoded, err := json.Marshal(map[string]any{"signatures": entries, "batch_proof": proof})
	return hex.EncodeToString(encoded), err
}

func numbers(data []byte) []int {
	result := make([]int, len(data))
	for i, b := range data {
		result[i] = int(b)
	}
	return result
}
