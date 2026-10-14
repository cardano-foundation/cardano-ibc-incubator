package cardanodatum

import (
	errorsmod "cosmossdk.io/errors"
	codec "github.com/cardano-foundation/cardano-ibc-incubator/cosmos/cardano-probabilistic-light-client-core/commitmentcodec"
	clienttypes "github.com/cosmos/ibc-go/v10/modules/core/02-client/types"
	connectiontypes "github.com/cosmos/ibc-go/v10/modules/core/03-connection/types"
	channeltypes "github.com/cosmos/ibc-go/v10/modules/core/04-channel/types"
	tm "github.com/cosmos/ibc-go/v10/modules/light-clients/07-tendermint"
)

func (datum *ClientStateDatum) UnmarshalCBOR(data []byte) error {
	value, _, err := codec.DecodeClientState(data)
	if err != nil {
		return err
	}
	*datum = ClientStateDatum(value)
	return nil
}

func (datum ClientStateDatum) Cmp(expected *tm.ClientState) error {
	if expected == nil {
		return errorsmod.Wrap(clienttypes.ErrFailedMembershipVerification, "ClientState: expected state missing")
	}
	return wrapComparison(codec.ClientStateDatum(datum).Compare(codec.TendermintClientStateValue{
		ChainId: expected.ChainId, TrustLevel: TrustLevelDatum{Numerator: expected.TrustLevel.Numerator, Denominator: expected.TrustLevel.Denominator},
		TrustingPeriod: expected.TrustingPeriod, UnbondingPeriod: expected.UnbondingPeriod, MaxClockDrift: expected.MaxClockDrift,
		FrozenHeight: HeightDatum{RevisionNumber: expected.FrozenHeight.RevisionNumber, RevisionHeight: expected.FrozenHeight.RevisionHeight},
		LatestHeight: HeightDatum{RevisionNumber: expected.LatestHeight.RevisionNumber, RevisionHeight: expected.LatestHeight.RevisionHeight},
		ProofSpecs:   expected.ProofSpecs, UpgradePath: expected.UpgradePath,
		AllowUpdateAfterExpiry: expected.AllowUpdateAfterExpiry, AllowUpdateAfterMisbehaviour: expected.AllowUpdateAfterMisbehaviour,
	}))
}

func (datum ConsensusStateDatum) Cmp(expected *tm.ConsensusState) error {
	if expected == nil {
		return errorsmod.Wrap(clienttypes.ErrFailedMembershipVerification, "ConsensusState: expected state missing")
	}
	return wrapComparison(codec.ConsensusStateDatum(datum).Compare(codec.ConsensusStateValue{
		Timestamp: expected.GetTimestamp(), NextValidatorsHash: expected.NextValidatorsHash, Root: expected.Root.Hash,
	}))
}

func (datum ConnectionEndDatum) Cmp(expected connectiontypes.ConnectionEnd) error {
	versions := make([]codec.ConnectionVersionValue, len(expected.Versions))
	for i, version := range expected.Versions {
		if version == nil {
			return errorsmod.Wrap(clienttypes.ErrFailedMembershipVerification, "ConnectionEnd: missing version")
		}
		versions[i] = codec.ConnectionVersionValue{Identifier: version.Identifier, Features: version.Features}
	}
	return wrapComparison(codec.ConnectionEndDatum(datum).Compare(codec.ConnectionEndValue{
		ClientId: expected.ClientId, Versions: versions, State: uint64(expected.State),
		CounterpartyClientId: expected.Counterparty.ClientId, CounterpartyConnectionId: expected.Counterparty.ConnectionId,
		CounterpartyPrefix: expected.Counterparty.Prefix.KeyPrefix, DelayPeriod: expected.DelayPeriod,
	}))
}

func (datum ChannelDatum) Cmp(expected channeltypes.Channel) error {
	return wrapComparison(codec.ChannelDatum(datum).Compare(codec.ChannelValue{
		State: uint64(expected.State), Ordering: uint64(expected.Ordering),
		CounterpartyPortId: expected.Counterparty.PortId, CounterpartyChannelId: expected.Counterparty.ChannelId,
		ConnectionHops: expected.ConnectionHops, Version: expected.Version, UpgradeSequence: channelUpgradeSequence(expected),
	}))
}

func wrapComparison(err error) error {
	if err != nil {
		return errorsmod.Wrap(clienttypes.ErrFailedMembershipVerification, err.Error())
	}
	return nil
}
