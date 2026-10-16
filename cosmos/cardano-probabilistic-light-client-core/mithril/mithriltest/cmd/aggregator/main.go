// aggregator serves a local Mithril network's certificates of one stake
// distribution, so tests outside Go can bootstrap a client from it. It reads
// {"epoch": C, "stake_distribution": {"pool1...": lovelace}} from standard
// input, prints its aggregator URL and serves until it is stopped. It is a
// test tool, not an aggregator.
package main

import (
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/cardano-foundation/cardano-ibc-incubator/cosmos/cardano-probabilistic-light-client-core/mithril"
	"github.com/cardano-foundation/cardano-ibc-incubator/cosmos/cardano-probabilistic-light-client-core/mithril/mithriltest"
)

type request struct {
	Epoch             uint64                       `json:"epoch"`
	StakeDistribution map[string]uint64            `json:"stake_distribution"`
	Distributions     map[uint64]map[string]uint64 `json:"distributions"`
	ReleaseDirectory  string                       `json:"release_directory"`
	CacheFile         string                       `json:"cache_file"`
}

type artifact struct {
	Epoch             uint64            `json:"epoch"`
	CertificateHash   string            `json:"certificate_hash"`
	StakeDistribution map[string]uint64 `json:"stake_distribution"`
}

func run() error {
	var input request
	if err := json.NewDecoder(os.Stdin).Decode(&input); err != nil {
		return err
	}
	if input.Epoch < 3 || len(input.StakeDistribution) == 0 {
		return fmt.Errorf("a bootstrap needs an epoch of at least 3 and a stake distribution")
	}
	entries := make([]mithril.StakeEntry, 0, len(input.StakeDistribution))
	for pool, stake := range input.StakeDistribution {
		entries = append(entries, mithril.StakeEntry{PoolID: pool, Stake: stake})
	}
	root, err := mithril.StakeDistributionRoot(entries)
	if err != nil {
		return err
	}
	network, err := mithriltest.NewNetwork(100, 200, 300)
	if err != nil {
		return err
	}
	// The certificate sealing epoch C-3's distribution names the anchor for
	// C-1. The one sealing C-2's distribution certifies the bootstrap table.
	earlier, err := network.StakeCertificate(input.Epoch-2, network, strings.Repeat("ab", 32))
	if err != nil {
		return err
	}
	_, certificate, err := network.Bootstrap(input.Epoch, root)
	if err != nil {
		return err
	}
	artifacts := map[uint64]artifact{
		input.Epoch - 3: {Epoch: input.Epoch - 3, CertificateHash: strings.Repeat("03", 32), StakeDistribution: map[string]uint64{}},
		input.Epoch - 2: {Epoch: input.Epoch - 2, CertificateHash: strings.Repeat("02", 32), StakeDistribution: input.StakeDistribution},
	}
	certificates := map[string]string{strings.Repeat("03", 32): earlier, strings.Repeat("02", 32): certificate}
	for epoch, table := range input.Distributions {
		if epoch <= input.Epoch {
			return fmt.Errorf("additional leader epochs must follow the bootstrap epoch")
		}
		entries := make([]mithril.StakeEntry, 0, len(table))
		for pool, stake := range table {
			entries = append(entries, mithril.StakeEntry{PoolID: pool, Stake: stake})
		}
		root, err := mithril.StakeDistributionRoot(entries)
		if err != nil {
			return err
		}
		certificate, err := network.StakeCertificate(epoch-1, network, root)
		if err != nil {
			return err
		}
		hash := fmt.Sprintf("%064x", epoch)
		artifacts[epoch-2] = artifact{Epoch: epoch - 2, CertificateHash: hash, StakeDistribution: table}
		certificates[hash] = certificate
	}
	if input.CacheFile != "" {
		cached := struct {
			Artifacts    map[uint64]artifact
			Certificates map[string]string
		}{artifacts, certificates}
		raw, err := os.ReadFile(input.CacheFile)
		if err == nil {
			if err := json.Unmarshal(raw, &cached); err != nil {
				return err
			}
			artifacts, certificates = cached.Artifacts, cached.Certificates
		} else if os.IsNotExist(err) {
			raw, err = json.Marshal(cached)
			if err != nil {
				return err
			}
			if err := os.WriteFile(input.CacheFile, raw, 0600); err != nil {
				return err
			}
		} else {
			return err
		}
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/aggregator/", func(w http.ResponseWriter, r *http.Request) {
		path := strings.TrimPrefix(r.URL.Path, "/aggregator")
		if text, ok := strings.CutPrefix(path, "/artifact/cardano-stake-distribution/epoch/"); ok {
			epoch, err := strconv.ParseUint(text, 10, 64)
			if found, ok := artifacts[epoch]; err == nil && ok {
				if input.ReleaseDirectory != "" && epoch+2 > input.Epoch {
					if _, err := os.Stat(filepath.Join(input.ReleaseDirectory, fmt.Sprintf("certificate-%d", epoch+2))); err != nil {
						http.NotFound(w, r)
						return
					}
				}
				_ = json.NewEncoder(w).Encode(found)
				return
			}
		}
		if hash, ok := strings.CutPrefix(path, "/certificate/"); ok && certificates[hash] != "" {
			_, _ = w.Write([]byte(certificates[hash]))
			return
		}
		http.NotFound(w, r)
	})
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return err
	}
	fmt.Printf("http://%s/aggregator\n", listener.Addr())
	return http.Serve(listener, mux)
}

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
