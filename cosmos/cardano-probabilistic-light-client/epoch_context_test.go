package probabilistic

import "testing"

func TestEpochContextForSlotPrefersLatestMatchingEpoch(t *testing.T) {
	contexts := []*EpochContext{
		{
			Epoch:                 2,
			EpochStartSlot:        10_000,
			EpochEndSlotExclusive: 442_000,
		},
		{
			Epoch:                 3,
			EpochStartSlot:        15_000,
			EpochEndSlotExclusive: 20_000,
		},
	}

	match := epochContextForSlot(contexts, 15_348)
	if match == nil {
		t.Fatal("expected matching epoch context")
	}
	if match.Epoch != 3 {
		t.Fatalf("expected epoch 3, got %d", match.Epoch)
	}
}
