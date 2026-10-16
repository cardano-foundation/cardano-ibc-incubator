package cardanodatum

import (
	"fmt"

	errorsmod "cosmossdk.io/errors"
	core "github.com/cardano-foundation/cardano-ibc-incubator/cosmos/cardano-probabilistic-light-client-core/cardanodatum"
	clienttypes "github.com/cosmos/ibc-go/v10/modules/core/02-client/types"
	channeltypes "github.com/cosmos/ibc-go/v10/modules/core/04-channel/types"
)

// ibc-go v10 removed channel upgrades. Cardano channel ends may still carry an
// upgrade sequence and must verify for opening and closing handshakes.

// CompareChannelEnd checks an ibc-go v10 Channel. That Channel has no upgrade
// sequence, so a sequence left on the Cardano end by an earlier upgrade
// attempt is not part of the comparison.
func CompareChannelEnd(committed []byte, expected channeltypes.Channel) error {
	channel, err := core.DecodeChannelEnd(committed)
	if err == nil {
		err = channel.CompareWithoutUpgradeSequence(core.ChannelEndValue{
			State:                 uint64(expected.State),
			Ordering:              uint64(expected.Ordering),
			CounterpartyPortId:    expected.Counterparty.PortId,
			CounterpartyChannelId: expected.Counterparty.ChannelId,
			ConnectionHops:        expected.ConnectionHops,
			Version:               expected.Version,
		})
	}
	if err != nil {
		return errorsmod.Wrap(clienttypes.ErrFailedMembershipVerification, err.Error())
	}
	return nil
}

// CompareChannelUpgradeRecord rejects channel-upgrade records, which ibc-go
// v10 never proves.
func CompareChannelUpgradeRecord(string, []byte, []byte) error {
	return fmt.Errorf("ibc-go v10 does not verify channel upgrade records")
}
