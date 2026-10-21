package cardanodatum

import channeltypes "github.com/cosmos/ibc-go/v8/modules/core/04-channel/types"

func channelUpgradeSequence(expected channeltypes.Channel) uint64 {
	return expected.UpgradeSequence
}
