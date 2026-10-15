package mithril

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// StakeAnchor derives the anchor for a client bootstrapped in epoch. The
// certificate that sealed epoch-2's stake distribution names, in its signed
// parts, the key and parameters that sign epoch's certificates. That
// distribution elects epoch's leaders, so it must equal the client's table.
// The anchor is trusted like the bootstrap checkpoint. The certificate itself
// is not verified here.
func StakeAnchor(certificate []byte, distribution map[string]uint64, epoch uint64, table []StakeEntry) (Anchor, error) {
	if epoch < 2 {
		return Anchor{}, fmt.Errorf("a Mithril anchor needs a bootstrap epoch of at least 2")
	}
	var parsed certificateJSON
	if err := json.Unmarshal(certificate, &parsed); err != nil {
		return Anchor{}, fmt.Errorf("invalid Mithril certificate: %w", err)
	}
	parts := parsed.ProtocolMessage.MessageParts
	if parts["current_epoch"] != strconv.FormatUint(epoch-1, 10) || parts["cardano_stake_distribution_epoch"] != strconv.FormatUint(epoch-2, 10) {
		return Anchor{}, fmt.Errorf("Mithril certificate does not certify the epoch %d stake distribution", epoch-2)
	}
	entries := make([]StakeEntry, 0, len(distribution))
	for pool, stake := range distribution {
		entries = append(entries, StakeEntry{PoolID: pool, Stake: stake})
	}
	root, err := StakeDistributionRoot(entries)
	if err != nil {
		return Anchor{}, err
	}
	if root != parts["cardano_stake_distribution_merkle_root"] {
		return Anchor{}, fmt.Errorf("Mithril's epoch %d stake distribution does not match its certificate", epoch-2)
	}
	if len(table) != len(distribution) {
		return Anchor{}, fmt.Errorf("Mithril's epoch %d distribution has %d pools but the bootstrap table has %d", epoch-2, len(distribution), len(table))
	}
	for _, entry := range table {
		if stake, ok := distribution[entry.PoolID]; !ok || stake != entry.Stake {
			return Anchor{}, fmt.Errorf("Mithril's epoch %d distribution differs from the bootstrap table for pool %s", epoch-2, entry.PoolID)
		}
	}
	anchor := Anchor{Epoch: epoch, AggregateVerificationKey: parts["next_aggregate_verification_key"], ProtocolParametersHash: parts["next_protocol_parameters"]}
	return anchor, ValidateAnchor(anchor)
}

// FetchStakeAnchor reads StakeAnchor's inputs from a Mithril aggregator, such
// as https://aggregator.release-mainnet.api.mithril.network/aggregator.
func FetchStakeAnchor(aggregator string, epoch uint64, table []StakeEntry) (Anchor, error) {
	if epoch < 2 {
		return Anchor{}, fmt.Errorf("a Mithril anchor needs a bootstrap epoch of at least 2")
	}
	base := strings.TrimRight(aggregator, "/")
	raw, err := fetch(base + "/artifact/cardano-stake-distribution/epoch/" + strconv.FormatUint(epoch-2, 10))
	if err != nil {
		return Anchor{}, err
	}
	var artifact struct {
		Epoch             uint64            `json:"epoch"`
		CertificateHash   string            `json:"certificate_hash"`
		StakeDistribution map[string]uint64 `json:"stake_distribution"`
	}
	if err := json.Unmarshal(raw, &artifact); err != nil {
		return Anchor{}, fmt.Errorf("invalid Mithril stake distribution: %w", err)
	}
	if artifact.Epoch != epoch-2 || !isHash(artifact.CertificateHash) {
		return Anchor{}, fmt.Errorf("Mithril returned another artifact for the epoch %d stake distribution", epoch-2)
	}
	certificate, err := fetch(base + "/certificate/" + artifact.CertificateHash)
	if err != nil {
		return Anchor{}, err
	}
	return StakeAnchor(certificate, artifact.StakeDistribution, epoch, table)
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
