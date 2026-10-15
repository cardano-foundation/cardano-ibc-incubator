// Package mithril verifies Mithril certificates that certify Cardano stake.
//
// Only the protocol message is signed. A certificate's hash, previous hash,
// epoch, signed entity type and metadata, including the protocol parameters
// that set the signing quorum, are not. Verification therefore chains through
// signed message parts: each verified certificate supplies the next epoch's
// aggregate verification key and protocol parameters hash.
package mithril

import (
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"math/big"
	"strconv"

	"github.com/cardano-foundation/cardano-ibc-incubator/cosmos/cardano-probabilistic-light-client-core/mithril/crypto"
	"golang.org/x/crypto/blake2b"
)

// ErrInvalidCertificate marks a certificate that does not verify against the
// trusted anchor for its epoch.
var ErrInvalidCertificate = errors.New("invalid Mithril certificate")

// Message part keys in the order of Mithril's ProtocolMessagePartKey enum. The
// signed message hashes parts in this order, so an unknown key fails closed.
var messagePartOrder = []string{
	"snapshot_digest",
	"cardano_transactions_merkle_root",
	"cardano_blocks_transactions_merkle_root",
	"next_aggregate_verification_key",
	"next_protocol_parameters",
	"current_epoch",
	"latest_block_number",
	"cardano_blocks_transactions_block_number_offset",
	"cardano_stake_distribution_epoch",
	"cardano_stake_distribution_merkle_root",
	"cardano_database_merkle_root",
	"next_aggregate_verification_key_snark",
}

// Anchor is the trusted Mithril signing state for one epoch.
type Anchor struct {
	Epoch uint64
	// Hex-encoded JSON, exactly as Mithril publishes it.
	AggregateVerificationKey string
	// Hex SHA-256 of k, m and phi_f, as in next_protocol_parameters.
	ProtocolParametersHash string
}

// StakeDistribution is a certified Cardano stake distribution.
type StakeDistribution struct {
	// Mithril's epoch for the snapshot taken at the end of that epoch.
	Epoch      uint64
	MerkleRoot string
}

// LeaderEpoch is the Cardano epoch whose slot leaders the distribution elects.
func (d StakeDistribution) LeaderEpoch() uint64 { return d.Epoch + 2 }

type certificateJSON struct {
	SignedMessage            string `json:"signed_message"`
	AggregateVerificationKey string `json:"aggregate_verification_key"`
	MultiSignature           string `json:"multi_signature"`
	GenesisSignature         string `json:"genesis_signature"`
	Metadata                 struct {
		Parameters struct {
			K    uint64  `json:"k"`
			M    uint64  `json:"m"`
			PhiF float64 `json:"phi_f"`
		} `json:"parameters"`
	} `json:"metadata"`
	ProtocolMessage struct {
		MessageParts map[string]string `json:"message_parts"`
	} `json:"protocol_message"`
}

// VerifyCertificates verifies certificates from consecutive epochs, starting
// at the anchor's epoch. It returns the anchor for the epoch after the last
// certificate and every stake distribution they certify.
func VerifyCertificates(anchor Anchor, certificates []string) (Anchor, []StakeDistribution, error) {
	if len(certificates) == 0 {
		return Anchor{}, nil, fmt.Errorf("%w: no certificates", ErrInvalidCertificate)
	}
	var distributions []StakeDistribution
	for index, certificate := range certificates {
		next, distribution, err := VerifyCertificate(anchor, []byte(certificate))
		if err != nil {
			return Anchor{}, nil, fmt.Errorf("certificate %d: %w", index, err)
		}
		if distribution != nil {
			distributions = append(distributions, *distribution)
		}
		anchor = next
	}
	return anchor, distributions, nil
}

// VerifyCertificate verifies one aggregator certificate against the anchor for
// its epoch. It returns the next epoch's anchor and the stake distribution the
// certificate certifies, if any.
func VerifyCertificate(anchor Anchor, raw []byte) (next Anchor, distribution *StakeDistribution, err error) {
	// The STM decoder and verifier index relayer-supplied structures.
	defer func() {
		if recovered := recover(); recovered != nil {
			next, distribution = Anchor{}, nil
			err = fmt.Errorf("%w: verifier panicked: %v", ErrInvalidCertificate, recovered)
		}
	}()
	var certificate certificateJSON
	if err := json.Unmarshal(raw, &certificate); err != nil {
		return Anchor{}, nil, fmt.Errorf("%w: %v", ErrInvalidCertificate, err)
	}
	if certificate.GenesisSignature != "" {
		return Anchor{}, nil, fmt.Errorf("%w: genesis certificates cannot extend an anchor", ErrInvalidCertificate)
	}
	parts := certificate.ProtocolMessage.MessageParts
	if parts["current_epoch"] != strconv.FormatUint(anchor.Epoch, 10) {
		return Anchor{}, nil, fmt.Errorf("%w: current_epoch %q is not anchor epoch %d", ErrInvalidCertificate, parts["current_epoch"], anchor.Epoch)
	}
	if certificate.AggregateVerificationKey != anchor.AggregateVerificationKey {
		return Anchor{}, nil, fmt.Errorf("%w: aggregate verification key differs from the anchor", ErrInvalidCertificate)
	}
	params := certificate.Metadata.Parameters
	paramsHash, err := ProtocolParametersHash(params.K, params.M, params.PhiF)
	if err != nil {
		return Anchor{}, nil, fmt.Errorf("%w: %v", ErrInvalidCertificate, err)
	}
	if paramsHash != anchor.ProtocolParametersHash {
		return Anchor{}, nil, fmt.Errorf("%w: protocol parameters differ from the anchor", ErrInvalidCertificate)
	}
	digest, err := messageDigest(parts)
	if err != nil {
		return Anchor{}, nil, err
	}
	if digest != certificate.SignedMessage {
		return Anchor{}, nil, fmt.Errorf("%w: signed message does not match the protocol message", ErrInvalidCertificate)
	}
	avk, err := decodeAggregateVerificationKey(anchor.AggregateVerificationKey)
	if err != nil {
		return Anchor{}, nil, err
	}
	signature, err := decodeMultiSignature(certificate.MultiSignature)
	if err != nil {
		return Anchor{}, nil, err
	}
	if err := signature.Verify([]byte(certificate.SignedMessage), avk, &crypto.StmParameters{K: params.K, M: params.M, PhiF: params.PhiF}); err != nil {
		return Anchor{}, nil, fmt.Errorf("%w: multi-signature: %v", ErrInvalidCertificate, err)
	}

	next = Anchor{
		Epoch:                    anchor.Epoch + 1,
		AggregateVerificationKey: parts["next_aggregate_verification_key"],
		ProtocolParametersHash:   parts["next_protocol_parameters"],
	}
	if next.AggregateVerificationKey == "" || !isHash(next.ProtocolParametersHash) {
		return Anchor{}, nil, fmt.Errorf("%w: missing next epoch signing state", ErrInvalidCertificate)
	}
	distribution, err = certifiedStake(anchor.Epoch, parts)
	if err != nil {
		return Anchor{}, nil, err
	}
	return next, distribution, nil
}

func certifiedStake(certificateEpoch uint64, parts map[string]string) (*StakeDistribution, error) {
	epochText, hasEpoch := parts["cardano_stake_distribution_epoch"]
	root, hasRoot := parts["cardano_stake_distribution_merkle_root"]
	if !hasEpoch && !hasRoot {
		return nil, nil
	}
	epoch, err := strconv.ParseUint(epochText, 10, 64)
	if err != nil || strconv.FormatUint(epoch, 10) != epochText || !isHash(root) {
		return nil, fmt.Errorf("%w: malformed stake distribution parts", ErrInvalidCertificate)
	}
	// Mithril certifies the distribution of epoch E-1 during epoch E.
	if epoch+1 != certificateEpoch {
		return nil, fmt.Errorf("%w: stake distribution epoch %d certified in epoch %d", ErrInvalidCertificate, epoch, certificateEpoch)
	}
	return &StakeDistribution{Epoch: epoch, MerkleRoot: root}, nil
}

func messageDigest(parts map[string]string) (string, error) {
	known := make(map[string]bool, len(messagePartOrder))
	for _, key := range messagePartOrder {
		known[key] = true
	}
	for key := range parts {
		if !known[key] {
			return "", fmt.Errorf("%w: unknown message part %q", ErrInvalidCertificate, key)
		}
	}
	hasher := sha256.New()
	for _, key := range messagePartOrder {
		if value, ok := parts[key]; ok {
			hasher.Write([]byte(key))
			hasher.Write([]byte(value))
		}
	}
	return hex.EncodeToString(hasher.Sum(nil)), nil
}

// ProtocolParametersHash returns Mithril's hash of the protocol parameters:
// SHA-256 over k and m as big-endian u64 and phi_f as big-endian U8F24.
func ProtocolParametersHash(k, m uint64, phiF float64) (string, error) {
	if k == 0 || m == 0 || !(phiF > 0 && phiF <= 1) {
		return "", fmt.Errorf("invalid protocol parameters k=%d m=%d phi_f=%v", k, m, phiF)
	}
	hasher := sha256.New()
	var word [8]byte
	binary.BigEndian.PutUint64(word[:], k)
	hasher.Write(word[:])
	binary.BigEndian.PutUint64(word[:], m)
	hasher.Write(word[:])
	binary.BigEndian.PutUint32(word[:4], u8f24(phiF))
	hasher.Write(word[:4])
	return hex.EncodeToString(hasher.Sum(nil)), nil
}

// u8f24 rounds to the nearest U8F24 value with ties to even, as the fixed
// crate's from_num does. The input is already bounded to (0, 1].
func u8f24(value float64) uint32 {
	scaled := new(big.Float).SetPrec(0).SetFloat64(value)
	scaled.SetMantExp(scaled, 24)
	integer, accuracy := scaled.Int(nil)
	if accuracy != big.Exact {
		fraction := new(big.Float).Sub(scaled, new(big.Float).SetInt(integer))
		switch fraction.Cmp(big.NewFloat(0.5)) {
		case 1:
			integer.Add(integer, big.NewInt(1))
		case 0:
			if integer.Bit(0) == 1 {
				integer.Add(integer, big.NewInt(1))
			}
		}
	}
	if !integer.IsUint64() || integer.Uint64() > math.MaxUint32 {
		return math.MaxUint32
	}
	return uint32(integer.Uint64())
}

func decodeAggregateVerificationKey(encoded string) (*crypto.StmAggrVerificationKey, error) {
	raw, err := hex.DecodeString(encoded)
	if err != nil {
		return nil, fmt.Errorf("%w: aggregate verification key: %v", ErrInvalidCertificate, err)
	}
	key := &crypto.StmAggrVerificationKey{}
	if err := json.Unmarshal(raw, key); err != nil {
		return nil, fmt.Errorf("%w: aggregate verification key: %v", ErrInvalidCertificate, err)
	}
	if key.MTCommitment == nil || key.TotalStake == 0 {
		return nil, fmt.Errorf("%w: aggregate verification key is incomplete", ErrInvalidCertificate)
	}
	if key.MTCommitment.Hasher == nil {
		key.MTCommitment.Hasher, _ = blake2b.New256(nil)
	}
	return key, nil
}

func decodeMultiSignature(encoded string) (*crypto.StmAggrSig, error) {
	raw, err := hex.DecodeString(encoded)
	if err != nil || len(raw) == 0 {
		return nil, fmt.Errorf("%w: multi-signature encoding", ErrInvalidCertificate)
	}
	signature := &crypto.StmAggrSig{}
	if err := json.Unmarshal(raw, signature); err != nil {
		return nil, fmt.Errorf("%w: multi-signature: %v", ErrInvalidCertificate, err)
	}
	if signature.BatchProof == nil || len(signature.Signatures) == 0 {
		return nil, fmt.Errorf("%w: multi-signature is incomplete", ErrInvalidCertificate)
	}
	for _, party := range signature.Signatures {
		if party.Sig == nil || party.Sig.Sigma == nil || party.RegParty == nil {
			return nil, fmt.Errorf("%w: multi-signature is incomplete", ErrInvalidCertificate)
		}
	}
	if signature.BatchProof.Hasher == nil {
		signature.BatchProof.Hasher, _ = blake2b.New256(nil)
	}
	return signature, nil
}

func isHash(value string) bool {
	if len(value) != 64 {
		return false
	}
	_, err := hex.DecodeString(value)
	return err == nil
}
