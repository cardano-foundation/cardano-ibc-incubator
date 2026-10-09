package probabilistic

import (
	"bytes"
	"fmt"
	probabilisticcore "github.com/cardano-foundation/cardano-ibc-incubator/cosmos/cardano-probabilistic-light-client-core"
	state "github.com/cardano-foundation/cardano-ibc-incubator/cosmos/cardano-probabilistic-light-client-core/state"
)

func packetSnapshotKey(height uint64) []byte { return []byte(fmt.Sprintf("packetState/%020d", height)) }
func validateConsensusPacketSnapshot(consensus *ConsensusState, height uint64) error {
	return state.ValidateConsensusPacketSnapshot(toCoreConsensusState(consensus), height)
}

func isPacketStateKey(key []byte) bool {
	return bytes.HasPrefix(key, []byte("commitments/ports/transfer/")) || bytes.HasPrefix(key, []byte("receipts/ports/transfer/")) || bytes.HasPrefix(key, []byte("acks/ports/transfer/"))
}

func verifyPacketMembership(consensus *ConsensusState, height uint64, key, value, proof []byte) error {
	if bytes.HasPrefix(key, []byte("receipts/ports/")) {
		return fmt.Errorf("packet receipt membership is unsupported: only non-membership proofs are supported")
	}
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
