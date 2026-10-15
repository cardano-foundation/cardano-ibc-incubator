package probabilistic

import (
	"bytes"
	"fmt"

	probabilisticcore "github.com/cardano-foundation/cardano-ibc-incubator/cosmos/cardano-probabilistic-light-client-core"
	sdk "github.com/cosmos/cosmos-sdk/types"
)

func isPacketStateKey(key []byte) bool {
	return bytes.HasPrefix(key, []byte("commitments/ports/transfer/")) || bytes.HasPrefix(key, []byte("receipts/ports/transfer/")) || bytes.HasPrefix(key, []byte("acks/ports/transfer/"))
}

func (cs *ClientState) verifyPagedPacketMembership(ctx sdk.Context, consensus *ConsensusState, height uint64, key, value, proof []byte) error {
	if bytes.HasPrefix(key, []byte("receipts/ports/")) {
		return fmt.Errorf("packet receipt membership is unsupported")
	}
	root, err := toCoreClientState(cs).PacketRoot(coreContext(ctx), toCoreConsensusState(consensus), height, key)
	if err != nil {
		return err
	}
	existence, err := decodeExistenceProof(proof)
	if err != nil {
		return err
	}
	return probabilisticcore.VerifyPacketLaneMembership(root, height, key, value, existence)
}
func (cs *ClientState) verifyPagedPacketNonMembership(ctx sdk.Context, consensus *ConsensusState, height uint64, key, proof []byte) error {
	root, err := toCoreClientState(cs).PacketRoot(coreContext(ctx), toCoreConsensusState(consensus), height, key)
	if err != nil {
		return err
	}
	absence, err := decodeNonExistenceProof(proof)
	if err != nil {
		return err
	}
	return probabilisticcore.VerifyPacketLaneNonMembership(root, height, key, absence)
}
