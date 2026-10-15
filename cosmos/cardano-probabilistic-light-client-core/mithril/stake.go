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
	sorted := append([]StakeEntry(nil), entries...)
	sort.Slice(sorted, func(i, j int) bool { return sorted[i].PoolID < sorted[j].PoolID })
	var builder StakeRootBuilder
	for _, entry := range sorted {
		if err := builder.Append(entry.PoolID, entry.Stake); err != nil {
			return "", err
		}
	}
	return builder.Root()
}

// StakeRootBuilder computes StakeDistributionRoot from entries supplied one at
// a time in pool ID order. It keeps only the mountain range's peaks, at most
// one per bit of the entry count.
type StakeRootBuilder struct {
	Peaks []StakePeak
	Last  string
}

type StakePeak struct {
	Height uint32
	Node   []byte
}

func (b *StakeRootBuilder) Append(poolID string, stake uint64) error {
	if poolID <= b.Last {
		return fmt.Errorf("stake distribution pool IDs must be non-empty and strictly increasing, got %q after %q", poolID, b.Last)
	}
	node, height := []byte(poolID+strconv.FormatUint(stake, 10)), uint32(0)
	for len(b.Peaks) > 0 && b.Peaks[len(b.Peaks)-1].Height == height {
		node = merge(b.Peaks[len(b.Peaks)-1].Node, node)
		b.Peaks = b.Peaks[:len(b.Peaks)-1]
		height++
	}
	b.Peaks = append(b.Peaks, StakePeak{Height: height, Node: node})
	b.Last = poolID
	return nil
}

func (b *StakeRootBuilder) Root() (string, error) {
	if len(b.Peaks) == 0 {
		return "", fmt.Errorf("stake distribution is empty")
	}
	root := b.Peaks[len(b.Peaks)-1].Node
	for index := len(b.Peaks) - 2; index >= 0; index-- {
		root = merge(root, b.Peaks[index].Node)
	}
	return hex.EncodeToString(root), nil
}

func merge(left, right []byte) []byte {
	sum := blake2s.Sum256(append(append([]byte(nil), left...), right...))
	return sum[:]
}
