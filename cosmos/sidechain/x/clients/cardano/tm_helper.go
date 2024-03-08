package cardano

import (
	"bytes"
	"sort"
	"strings"

	"encoding/hex"

	errorsmod "cosmossdk.io/errors"
	clienttypes "github.com/cosmos/ibc-go/v8/modules/core/02-client/types"
	connectiontypes "github.com/cosmos/ibc-go/v8/modules/core/03-connection/types"
	channeltypes "github.com/cosmos/ibc-go/v8/modules/core/04-channel/types"
	tmStruct "github.com/cosmos/ibc-go/v8/modules/light-clients/07-tendermint"
	"github.com/fxamacker/cbor/v2"
)

const (
	CBOR_TAG_MAGIC_NUMBER = 121
)

func decodeHexToString(data []byte) string {
	hexText := string(data[:])
	hexBytes, _ := hex.DecodeString(hexText)
	return string(hexBytes)
}

func (datumClientState ClientStateDatum) Cmp(tmClient *tmStruct.ClientState) error {
	// chainIdString := decodeHexToString(datumClientState.ChainId[:])
	chainIdString := string(datumClientState.ChainId[:])
	if chainIdString != tmClient.ChainId {
		return errorsmod.Wrapf(clienttypes.ErrFailedMembershipVerification, "ClientState: Chain Id mismatch, expect %s, got %s", tmClient.ChainId, chainIdString)
	}
	if datumClientState.TrustLevel.Denominator != tmClient.TrustLevel.Denominator || datumClientState.TrustLevel.Numerator != tmClient.TrustLevel.Numerator {
		return errorsmod.Wrapf(clienttypes.ErrFailedMembershipVerification, "ClientState: TrustLevel mismatch, expect %v, got %v", tmClient.TrustLevel, datumClientState.TrustLevel)
	}
	if datumClientState.TrustingPeriod != uint64(tmClient.TrustingPeriod) {
		return errorsmod.Wrapf(clienttypes.ErrFailedMembershipVerification, "ClientState: TrustingPeriod mismatch, expect %v, got %v", uint64(tmClient.TrustingPeriod), datumClientState.TrustingPeriod)
	}
	if datumClientState.UnbondingPeriod != uint64(tmClient.UnbondingPeriod) {
		return errorsmod.Wrapf(clienttypes.ErrFailedMembershipVerification, "ClientState: UnbondingPeriod mismatch, expect %v, got %v", uint64(tmClient.UnbondingPeriod), datumClientState.UnbondingPeriod)
	}
	if datumClientState.MaxClockDrift != uint64(tmClient.MaxClockDrift) {
		return errorsmod.Wrapf(clienttypes.ErrFailedMembershipVerification, "ClientState: MaxClockDrift mismatch, expect %v, got %v", uint64(tmClient.MaxClockDrift), datumClientState.MaxClockDrift)
	}
	if datumClientState.FrozenHeight.RevisionHeight != tmClient.FrozenHeight.RevisionHeight || datumClientState.FrozenHeight.RevisionNumber != tmClient.FrozenHeight.RevisionNumber {
		return errorsmod.Wrapf(clienttypes.ErrFailedMembershipVerification, "ClientState: FrozenHeight mismatch, expect %s, got %s", tmClient.FrozenHeight, clienttypes.Height{
			RevisionNumber: datumClientState.FrozenHeight.RevisionNumber,
			RevisionHeight: datumClientState.FrozenHeight.RevisionHeight,
		})
	}

	if datumClientState.LatestHeight.RevisionHeight != tmClient.LatestHeight.RevisionHeight || datumClientState.LatestHeight.RevisionNumber != tmClient.LatestHeight.RevisionNumber {
		return errorsmod.Wrapf(clienttypes.ErrFailedMembershipVerification, "ClientState: LatestHeight mismatch, expect %s, got %s", tmClient.LatestHeight, clienttypes.Height{
			RevisionNumber: datumClientState.LatestHeight.RevisionNumber,
			RevisionHeight: datumClientState.LatestHeight.RevisionHeight,
		})
	}

	// TODO: Cmp ProofSpecs

	return nil
}

func (datumConsensusState ConsensusStateDatum) Cmp(tmConsensusState *tmStruct.ConsensusState) error {
	if datumConsensusState.Timestamp != tmConsensusState.GetTimestamp() {
		return errorsmod.Wrapf(clienttypes.ErrFailedMembershipVerification, "ConsensusState: Timestamp mismatch, expect %v, got %v", tmConsensusState.GetTimestamp(), datumConsensusState.Timestamp)
	}

	if !bytes.Equal(datumConsensusState.NextValidatorsHash, tmConsensusState.NextValidatorsHash) {
		return errorsmod.Wrapf(clienttypes.ErrFailedMembershipVerification, "ConsensusState: NextValidatorsHash mismatch, expect %v, got %v", tmConsensusState.NextValidatorsHash, datumConsensusState.NextValidatorsHash)
	}

	if !bytes.Equal(datumConsensusState.Root.Hash, tmConsensusState.Root.Hash) {
		return errorsmod.Wrapf(clienttypes.ErrFailedMembershipVerification, "ConsensusState: RootHash mismatch, expect %v, got %v", tmConsensusState.Root.Hash, datumConsensusState.Root.Hash)
	}

	return nil
}

func (datumConnectionEnd ConnectionEndDatum) Cmp(tmConnectionEnd connectiontypes.ConnectionEnd) error {
	clientIdString := string(datumConnectionEnd.ClientId[:])
	// tmClientIdByte, _ := hex.DecodeString(tmConnectionEnd.ClientId)
	if clientIdString != tmConnectionEnd.ClientId {
		return errorsmod.Wrapf(clienttypes.ErrFailedMembershipVerification, "ConnectionEnd: ClientId mismatch, expect %s, got %v", tmConnectionEnd.ClientId, clientIdString)
	}
	if len(datumConnectionEnd.Versions) != len(tmConnectionEnd.Versions) {
		return errorsmod.Wrapf(clienttypes.ErrFailedMembershipVerification, "ConnectionEnd: Versions length mismatch, expect %v, got %v", len(tmConnectionEnd.Versions), len(datumConnectionEnd.Versions))
	}
	for i, versionValue := range datumConnectionEnd.Versions {
		identifier := string(versionValue.Identifier[:])
		if identifier != tmConnectionEnd.Versions[i].Identifier {
			return errorsmod.Wrapf(clienttypes.ErrFailedMembershipVerification, "ConnectionEnd: Identifier mismatch, expect %s, got %s", tmConnectionEnd.Versions[i].Identifier, identifier)
		}
		if len(versionValue.Features) != len(tmConnectionEnd.Versions[i].Features) {
			return errorsmod.Wrapf(clienttypes.ErrFailedMembershipVerification, "ConnectionEnd: Versions.Features length mismatch, expect %v, got %v", len(tmConnectionEnd.Versions[i].Features), len(versionValue.Features))
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

	datumConnectionEndStateNumber := (datumConnectionEnd.State.(cbor.Tag)).Number
	datumConnectionEndState := connectiontypes.State(datumConnectionEndStateNumber - CBOR_TAG_MAGIC_NUMBER)
	if datumConnectionEndState != tmConnectionEnd.State {
		return errorsmod.Wrapf(clienttypes.ErrFailedMembershipVerification, "ConnectionEnd: State mismatch, expect %s, got %v", tmConnectionEnd.State, datumConnectionEndState)
	}
	counterPartyClientId := string(datumConnectionEnd.Counterparty.ClientId[:])
	if counterPartyClientId != tmConnectionEnd.Counterparty.ClientId {
		return errorsmod.Wrapf(clienttypes.ErrFailedMembershipVerification, "ConnectionEnd: Counterparty ClientId mismatch, expect %s, got %s", tmConnectionEnd.Counterparty.ClientId, counterPartyClientId)
	}
	counterPartyConnectionId := string(datumConnectionEnd.Counterparty.ConnectionId[:])
	if counterPartyConnectionId != tmConnectionEnd.Counterparty.ConnectionId {
		return errorsmod.Wrapf(clienttypes.ErrFailedMembershipVerification, "ConnectionEnd: Counterparty ConnectionId mismatch, expect %s, got %s", tmConnectionEnd.Counterparty.ConnectionId, counterPartyConnectionId)
	}

	if !bytes.Equal(datumConnectionEnd.Counterparty.Prefix.KeyPrefix, tmConnectionEnd.Counterparty.Prefix.KeyPrefix) {
		return errorsmod.Wrapf(clienttypes.ErrFailedMembershipVerification, "ConnectionEnd: Counterparty Prefix mismatch, expect %v, got %v", tmConnectionEnd.Counterparty.Prefix.KeyPrefix, datumConnectionEnd.Counterparty.Prefix.KeyPrefix)
	}

	if datumConnectionEnd.DelayPeriod != tmConnectionEnd.DelayPeriod {
		return errorsmod.Wrapf(clienttypes.ErrFailedMembershipVerification, "ConnectionEnd: DelayPeriod mismatch, expect %v, got %v", tmConnectionEnd.DelayPeriod, datumConnectionEnd.DelayPeriod)
	}
	return nil
}

func (channelDatum ChannelDatum) Cmp(expectedChannel channeltypes.Channel) error {
	// State State
	channelDatumStateNumber := (channelDatum.State.(cbor.Tag)).Number
	channelDatumStateNumberState := channeltypes.State(channelDatumStateNumber - CBOR_TAG_MAGIC_NUMBER)
	if channelDatumStateNumberState != expectedChannel.State {
		return errorsmod.Wrapf(clienttypes.ErrFailedMembershipVerification, "Channel: State mismatch, expect %s, got %s", expectedChannel.State, channelDatumStateNumberState)
	}

	// Ordering Order
	channelDatumOrderingNumber := (channelDatum.Ordering.(cbor.Tag)).Number
	channelDatumOrderingNumberState := channeltypes.Order(channelDatumOrderingNumber - CBOR_TAG_MAGIC_NUMBER)
	if channelDatumOrderingNumberState != expectedChannel.Ordering {
		return errorsmod.Wrapf(clienttypes.ErrFailedMembershipVerification, "Channel: Ordering mismatch, expect %s, got %s", expectedChannel.Ordering, channelDatumOrderingNumberState)
	}

	// Counterparty Counterparty
	counterpartyPortId := string(channelDatum.Counterparty.PortId[:])
	if counterpartyPortId != expectedChannel.Counterparty.PortId {
		return errorsmod.Wrapf(clienttypes.ErrFailedMembershipVerification, "Channel: Counterparty PortId mismatch, expect %s, got %s", expectedChannel.Counterparty.PortId, counterpartyPortId)
	}
	counterpartyChannelId := string(channelDatum.Counterparty.ChannelId[:])
	if counterpartyChannelId != expectedChannel.Counterparty.ChannelId {
		return errorsmod.Wrapf(clienttypes.ErrFailedMembershipVerification, "Channel: Counterparty ChannelId mismatch, expect %s, got %s", expectedChannel.Counterparty.ChannelId, counterpartyChannelId)
	}

	// ConnectionHops []string
	if len(channelDatum.ConnectionHops) != len(expectedChannel.ConnectionHops) {
		return errorsmod.Wrapf(clienttypes.ErrFailedMembershipVerification, "Channel: ConnectionHops length mismatch, expect %v, got %v", len(expectedChannel.ConnectionHops), len(channelDatum.ConnectionHops))
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

	// Version string
	versionString := string(channelDatum.Version[:])
	if versionString != expectedChannel.Version {
		return errorsmod.Wrapf(clienttypes.ErrFailedMembershipVerification, "Channel: Version mismatch, expect %s, got %s", expectedChannel.Version, versionString)
	}
	return nil
}
