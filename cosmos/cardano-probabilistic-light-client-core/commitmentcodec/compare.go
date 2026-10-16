package commitmentcodec

import (
	"bytes"
	"fmt"
	"slices"
)

type ConsensusStateValue struct {
	Timestamp                uint64
	NextValidatorsHash, Root []byte
}

type ConnectionVersionValue struct {
	Identifier string
	Features   []string
}

type ConnectionEndValue struct {
	ClientId                                       string
	Versions                                       []ConnectionVersionValue
	State                                          uint64
	CounterpartyClientId, CounterpartyConnectionId string
	CounterpartyPrefix                             []byte
	DelayPeriod                                    uint64
}

type ChannelValue struct {
	State, Ordering                           uint64
	CounterpartyPortId, CounterpartyChannelId string
	ConnectionHops                            []string
	Version                                   string
	UpgradeSequence                           uint64
}

func (datum ConsensusStateDatum) Compare(expected ConsensusStateValue) error {
	if datum.Timestamp != expected.Timestamp || !bytes.Equal(datum.NextValidatorsHash, expected.NextValidatorsHash) || !bytes.Equal(datum.Root.Hash, expected.Root) {
		return fmt.Errorf("ConsensusState: committed value mismatch")
	}
	return nil
}

func (datum ConnectionEndDatum) Compare(expected ConnectionEndValue) error {
	state, err := DecodeNullaryConstructor(datum.State, 3)
	if err != nil {
		return fmt.Errorf("ConnectionEnd: invalid State: %w", err)
	}
	if string(datum.ClientId) != expected.ClientId || state != expected.State || datum.DelayPeriod != expected.DelayPeriod || string(datum.Counterparty.ClientId) != expected.CounterpartyClientId || string(datum.Counterparty.ConnectionId) != expected.CounterpartyConnectionId || !bytes.Equal(datum.Counterparty.Prefix.KeyPrefix, expected.CounterpartyPrefix) {
		return fmt.Errorf("ConnectionEnd: committed value mismatch")
	}
	if len(datum.Versions) != len(expected.Versions) {
		return fmt.Errorf("ConnectionEnd: Versions length mismatch")
	}
	for i, version := range datum.Versions {
		features := byteStrings(version.Features)
		expectedFeatures := slices.Clone(expected.Versions[i].Features)
		slices.Sort(features)
		slices.Sort(expectedFeatures)
		if string(version.Identifier) != expected.Versions[i].Identifier || !slices.Equal(features, expectedFeatures) {
			return fmt.Errorf("ConnectionEnd: Versions[%d] mismatch", i)
		}
	}
	return nil
}

func (datum ChannelDatum) Compare(expected ChannelValue) error {
	state, err := DecodeNullaryConstructor(datum.State, 4)
	if err != nil {
		return fmt.Errorf("Channel: invalid State: %w", err)
	}
	ordering, err := DecodeNullaryConstructor(datum.Ordering, 2)
	if err != nil {
		return fmt.Errorf("Channel: invalid Ordering: %w", err)
	}
	if state != expected.State || ordering != expected.Ordering || string(datum.Counterparty.PortId) != expected.CounterpartyPortId || string(datum.Counterparty.ChannelId) != expected.CounterpartyChannelId || !slices.Equal(byteStrings(datum.ConnectionHops), expected.ConnectionHops) || string(datum.Version) != expected.Version {
		return fmt.Errorf("Channel: committed value mismatch")
	}
	// Neither supported format commits channel-upgrade state.
	if expected.UpgradeSequence != 0 {
		return fmt.Errorf("Channel: uncommitted UpgradeSequence")
	}
	return nil
}

func byteStrings(values [][]byte) []string {
	result := make([]string, len(values))
	for i, value := range values {
		result[i] = string(value)
	}
	return result
}
