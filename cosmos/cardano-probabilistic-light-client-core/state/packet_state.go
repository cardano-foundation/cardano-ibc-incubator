package state

import (
	"bytes"
	"fmt"

	probabilisticcore "github.com/cardano-foundation/cardano-ibc-incubator/cosmos/cardano-probabilistic-light-client-core"
)

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
