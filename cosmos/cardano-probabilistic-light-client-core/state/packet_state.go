package state

import (
	"bytes"
	"fmt"
	"strings"

	storetypes "cosmossdk.io/store/types"
	probabilisticcore "github.com/cardano-foundation/cardano-ibc-incubator/cosmos/cardano-probabilistic-light-client-core"
)

func packetSnapshotKey(height uint64) []byte { return []byte(fmt.Sprintf("packetState/%020d", height)) }

func (cs ClientState) advancePacketSnapshot(store storetypes.KVStore, cdc StateCodec, header *ProbabilisticHeader) (probabilisticcore.PacketStateSnapshot, error) {
	raw := store.Get(packetSnapshotKey(header.TrustedHeight.RevisionHeight))
	if len(raw) == 0 {
		for _, challenge := range cs.EpochContextChallenges {
			if challenge == nil {
				continue
			}
			encoded := store.Get(epochChallengeCheckpointKey(challenge.Epoch))
			if len(encoded) == 0 {
				continue
			}
			checkpoint, err := cdc.DecodeClientSnapshot(encoded)
			if err != nil {
				return probabilisticcore.PacketStateSnapshot{}, err
			}
			if checkpoint.LatestCheckpointHeight != nil && checkpoint.LatestCheckpointHeight.EQ(header.TrustedHeight) {
				raw = store.Get(epochChallengePacketSnapshotKey(challenge.Epoch))
				if len(raw) != 0 {
					break
				}
			}
		}
	}
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

func ValidateConsensusPacketSnapshot(consensus *ConsensusState, height uint64) error {
	return validateConsensusPacketSnapshot(consensus, height)
}
