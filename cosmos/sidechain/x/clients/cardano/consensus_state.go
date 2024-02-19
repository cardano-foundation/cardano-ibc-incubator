package cardano

import (
	"time"

	errorsmod "cosmossdk.io/errors"
	"github.com/golang/protobuf/ptypes/timestamp"

	clienttypes "github.com/cosmos/ibc-go/v8/modules/core/02-client/types"
	"github.com/cosmos/ibc-go/v8/modules/core/exported"
)

var _ exported.ConsensusState = (*ConsensusState)(nil)

// SentinelRoot is used as a stand-in root value for the consensus state set at the upgrade height
const SentinelRoot = "sentinel_root"

// NewConsensusState creates a new ConsensusState instance.
func NewConsensusState(
	timestamp timestamp.Timestamp, slot uint64, height Height,
) *ConsensusState {
	return &ConsensusState{
		Timestamp: 1,
		Slot:      slot,
	}
}

// ClientType returns Cardano
func (ConsensusState) ClientType() string {
	return ModuleName
}

// GetRoot returns the commitment Root for the specific
func (cs ConsensusState) GetSlot() uint64 {
	return cs.Slot
}

// GetTimestamp returns block time in nanoseconds of the header that created consensus state
func (cs ConsensusState) GetTimestamp() uint64 {
	return uint64(cs.Timestamp * uint64(time.Second))
}

// GetTimestamp returns block time in nanoseconds of the header that created consensus state
func (cs ConsensusState) GetTime() time.Time {
	return time.Unix(int64(cs.Timestamp), 0)
}

// ValidateBasic defines a basic validation for the cardano consensus state.
// NOTE: ProcessedTimestamp may be zero if this is an initial consensus state passed in by relayer
// as opposed to a consensus state constructed by the chain.
func (cs ConsensusState) ValidateBasic() error {
	if cs.Slot == 0 {
		return errorsmod.Wrap(clienttypes.ErrInvalidConsensus, "slot cannot be zero")
	}

	if cs.Timestamp <= 0 {
		return errorsmod.Wrap(clienttypes.ErrInvalidConsensus, "timestamp must be a positive Unix time")
	}

	return nil
}
