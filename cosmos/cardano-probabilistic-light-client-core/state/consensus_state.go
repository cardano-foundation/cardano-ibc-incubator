package state

import (
	"bytes"
	probabilisticcore "github.com/cardano-foundation/cardano-ibc-incubator/cosmos/cardano-probabilistic-light-client-core"
	"math"
	"time"

	errorsmod "cosmossdk.io/errors"
	cmttypes "github.com/cometbft/cometbft/types"
)

func (ConsensusState) ClientType() string {
	return ModuleName
}

func (cs ConsensusState) GetTimestamp() uint64 {
	return cs.Timestamp
}

func (cs ConsensusState) GetTime() time.Time {
	return time.Unix(int64(cs.GetTimestamp()/uint64(time.Second)), int64(cs.GetTimestamp()%uint64(time.Second)))
}

func (cs ConsensusState) ValidateBasic() error {
	if _, err := productionRecordMap(cs.PoolProduction, cs.AcceptedEpoch); err != nil {
		return errorsmod.Wrap(ErrIBCInvalidConsensus, err.Error())
	}
	if err := validateSettlementCredit(cs.SettlementCredit, cs.AcceptedEpoch); err != nil {
		return errorsmod.Wrap(ErrIBCInvalidConsensus, err.Error())
	}
	if err := validatePoolRegistry(cs.PoolRegistry, cs.AcceptedEpoch, math.MaxUint64); err != nil {
		return errorsmod.Wrap(ErrIBCInvalidConsensus, err.Error())
	}
	if err := validatePraosNonceState(cs.NonceState); err != nil {
		return errorsmod.Wrap(ErrIBCInvalidConsensus, err.Error())
	}
	if cs.Timestamp == 0 {
		return errorsmod.Wrap(ErrIBCInvalidConsensus, "timestamp must be a positive Unix time")
	}
	if cmttypes.ValidateHash(cs.IbcStateRoot) != nil {
		return errorsmod.Wrap(ErrIBCInvalidConsensus, "ibc_state_root must be a 32-byte hash")
	}
	if cs.AcceptedBlockHash == "" {
		return errorsmod.Wrap(ErrIBCInvalidConsensus, "accepted_block_hash must be set")
	}
	snapshot, err := probabilisticcore.DecodePacketStateSnapshot(cs.PacketStateSnapshot)
	if err != nil {
		return errorsmod.Wrap(ErrIBCInvalidConsensus, err.Error())
	}
	if snapshot.BlockHash != cs.AcceptedBlockHash || !bytes.Equal(snapshot.HostRoot, cs.IbcStateRoot) {
		return errorsmod.Wrap(ErrIBCInvalidConsensus, "packet snapshot does not match consensus commitment")
	}
	return nil
}
