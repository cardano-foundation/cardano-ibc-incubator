package state

import (
	"bytes"
	"encoding/hex"
	"github.com/stretchr/testify/require"
	"testing"
)

func TestCrossLanguageSessionEncoding(t *testing.T) {
	client := &ClientState{StorageNamespace: bytes.Repeat([]byte{1}, 32), VerificationGeneration: 7}
	chunk := &ObservationChunk{BaseCheckpointReference: bytes.Repeat([]byte{2}, 32), OriginalReceipt: bytes.Repeat([]byte{3}, 32), AnchorHeight: 42, BlockCount: 27, IsCheckpoint: true, TableContext: &EpochContext{Epoch: 8, SlotsPerKesPeriod: 129600, EpochStartSlot: 20000000, EpochEndSlotExclusive: 20432000, EpochNonce: bytes.Repeat([]byte{4}, 32)}, TableRows: 4000, TableTotal: 10000000, TableDigest: bytes.Repeat([]byte{5}, 32), EvidenceDigest: bytes.Repeat([]byte{6}, 32)}
	id, err := observationSessionID(client, chunk)
	require.NoError(t, err)
	require.Equal(t, "6852dd5a8b07d87585faff64cf45131624bad30fd3efd3b48fb9902bc0e522be", hex.EncodeToString(id[:]))
}
