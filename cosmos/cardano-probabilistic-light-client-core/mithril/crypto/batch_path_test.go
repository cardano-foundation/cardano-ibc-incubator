package crypto_test

import (
	"testing"

	"github.com/cardano-foundation/cardano-ibc-incubator/cosmos/cardano-probabilistic-light-client-core/mithril/crypto"
	"github.com/cardano-foundation/cardano-ibc-incubator/cosmos/cardano-probabilistic-light-client-core/mithril/mithriltest/signing"
)

// Trees whose size is not a power of two pad missing children with the hash of
// a zero byte. Every ordered subset of leaves must prove and verify.
func TestBatchPathsVerifyForEverySubset(t *testing.T) {
	for n := 1; n <= 9; n++ {
		leaves := make([]crypto.MTLeaf, n)
		for i := range leaves {
			seed := make([]byte, 32)
			seed[0] = byte(i + 1)
			sk, err := signing.Gen(seed)
			if err != nil {
				t.Fatal(err)
			}
			vk, err := sk.VerificationKey()
			if err != nil {
				t.Fatal(err)
			}
			leaves[i] = crypto.MTLeaf{VerificationKey: vk, Stake: crypto.Stake(100 + i)}
		}
		tree, err := signing.Create(leaves)
		if err != nil {
			t.Fatal(err)
		}
		commitment := tree.ToCommitmentBatchCompat()
		for mask := 1; mask < 1<<n; mask++ {
			var indices []uint64
			var values []crypto.MTLeaf
			for i := 0; i < n; i++ {
				if mask&(1<<i) != 0 {
					indices = append(indices, uint64(i))
					values = append(values, leaves[i])
				}
			}
			path, err := tree.GetBatchedPath(indices)
			if err != nil {
				t.Fatalf("n=%d subset=%b: %v", n, mask, err)
			}
			if err := commitment.Check(values, path); err != nil {
				t.Errorf("n=%d subset=%b: %v", n, mask, err)
			}
		}
	}
}
