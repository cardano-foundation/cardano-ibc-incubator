package state

import (
	"encoding/hex"
	"testing"

	"github.com/stretchr/testify/require"
)

// Pin the existing protocol identifiers and key bytes independently of their
// names. Changing either would require a wire or persisted-state migration.
func TestVerificationKindCompatibility(t *testing.T) {
	queries := []struct {
		Kind QueryKind
		Wire uint32
	}{
		{QueryCheckpoint, 0},
		{QueryEffectiveBindings, 1},
		{QueryStake, 2},
		{QuerySettlementCredit, 3},
		{QueryPoolProduction, 4},
		{QueryCertificateCounters, 5},
		{QueryRegistrations, 6},
		{QueryMarkBindings, 7},
		{QuerySession, 8},
		{QueryReceipt, 9},
		{QueryEpochProposals, 10},
		{QueryBootstrapProgress, 11},
		{QueryReceipts, 12},
		{QueryEpochUsability, 13},
	}
	for _, query := range queries {
		require.Equal(t, query.Wire, uint32(query.Kind))
	}
	namespace, id := []byte{0xaa, 0xbb}, []byte{0xcc}
	owners := []struct {
		Kind OwnerKind
		Key  string
	}{
		{OwnerCurrentCheckpoint, "aabb000000000000000701cc"},
		{OwnerSessionBase, "aabb000000000000000702cc"},
		{OwnerReceiptCheckpoint, "aabb000000000000000703cc"},
		{OwnerSession, "aabb000000000000000704cc"},
		{OwnerRetainedCheckpoint, "aabb000000000000000705cc"},
		{OwnerEpochProposal, "aabb000000000000000706cc"},
		{OwnerBootstrap, "aabb000000000000000707cc"},
		{OwnerRecovery, "aabb000000000000000708cc"},
		{OwnerRetainedReceipt, "aabb000000000000000709cc"},
	}
	for _, owner := range owners {
		require.Equal(t, owner.Key, hex.EncodeToString(namespaceOwner(namespace, 7, owner.Kind, id)))
	}
	client := &ClientState{StorageNamespace: namespace, VerificationGeneration: 7}
	retentions := []struct {
		Kind RetentionKind
		Key  string
	}{
		{RetainSession, "snapshots/v2/retention/\xaa\xbb\x00\x00\x00\x00\x00\x00\x00\x07\x01\xcc"},
		{RetainReceipt, "snapshots/v2/retention/\xaa\xbb\x00\x00\x00\x00\x00\x00\x00\x07\x02\xcc"},
		{RetainCheckpoint, "snapshots/v2/retention/\xaa\xbb\x00\x00\x00\x00\x00\x00\x00\x07\x03\xcc"},
		{RetainEpochProposal, "snapshots/v2/retention/\xaa\xbb\x00\x00\x00\x00\x00\x00\x00\x07\x04\xcc"},
	}
	for _, retention := range retentions {
		require.Equal(t, []byte(retention.Key), retentionKey(client, retention.Kind, id))
	}
	// Dependency suffixes are also persisted as part of their owner keys.
	require.Equal(t, []byte{1, 2, 3, 4, 5, 6, 7}, []byte{
		sessionOwnerWorking, sessionOwnerAnchor, sessionOwnerStake,
		sessionOwnerCredit, sessionOwnerQualified, sessionOwnerPendingBody,
		sessionOwnerOriginalReceipt,
	})
	require.Equal(t, []byte{1, 2, 3, 4, 5, 6, 7, 8, 23, 24}, []byte{
		checkpointOwnerRegistrations, checkpointOwnerMarkBindings,
		checkpointOwnerEffectiveBindings, checkpointOwnerStake,
		checkpointOwnerCredit, checkpointOwnerProduction, checkpointOwnerCounters,
		checkpointOwnerSettledHistory, checkpointOwnerPacket, checkpointOwnerRecord,
	})
	require.Equal(t, []byte{1, 2, 3, 4}, []byte{
		receiptOwnerBase, receiptOwnerAnchor, receiptOwnerStake, receiptOwnerOriginalReceipt,
	})
	require.Equal(t, []byte{20, 21, 22}, []byte{packetOwnerLanes, packetOwnerInputs, packetOwnerRoutes})
	require.Equal(t, []byte{0, 1}, []byte{recoveryOwnerCheckpoint, recoveryOwnerProofCheckpoint})
}
