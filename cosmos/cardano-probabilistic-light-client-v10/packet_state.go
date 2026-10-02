package probabilistic

import (
	"bytes"
	"fmt"
	"strings"

	storetypes "cosmossdk.io/store/types"
	probabilisticcore "github.com/cardano-foundation/cardano-ibc-incubator/cosmos/cardano-probabilistic-light-client-core"
	"github.com/cosmos/cosmos-sdk/codec"
)

func packetSnapshotKey(height uint64) []byte { return []byte(fmt.Sprintf("packetState/%020d", height)) }

func (cs ClientState) advancePacketSnapshot(store storetypes.KVStore, cdc codec.BinaryCodec, header *ProbabilisticHeader) (probabilisticcore.PacketStateSnapshot, error) {
	raw := store.Get(packetSnapshotKey(header.TrustedHeight.RevisionHeight))
	if len(raw) == 0 {
		consensus, found := GetConsensusState(store, cdc, header.TrustedHeight)
		if !found {
			return probabilisticcore.PacketStateSnapshot{}, fmt.Errorf("trusted packet snapshot unavailable")
		}
		raw = consensus.PacketStateSnapshot
	}
	previous, err := probabilisticcore.DecodePacketStateSnapshot(raw)
	if err != nil {
		return previous, err
	}
	if previous.Height != header.TrustedHeight.RevisionHeight {
		return previous, fmt.Errorf("trusted packet snapshot height mismatch")
	}
	blocks := make([][]byte, 0, len(header.BridgeBlocks)+1)
	for _, block := range header.BridgeBlocks {
		blocks = append(blocks, block.BlockCbor)
	}
	blocks = append(blocks, header.AnchorBlock.BlockCbor)
	snapshot, err := probabilisticcore.AdvancePacketStateSnapshot(previous, blocks, cs.PacketLanePolicyId, cs.HostStateNftPolicyId, cs.HostStateNftTokenName)
	if err != nil {
		return snapshot, err
	}
	if snapshot.Height != header.AnchorBlock.Height.RevisionHeight || !strings.EqualFold(snapshot.BlockHash, header.AnchorBlock.Hash) {
		return snapshot, fmt.Errorf("packet snapshot does not match authenticated anchor")
	}
	return snapshot, nil
}

func validateConsensusPacketSnapshot(consensus *ConsensusState, height uint64) error {
	snapshot, err := probabilisticcore.DecodePacketStateSnapshot(consensus.PacketStateSnapshot)
	if err != nil {
		return err
	}
	if snapshot.Height != height || snapshot.BlockHash != consensus.AcceptedBlockHash || !bytes.Equal(snapshot.HostRoot, consensus.IbcStateRoot) {
		return fmt.Errorf("packet snapshot differs from consensus state")
	}
	return nil
}

func isPacketStateKey(key []byte) bool {
	return bytes.HasPrefix(key, []byte("commitments/ports/transfer/")) || bytes.HasPrefix(key, []byte("receipts/ports/transfer/")) || bytes.HasPrefix(key, []byte("acks/ports/transfer/"))
}

func verifyPacketMembership(consensus *ConsensusState, height uint64, key, value, proof []byte) error {
	if err := validateConsensusPacketSnapshot(consensus, height); err != nil {
		return err
	}
	snapshot, err := probabilisticcore.DecodePacketStateSnapshot(consensus.PacketStateSnapshot)
	if err != nil {
		return err
	}
	root, err := snapshot.PacketRoot(key, height)
	if err != nil {
		return err
	}
	existence, err := decodeExistenceProof(proof)
	if err != nil {
		return err
	}
	return probabilisticcore.VerifyPacketLaneMembership(root, height, key, value, existence)
}

func verifyPacketNonMembership(consensus *ConsensusState, height uint64, key, proof []byte) error {
	if err := validateConsensusPacketSnapshot(consensus, height); err != nil {
		return err
	}
	snapshot, err := probabilisticcore.DecodePacketStateSnapshot(consensus.PacketStateSnapshot)
	if err != nil {
		return err
	}
	root, err := snapshot.PacketRoot(key, height)
	if err != nil {
		return err
	}
	absence, err := decodeNonExistenceProof(proof)
	if err != nil {
		return err
	}
	return probabilisticcore.VerifyPacketLaneNonMembership(root, height, key, absence)
}
