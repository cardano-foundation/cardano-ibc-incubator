package cardanodatum

import (
	"fmt"
	"strings"

	errorsmod "cosmossdk.io/errors"
	core "github.com/cardano-foundation/cardano-ibc-incubator/cosmos/cardano-probabilistic-light-client-core/cardanodatum"
	proto "github.com/cosmos/gogoproto/proto"
	clienttypes "github.com/cosmos/ibc-go/v8/modules/core/02-client/types"
	channeltypes "github.com/cosmos/ibc-go/v8/modules/core/04-channel/types"
)

// ibc-go v8 verifies every channel-upgrade step through the channel's existing
// connection. This client therefore authenticates the Cardano upgrade records
// before any Cardano deployment commits them.

// CompareChannelEnd checks every field of an ibc-go v8 Channel, including the
// FLUSHING and FLUSHCOMPLETE states and the upgrade sequence.
func CompareChannelEnd(committed []byte, expected channeltypes.Channel) error {
	channel, err := core.DecodeChannelEnd(committed)
	if err == nil {
		err = channel.Compare(core.ChannelEndValue{
			State:                 uint64(expected.State),
			Ordering:              uint64(expected.Ordering),
			CounterpartyPortId:    expected.Counterparty.PortId,
			CounterpartyChannelId: expected.Counterparty.ChannelId,
			ConnectionHops:        expected.ConnectionHops,
			Version:               expected.Version,
			UpgradeSequence:       expected.UpgradeSequence,
		})
	}
	return membershipError(err)
}

// CompareChannelUpgradeRecord checks the upgrade and error receipt that
// VerifyChannelUpgrade and VerifyChannelUpgradeError prove. ibc-go never
// proves the stored counterparty upgrade.
func CompareChannelUpgradeRecord(key string, expectedValue, committed []byte) error {
	switch {
	case strings.HasPrefix(key, "channelUpgrades/upgrades/"):
		var expected channeltypes.Upgrade
		if err := proto.Unmarshal(expectedValue, &expected); err != nil {
			return fmt.Errorf("failed to decode expected Upgrade protobuf: %w", err)
		}
		return membershipError(core.CompareUpgrade(committed, core.UpgradeValue{
			Ordering:         uint64(expected.Fields.Ordering),
			ConnectionHops:   expected.Fields.ConnectionHops,
			Version:          expected.Fields.Version,
			TimeoutHeight:    HeightDatum{RevisionNumber: expected.Timeout.Height.RevisionNumber, RevisionHeight: expected.Timeout.Height.RevisionHeight},
			TimeoutTimestamp: expected.Timeout.Timestamp,
			NextSequenceSend: expected.NextSequenceSend,
		}))
	case strings.HasPrefix(key, "channelUpgrades/upgradeError/"):
		var expected channeltypes.ErrorReceipt
		if err := proto.Unmarshal(expectedValue, &expected); err != nil {
			return fmt.Errorf("failed to decode expected ErrorReceipt protobuf: %w", err)
		}
		return membershipError(core.CompareErrorReceipt(committed, core.ErrorReceiptValue{
			Sequence: expected.Sequence,
			Message:  expected.Message,
		}))
	}
	return fmt.Errorf("existence proof value mismatch")
}

func membershipError(err error) error {
	if err == nil {
		return nil
	}
	return errorsmod.Wrap(clienttypes.ErrFailedMembershipVerification, err.Error())
}
