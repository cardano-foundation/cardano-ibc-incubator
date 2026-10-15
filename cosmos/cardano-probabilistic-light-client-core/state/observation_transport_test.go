package state

import (
	"bytes"
	"encoding/hex"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestCrossLanguageSessionEncoding(t *testing.T) {
	client := &ClientState{StorageNamespace: bytes.Repeat([]byte{1}, 32), VerificationGeneration: 7}
	chunk := &ObservationChunk{BaseCheckpointReference: bytes.Repeat([]byte{2}, 32), OriginalReceipt: bytes.Repeat([]byte{3}, 32), AnchorHeight: 42, BlockCount: 27, IsCheckpoint: true, TableContext: &EpochContext{Epoch: 8, SlotsPerKesPeriod: 129600, EpochStartSlot: 20000000, EpochEndSlotExclusive: 20432000, EpochNonce: bytes.Repeat([]byte{4}, 32)}, TableRows: 4000, TableTotal: 10000000, TableDigest: bytes.Repeat([]byte{5}, 32), EvidenceDigest: bytes.Repeat([]byte{6}, 32)}
	id, err := observationSessionID(client, chunk)
	require.NoError(t, err)
	require.Equal(t, "6852dd5a8b07d87585faff64cf45131624bad30fd3efd3b48fb9902bc0e522be", hex.EncodeToString(id[:]))
}

func TestCrossLanguageObservationSegmentCommitments(t *testing.T) {
	first, err := poolName(bytes.Repeat([]byte{1}, 28))
	require.NoError(t, err)
	second, err := poolName(bytes.Repeat([]byte{2}, 28))
	require.NoError(t, err)
	client := &ClientState{StorageVersion: StorageVersion, CurrentEpoch: 7, CheckpointReference: bytes.Repeat([]byte{2}, 32), StorageNamespace: bytes.Repeat([]byte{1}, 32), VerificationGeneration: 7}
	header := &ProbabilisticHeader{
		AnchorBlock:      &ProbabilisticBlock{Height: NewHeight(0, 42), Slot: 100, Epoch: 8, Timestamp: 1234, Hash: hex.EncodeToString(bytes.Repeat([]byte{3}, 32)), HeaderCbor: []byte{4, 5}},
		DescendantBlocks: []*ProbabilisticBlock{{Height: NewHeight(0, 43), Slot: 101, Epoch: 8, Timestamp: 1235, Hash: hex.EncodeToString(bytes.Repeat([]byte{6}, 32)), HeaderCbor: []byte{7, 8}}},
		NewEpochContext:  &EpochContext{Epoch: 8, StakeDistribution: []*StakeDistributionEntry{{PoolId: first, Stake: 10}, {PoolId: second, Stake: 20}}},
	}
	plan, err := BuildObservationPlan(client, header, nil, 2, 4)
	require.NoError(t, err)
	// Rows follow Mithril's pool ID order, which here reverses binary key order.
	require.Less(t, second, first)
	require.Equal(t, bytes.Repeat([]byte{2}, 28), plan.Steps[1].ObservationChunk.StakeRows[:28])
	require.Equal(t, "3bee5b87e4f6fb30cdcf230e735a11c5f31fc4f47380bbda95aac90ff903731a", hex.EncodeToString(plan.Steps[0].ObservationChunk.EvidenceDigest))
	require.Equal(t, "10495c5e7616f6bdc85b7cfee7b46e71f0f66ae54f369cdc28877190a216fdb9", hex.EncodeToString(plan.Steps[1].ObservationChunk.EvidenceDigest))
	require.Equal(t, "2e8bcd5d17896af3c4db1ecc52f6d6827ff840aa12a64bc3927f480c0a765845", hex.EncodeToString(plan.Steps[3].ObservationChunk.EvidenceDigest))
	root, err := observationSegmentCommitment(plan.Steps[1].ObservationChunk, 42)
	require.NoError(t, err)
	require.Equal(t, plan.Steps[0].ObservationChunk.EvidenceDigest, root[:])
}
