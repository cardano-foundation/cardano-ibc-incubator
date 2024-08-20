package mithril

import (
	"encoding/hex"
	"time"

	errorsmod "cosmossdk.io/errors"
	cmttypes "github.com/cometbft/cometbft/types"

	clienttypes "github.com/cosmos/ibc-go/v8/modules/core/02-client/types"
	"github.com/cosmos/ibc-go/v8/modules/core/exported"
)

var _ exported.ConsensusState = (*ConsensusState)(nil)

// SentinelRoot is used as a stand-in root value for the consensus state set at the upgrade height
const SentinelRoot = "sentinel_root"

// NewConsensusState creates a new ConsensusState instance.
func NewConsensusState(
	timestamp uint64,
	firstCertHashLatestEpoch *MithrilCertificate,
	latestCertHashTxSnapshot string,
) *ConsensusState {
	return &ConsensusState{
		Timestamp:                timestamp,
		FirstCertHashLatestEpoch: firstCertHashLatestEpoch,
		LatestCertHashTxSnapshot: latestCertHashTxSnapshot,
	}
}

// ClientType returns Cardano-Mithril
func (ConsensusState) ClientType() string {
	return ModuleName
}

// GetTimestamp returns block time in nanoseconds of the header that created consensus state
func (cs ConsensusState) GetTimestamp() uint64 {
	return cs.Timestamp
}

// GetTime returns block time of the header that created consensus state in time.Time type
func (cs ConsensusState) GetTime() time.Time {
	return time.Unix(int64(cs.GetTimestamp()/uint64(time.Second)), int64(cs.GetTimestamp()%uint64(time.Second)))
}

// ValidateBasic defines a basic validation for the mithril consensus state.
func (cs ConsensusState) ValidateBasic() error {
	if data, err := hex.DecodeString(cs.FirstCertHashLatestEpoch.Hash); err != nil || cmttypes.ValidateHash(data) != nil {
		return errorsmod.Wrap(err, "first certificate hash of latest epoch of mithril stake distribution is invalid")
	}
	if data, err := hex.DecodeString(cs.LatestCertHashTxSnapshot); err != nil || cmttypes.ValidateHash(data) != nil {
		return errorsmod.Wrap(err, "latest certificate hash of mithril stake distribution is invalid")
	}
	if cs.Timestamp <= 0 {
		return errorsmod.Wrap(clienttypes.ErrInvalidConsensus, "timestamp must be a positive Unix time")
	}

	return nil
}
