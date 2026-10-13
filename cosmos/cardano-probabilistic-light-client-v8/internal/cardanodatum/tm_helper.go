package cardanodatum

import (
	"bytes"
	"sort"
	"strings"

	errorsmod "cosmossdk.io/errors"
	core "github.com/cardano-foundation/cardano-ibc-incubator/cosmos/cardano-probabilistic-light-client-core/cardanodatum"
	clienttypes "github.com/cosmos/ibc-go/v8/modules/core/02-client/types"
	connectiontypes "github.com/cosmos/ibc-go/v8/modules/core/03-connection/types"
	channeltypes "github.com/cosmos/ibc-go/v8/modules/core/04-channel/types"
	tmStruct "github.com/cosmos/ibc-go/v8/modules/light-clients/07-tendermint"
)

func (datumClientState ClientStateDatum) Cmp(tmClient *tmStruct.ClientState) error {
	if tmClient == nil {
		return errorsmod.Wrap(clienttypes.ErrFailedMembershipVerification, "ClientState: expected state missing")
	}
	err := core.ClientStateDatum(datumClientState).Compare(core.TendermintClientStateValue{
		ChainId:                      tmClient.ChainId,
		TrustLevel:                   TrustLevelDatum{Numerator: tmClient.TrustLevel.Numerator, Denominator: tmClient.TrustLevel.Denominator},
		TrustingPeriod:               tmClient.TrustingPeriod,
		UnbondingPeriod:              tmClient.UnbondingPeriod,
		MaxClockDrift:                tmClient.MaxClockDrift,
		FrozenHeight:                 HeightDatum{RevisionNumber: tmClient.FrozenHeight.RevisionNumber, RevisionHeight: tmClient.FrozenHeight.RevisionHeight},
		LatestHeight:                 HeightDatum{RevisionNumber: tmClient.LatestHeight.RevisionNumber, RevisionHeight: tmClient.LatestHeight.RevisionHeight},
		ProofSpecs:                   tmClient.ProofSpecs,
		UpgradePath:                  tmClient.UpgradePath,
		AllowUpdateAfterExpiry:       tmClient.AllowUpdateAfterExpiry,
		AllowUpdateAfterMisbehaviour: tmClient.AllowUpdateAfterMisbehaviour,
	})
	if err != nil {
		return errorsmod.Wrap(clienttypes.ErrFailedMembershipVerification, err.Error())
	}
	return nil
}

func (datumConsensusState ConsensusStateDatum) Cmp(tmConsensusState *tmStruct.ConsensusState) error {
	if datumConsensusState.Timestamp != tmConsensusState.GetTimestamp() {
		return errorsmod.Wrapf(
			clienttypes.ErrFailedMembershipVerification,
			"ConsensusState: Timestamp mismatch, expect %v, got %v",
			tmConsensusState.GetTimestamp(),
			datumConsensusState.Timestamp,
		)
	}

	if !bytes.Equal(datumConsensusState.NextValidatorsHash, tmConsensusState.NextValidatorsHash) {
		return errorsmod.Wrapf(
			clienttypes.ErrFailedMembershipVerification,
			"ConsensusState: NextValidatorsHash mismatch, expect %v, got %v",
			tmConsensusState.NextValidatorsHash,
			datumConsensusState.NextValidatorsHash,
		)
	}

	if !bytes.Equal(datumConsensusState.Root.Hash, tmConsensusState.Root.Hash) {
		return errorsmod.Wrapf(
			clienttypes.ErrFailedMembershipVerification,
			"ConsensusState: RootHash mismatch, expect %v, got %v",
			tmConsensusState.Root.Hash,
			datumConsensusState.Root.Hash,
		)
	}

	return nil
}

func (datumConnectionEnd ConnectionEndDatum) Cmp(tmConnectionEnd connectiontypes.ConnectionEnd) error {
	clientIdString := string(datumConnectionEnd.ClientId[:])
	if clientIdString != tmConnectionEnd.ClientId {
		return errorsmod.Wrapf(
			clienttypes.ErrFailedMembershipVerification,
			"ConnectionEnd: ClientId mismatch, expect %s, got %v",
			tmConnectionEnd.ClientId,
			clientIdString,
		)
	}
	if len(datumConnectionEnd.Versions) != len(tmConnectionEnd.Versions) {
		return errorsmod.Wrapf(
			clienttypes.ErrFailedMembershipVerification,
			"ConnectionEnd: Versions length mismatch, expect %v, got %v",
			len(tmConnectionEnd.Versions),
			len(datumConnectionEnd.Versions),
		)
	}
	for i, versionValue := range datumConnectionEnd.Versions {
		identifier := string(versionValue.Identifier[:])
		if identifier != tmConnectionEnd.Versions[i].Identifier {
			return errorsmod.Wrapf(
				clienttypes.ErrFailedMembershipVerification,
				"ConnectionEnd: Versions.Identifier mismatch, expect %s, got %s",
				tmConnectionEnd.Versions[i].Identifier,
				identifier,
			)
		}
		if len(versionValue.Features) != len(tmConnectionEnd.Versions[i].Features) {
			return errorsmod.Wrapf(
				clienttypes.ErrFailedMembershipVerification,
				"ConnectionEnd: Versions.Features length mismatch, expect %v, got %v",
				len(tmConnectionEnd.Versions[i].Features),
				len(versionValue.Features),
			)
		}
		features := []string{}
		expectedFeatures := tmConnectionEnd.Versions[i].Features
		for _, featureValue := range versionValue.Features {
			features = append(features, string(featureValue[:]))
		}
		sort.Strings(features)
		sort.Strings(expectedFeatures)
		if strings.Join(features[:], ",") != strings.Join(expectedFeatures[:], ",") {
			return errorsmod.Wrap(clienttypes.ErrFailedMembershipVerification, "ConnectionEnd: Versions.Features content mismatch")
		}
	}

	state, err := core.DecodeNullaryConstructor(datumConnectionEnd.State, 3)
	if err != nil {
		return errorsmod.Wrap(clienttypes.ErrFailedMembershipVerification, "ConnectionEnd: invalid State")
	}
	datumConnectionEndState := connectiontypes.State(state)
	if datumConnectionEndState != tmConnectionEnd.State {
		return errorsmod.Wrapf(
			clienttypes.ErrFailedMembershipVerification,
			"ConnectionEnd: State mismatch, expect %s, got %v",
			tmConnectionEnd.State,
			datumConnectionEndState,
		)
	}
	counterPartyClientId := string(datumConnectionEnd.Counterparty.ClientId[:])
	if counterPartyClientId != tmConnectionEnd.Counterparty.ClientId {
		return errorsmod.Wrapf(
			clienttypes.ErrFailedMembershipVerification,
			"ConnectionEnd: Counterparty ClientId mismatch, expect %s, got %s",
			tmConnectionEnd.Counterparty.ClientId,
			counterPartyClientId,
		)
	}
	counterPartyConnectionId := string(datumConnectionEnd.Counterparty.ConnectionId[:])
	if counterPartyConnectionId != tmConnectionEnd.Counterparty.ConnectionId {
		return errorsmod.Wrapf(
			clienttypes.ErrFailedMembershipVerification,
			"ConnectionEnd: Counterparty ConnectionId mismatch, expect %s, got %s",
			tmConnectionEnd.Counterparty.ConnectionId,
			counterPartyConnectionId,
		)
	}

	if !bytes.Equal(datumConnectionEnd.Counterparty.Prefix.KeyPrefix, tmConnectionEnd.Counterparty.Prefix.KeyPrefix) {
		return errorsmod.Wrapf(
			clienttypes.ErrFailedMembershipVerification,
			"ConnectionEnd: Counterparty Prefix mismatch, expect %v, got %v",
			tmConnectionEnd.Counterparty.Prefix.KeyPrefix,
			datumConnectionEnd.Counterparty.Prefix.KeyPrefix,
		)
	}

	if datumConnectionEnd.DelayPeriod != tmConnectionEnd.DelayPeriod {
		return errorsmod.Wrapf(
			clienttypes.ErrFailedMembershipVerification,
			"ConnectionEnd: DelayPeriod mismatch, expect %v, got %v",
			tmConnectionEnd.DelayPeriod,
			datumConnectionEnd.DelayPeriod,
		)
	}
	return nil
}

func (channelDatum ChannelDatum) Cmp(expectedChannel channeltypes.Channel) error {
	state, err := core.DecodeNullaryConstructor(channelDatum.State, 4)
	if err != nil {
		return errorsmod.Wrap(clienttypes.ErrFailedMembershipVerification, "Channel: invalid State")
	}
	channelDatumStateNumberState := channeltypes.State(state)
	if channelDatumStateNumberState != expectedChannel.State {
		return errorsmod.Wrapf(
			clienttypes.ErrFailedMembershipVerification,
			"Channel: State mismatch, expect %s, got %s",
			expectedChannel.State,
			channelDatumStateNumberState,
		)
	}

	order, err := core.DecodeNullaryConstructor(channelDatum.Ordering, 2)
	if err != nil {
		return errorsmod.Wrap(clienttypes.ErrFailedMembershipVerification, "Channel: invalid Ordering")
	}
	channelDatumOrderingNumberState := channeltypes.Order(order)
	if channelDatumOrderingNumberState != expectedChannel.Ordering {
		return errorsmod.Wrapf(
			clienttypes.ErrFailedMembershipVerification,
			"Channel: Ordering mismatch, expect %s, got %s",
			expectedChannel.Ordering,
			channelDatumOrderingNumberState,
		)
	}

	counterpartyPortId := string(channelDatum.Counterparty.PortId[:])
	if counterpartyPortId != expectedChannel.Counterparty.PortId {
		return errorsmod.Wrapf(
			clienttypes.ErrFailedMembershipVerification,
			"Channel: Counterparty PortId mismatch, expect %s, got %s",
			expectedChannel.Counterparty.PortId,
			counterpartyPortId,
		)
	}
	counterpartyChannelId := string(channelDatum.Counterparty.ChannelId[:])
	if counterpartyChannelId != expectedChannel.Counterparty.ChannelId {
		return errorsmod.Wrapf(
			clienttypes.ErrFailedMembershipVerification,
			"Channel: Counterparty ChannelId mismatch, expect %s, got %s",
			expectedChannel.Counterparty.ChannelId,
			counterpartyChannelId,
		)
	}

	if len(channelDatum.ConnectionHops) != len(expectedChannel.ConnectionHops) {
		return errorsmod.Wrapf(
			clienttypes.ErrFailedMembershipVerification,
			"Channel: ConnectionHops length mismatch, expect %v, got %v",
			len(expectedChannel.ConnectionHops),
			len(channelDatum.ConnectionHops),
		)
	}
	hops := []string{}
	expectedHops := expectedChannel.ConnectionHops
	for _, hopsValue := range channelDatum.ConnectionHops {
		hops = append(hops, string(hopsValue[:]))
	}
	sort.Strings(hops)
	sort.Strings(expectedHops)
	if strings.Join(hops[:], ",") != strings.Join(expectedHops[:], ",") {
		return errorsmod.Wrap(clienttypes.ErrFailedMembershipVerification, "Channel: ConnectionHops content mismatch")
	}

	versionString := string(channelDatum.Version[:])
	if versionString != expectedChannel.Version {
		return errorsmod.Wrapf(
			clienttypes.ErrFailedMembershipVerification,
			"Channel: Version mismatch, expect %s, got %s",
			expectedChannel.Version,
			versionString,
		)
	}
	return nil
}
