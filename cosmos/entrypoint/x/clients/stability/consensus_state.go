package stability

import (
	"time"

	errorsmod "cosmossdk.io/errors"
	cmttypes "github.com/cometbft/cometbft/types"

	clienttypes "github.com/cosmos/ibc-go/v10/modules/core/02-client/types"
	"github.com/cosmos/ibc-go/v10/modules/core/exported"
)

var _ exported.ConsensusState = (*ConsensusState)(nil)

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
	if cs.Timestamp == 0 {
		return errorsmod.Wrap(clienttypes.ErrInvalidConsensus, "timestamp must be a positive Unix time")
	}
	if cmttypes.ValidateHash(cs.IbcStateRoot) != nil {
		return errorsmod.Wrap(clienttypes.ErrInvalidConsensus, "ibc_state_root must be a 32-byte hash")
	}
	if cs.AcceptedBlockHash == "" {
		return errorsmod.Wrap(clienttypes.ErrInvalidConsensus, "accepted_block_hash must be set")
	}
	return nil
}
