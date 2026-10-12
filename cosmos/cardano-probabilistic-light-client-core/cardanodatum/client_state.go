package cardanodatum

import (
	"bytes"
	"fmt"
	"slices"
	"time"

	ics23 "github.com/cosmos/ics23/go"
	"github.com/fxamacker/cbor/v2"
)

// TendermintClientStateValue contains the protobuf fields that must agree with
// the current Cardano commitment codec, without depending on an ibc-go version.
type TendermintClientStateValue struct {
	ChainId                      string
	TrustLevel                   TrustLevelDatum
	TrustingPeriod               time.Duration
	UnbondingPeriod              time.Duration
	MaxClockDrift                time.Duration
	FrozenHeight                 HeightDatum
	LatestHeight                 HeightDatum
	ProofSpecs                   []*ics23.ProofSpec
	UpgradePath                  []string
	AllowUpdateAfterExpiry       bool
	AllowUpdateAfterMisbehaviour bool
}

func (datum ClientStateDatum) Compare(expected TendermintClientStateValue) error {
	checks := []struct {
		field string
		match bool
	}{
		{"ChainId", string(datum.ChainId) == expected.ChainId},
		{"TrustLevel", datum.TrustLevel.Numerator == expected.TrustLevel.Numerator && datum.TrustLevel.Denominator == expected.TrustLevel.Denominator},
		{"TrustingPeriod", expected.TrustingPeriod >= 0 && datum.TrustingPeriod == uint64(expected.TrustingPeriod)},
		{"UnbondingPeriod", expected.UnbondingPeriod >= 0 && datum.UnbondingPeriod == uint64(expected.UnbondingPeriod)},
		{"MaxClockDrift", expected.MaxClockDrift >= 0 && datum.MaxClockDrift == uint64(expected.MaxClockDrift)},
		{"FrozenHeight", datum.FrozenHeight == expected.FrozenHeight},
		{"LatestHeight", datum.LatestHeight == expected.LatestHeight},
		{"UpgradePath length", len(datum.UpgradePath) == len(expected.UpgradePath)},
		// The current nine-field Cardano codec omits the deprecated flags.
		// Their only authenticated interpretation is the protobuf default false.
		{"AllowUpdateAfterExpiry", !expected.AllowUpdateAfterExpiry},
		{"AllowUpdateAfterMisbehaviour", !expected.AllowUpdateAfterMisbehaviour},
	}
	for _, check := range checks {
		if !check.match {
			return fmt.Errorf("ClientState: %s mismatch", check.field)
		}
	}
	for i, segment := range datum.UpgradePath {
		if string(segment) != expected.UpgradePath[i] {
			return fmt.Errorf("ClientState: UpgradePath mismatch")
		}
	}
	if len(datum.ProofSpecs) != len(expected.ProofSpecs) {
		return fmt.Errorf("ClientState: ProofSpecs length mismatch")
	}
	for i, spec := range datum.ProofSpecs {
		if err := spec.compare(expected.ProofSpecs[i]); err != nil {
			return fmt.Errorf("ClientState: ProofSpecs[%d]: %w", i, err)
		}
	}
	return nil
}

func (datum ProofSpecsDatum) compare(expected *ics23.ProofSpec) error {
	if expected == nil || expected.LeafSpec == nil || expected.InnerSpec == nil {
		return fmt.Errorf("missing proof specification or operation")
	}
	prehash, err := DecodeNullaryConstructor(datum.PrehashKeyBeforeComparison, 1)
	if err != nil {
		return fmt.Errorf("invalid PrehashKeyBeforeComparison: %w", err)
	}
	leaf, inner := expected.LeafSpec, expected.InnerSpec
	checks := []struct {
		field string
		match bool
	}{
		{"LeafSpec.Hash", datum.LeafSpec.Hash == int32(leaf.Hash)},
		{"LeafSpec.PrehashKey", datum.LeafSpec.PrehashKey == int32(leaf.PrehashKey)},
		{"LeafSpec.PrehashValue", datum.LeafSpec.PrehashValue == int32(leaf.PrehashValue)},
		{"LeafSpec.Length", datum.LeafSpec.Length == int32(leaf.Length)},
		{"LeafSpec.Prefix", bytes.Equal(datum.LeafSpec.Prefix, leaf.Prefix)},
		{"InnerSpec.ChildOrder", slices.Equal(datum.InnerSpec.ChildOrder, inner.ChildOrder)},
		{"InnerSpec.ChildSize", datum.InnerSpec.ChildSize == inner.ChildSize},
		{"InnerSpec.MinPrefixLength", datum.InnerSpec.MinPrefixLength == inner.MinPrefixLength},
		{"InnerSpec.MaxPrefixLength", datum.InnerSpec.MaxPrefixLength == inner.MaxPrefixLength},
		{"InnerSpec.EmptyChild", bytes.Equal(datum.InnerSpec.EmptyChild, inner.EmptyChild)},
		{"InnerSpec.Hash", datum.InnerSpec.Hash == int32(inner.Hash)},
		{"MaxDepth", datum.MaxDepth == expected.MaxDepth},
		{"MinDepth", datum.MinDepth == expected.MinDepth},
		{"PrehashKeyBeforeComparison", (prehash == 1) == expected.PrehashKeyBeforeComparison},
	}
	for _, check := range checks {
		if !check.match {
			return fmt.Errorf("%s mismatch", check.field)
		}
	}
	return nil
}

// DecodeNullaryConstructor accepts the current codec's Plutus constructors with
// no fields. Checking both tag and fields avoids panics and ambiguous enums.
func DecodeNullaryConstructor(value any, maximum uint64) (uint64, error) {
	tag, ok := value.(cbor.Tag)
	if !ok || tag.Number < 121 || tag.Number-121 > maximum {
		return 0, fmt.Errorf("invalid constructor tag")
	}
	fields, ok := tag.Content.([]interface{})
	if !ok || len(fields) != 0 {
		return 0, fmt.Errorf("constructor must have no fields")
	}
	return tag.Number - 121, nil
}
