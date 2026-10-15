package mithril

import (
	"encoding/hex"
	"fmt"
	"sort"
	"strconv"

	"golang.org/x/crypto/blake2s"
)

// StakeEntry is one pool's active stake in lovelace.
type StakeEntry struct {
	// Bech32 pool ID, such as pool1...
	PoolID string
	Stake  uint64
}

// StakeDistributionRoot returns the Merkle root Mithril certifies for a stake
// distribution: a Merkle mountain range over "{pool_id}{stake}" leaves in pool
// ID order, merging nodes with BLAKE2s-256 and bagging peaks from the right.
func StakeDistributionRoot(entries []StakeEntry) (string, error) {
	if len(entries) == 0 {
		return "", fmt.Errorf("stake distribution is empty")
	}
	sorted := append([]StakeEntry(nil), entries...)
	sort.Slice(sorted, func(i, j int) bool { return sorted[i].PoolID < sorted[j].PoolID })
	type peak struct {
		height int
		node   []byte
	}
	var peaks []peak
	for index, entry := range sorted {
		if entry.PoolID == "" || (index > 0 && entry.PoolID == sorted[index-1].PoolID) {
			return "", fmt.Errorf("stake distribution has an empty or duplicate pool ID %q", entry.PoolID)
		}
		node, height := []byte(entry.PoolID+strconv.FormatUint(entry.Stake, 10)), 0
		for len(peaks) > 0 && peaks[len(peaks)-1].height == height {
			node = merge(peaks[len(peaks)-1].node, node)
			peaks = peaks[:len(peaks)-1]
			height++
		}
		peaks = append(peaks, peak{height, node})
	}
	root := peaks[len(peaks)-1].node
	for index := len(peaks) - 2; index >= 0; index-- {
		root = merge(root, peaks[index].node)
	}
	return hex.EncodeToString(root), nil
}

func merge(left, right []byte) []byte {
	sum := blake2s.Sum256(append(append([]byte(nil), left...), right...))
	return sum[:]
}
