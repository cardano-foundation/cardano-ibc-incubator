package cardanodatum

import channeltypes "github.com/cosmos/ibc-go/v10/modules/core/04-channel/types"

func channelUpgradeSequence(expected channeltypes.Channel) uint64 {
	// ibc-go v10 removed the channel-upgrade field.
	return 0
}
