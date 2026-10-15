package mithril

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// A client bootstrapped in epoch C starts from a stake table that Mithril
// certified. Its trusted anchor is Mithril's signing state for epoch C-1, and
// its bootstrap completes with the certificate signed in C-1 that certifies
// the epoch C-2 distribution, which elects epoch C's leaders.

// BootstrapStake is what a client bootstrapped in an epoch needs from Mithril.
type BootstrapStake struct {
	// Anchor is Mithril's signing state for the epoch before the bootstrap
	// epoch. It is trusted like the bootstrap checkpoint.
	Anchor Anchor
	// Certificate is signed under Anchor and certifies the bootstrap table.
	Certificate []byte
}

var errBootstrapStakeMismatch = errors.New("the bootstrap stake table differs from the distribution Mithril certified")

// StakeAnchor derives the anchor for epoch from the certificate signed in
// epoch-1 that certifies the epoch-2 stake distribution. Its signed parts
// name the key and parameters that sign epoch's certificates. The anchor is
// trusted like the bootstrap checkpoint. The certificate itself is not
// verified here.
func StakeAnchor(certificate []byte, epoch uint64) (Anchor, error) {
	if epoch < 2 {
		return Anchor{}, fmt.Errorf("a Mithril anchor needs an epoch of at least 2")
	}
	var parsed certificateJSON
	if err := json.Unmarshal(certificate, &parsed); err != nil {
		return Anchor{}, fmt.Errorf("invalid Mithril certificate: %w", err)
	}
	parts := parsed.ProtocolMessage.MessageParts
	if parts["current_epoch"] != strconv.FormatUint(epoch-1, 10) || parts["cardano_stake_distribution_epoch"] != strconv.FormatUint(epoch-2, 10) {
		return Anchor{}, fmt.Errorf("Mithril certificate does not certify the epoch %d stake distribution", epoch-2)
	}
	anchor := Anchor{Epoch: epoch, AggregateVerificationKey: parts["next_aggregate_verification_key"], ProtocolParametersHash: parts["next_protocol_parameters"]}
	return anchor, ValidateAnchor(anchor)
}

// VerifyBootstrapStake verifies the certificate that completes the bootstrap
// of a client in epoch. It must verify under the anchor for epoch-1 and
// certify the distribution that elects epoch's leaders, whose Merkle root
// must be root. It returns the anchor for epoch.
func VerifyBootstrapStake(anchor Anchor, certificate []byte, epoch uint64, root string) (Anchor, error) {
	if anchor.Epoch+1 != epoch {
		return Anchor{}, fmt.Errorf("a client bootstrapped in epoch %d needs the Mithril anchor for epoch %d, not %d", epoch, epoch-1, anchor.Epoch)
	}
	next, distribution, err := VerifyCertificate(anchor, certificate)
	if err != nil {
		return Anchor{}, err
	}
	if distribution == nil || distribution.LeaderEpoch() != epoch {
		return Anchor{}, fmt.Errorf("%w: it does not certify the stake distribution that elects epoch %d", ErrInvalidCertificate, epoch)
	}
	if distribution.MerkleRoot != root {
		return Anchor{}, fmt.Errorf("%w for epoch %d", errBootstrapStakeMismatch, epoch)
	}
	return next, nil
}

// FetchBootstrapStake reads a bootstrap's Mithril inputs from an aggregator,
// such as https://aggregator.release-mainnet.api.mithril.network/aggregator,
// and checks the certified distribution against the bootstrap table. The
// certificate that sealed epoch-3's distribution names the anchor for
// epoch-1. The one that sealed epoch-2's distribution certifies the table.
func FetchBootstrapStake(aggregator string, epoch uint64, table []StakeEntry) (BootstrapStake, error) {
	if epoch < 3 {
		return BootstrapStake{}, fmt.Errorf("a Mithril bootstrap needs an epoch of at least 3")
	}
	base := strings.TrimRight(aggregator, "/")
	anchorCertificate, _, err := fetchStakeCertificate(base, epoch-3)
	if err != nil {
		return BootstrapStake{}, err
	}
	anchor, err := StakeAnchor(anchorCertificate, epoch-1)
	if err != nil {
		return BootstrapStake{}, err
	}
	certificate, distribution, err := fetchStakeCertificate(base, epoch-2)
	if err != nil {
		return BootstrapStake{}, err
	}
	root, err := StakeDistributionRoot(table)
	if err != nil {
		return BootstrapStake{}, err
	}
	if _, err := VerifyBootstrapStake(anchor, certificate, epoch, root); err != nil {
		if errors.Is(err, errBootstrapStakeMismatch) {
			return BootstrapStake{}, stakeDifference(epoch-2, distribution, table)
		}
		return BootstrapStake{}, err
	}
	return BootstrapStake{Anchor: anchor, Certificate: certificate}, nil
}

// stakeDifference explains why a table's root differs from the certified one.
// The artifact's distribution is not authenticated, so it only names the
// difference.
func stakeDifference(epoch uint64, distribution map[string]uint64, table []StakeEntry) error {
	if len(table) != len(distribution) {
		return fmt.Errorf("Mithril's epoch %d distribution has %d pools but the bootstrap table has %d", epoch, len(distribution), len(table))
	}
	for _, entry := range table {
		if stake, ok := distribution[entry.PoolID]; !ok || stake != entry.Stake {
			return fmt.Errorf("Mithril's epoch %d distribution differs from the bootstrap table for pool %s", epoch, entry.PoolID)
		}
	}
	return fmt.Errorf("Mithril's epoch %d distribution does not match its certificate", epoch)
}

// fetchStakeCertificate returns the certificate that sealed epoch's Cardano
// stake distribution, with the distribution the aggregator serves for it.
func fetchStakeCertificate(base string, epoch uint64) ([]byte, map[string]uint64, error) {
	raw, err := fetch(base + "/artifact/cardano-stake-distribution/epoch/" + strconv.FormatUint(epoch, 10))
	if err != nil {
		return nil, nil, err
	}
	var artifact struct {
		Epoch             uint64            `json:"epoch"`
		CertificateHash   string            `json:"certificate_hash"`
		StakeDistribution map[string]uint64 `json:"stake_distribution"`
	}
	if err := json.Unmarshal(raw, &artifact); err != nil {
		return nil, nil, fmt.Errorf("invalid Mithril stake distribution: %w", err)
	}
	if artifact.Epoch != epoch || !isHash(artifact.CertificateHash) {
		return nil, nil, fmt.Errorf("Mithril returned another artifact for the epoch %d stake distribution", epoch)
	}
	certificate, err := fetch(base + "/certificate/" + artifact.CertificateHash)
	if err != nil {
		return nil, nil, err
	}
	return certificate, artifact.StakeDistribution, nil
}

func fetch(url string) ([]byte, error) {
	client := http.Client{Timeout: 30 * time.Second}
	response, err := client.Get(url)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("GET %s: %s", url, response.Status)
	}
	return io.ReadAll(io.LimitReader(response.Body, 16<<20))
}
