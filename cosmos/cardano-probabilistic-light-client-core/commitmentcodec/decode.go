package commitmentcodec

import (
	"bytes"
	"encoding/binary"
	"fmt"

	"github.com/fxamacker/cbor/v2"
)

// Version names existing byte formats. It is not a deployment generation or a
// HostState update counter. No operator-selected decoder changes these rules.
type Version uint8

const (
	Legacy8 Version = iota
	UpgradePath9
)

// DecodeClientState selects only between the two disjoint authenticated record
// shapes. A malformed nine-field record never falls back to the legacy format.
func DecodeClientState(data []byte) (ClientStateDatum, Version, error) {
	var result ClientStateDatum
	fields, err := recordFields(data)
	if err != nil {
		return result, 0, err
	}
	var version Version
	switch len(fields) {
	case 8:
		version = Legacy8
		// The historical format authenticates only the empty upgrade path.
		fields = append(fields, cbor.RawMessage{0x80})
	case 9:
		version = UpgradePath9
	default:
		return result, 0, fmt.Errorf("unsupported client-state field count: %d", len(fields))
	}
	if err := requireKinds(fields, "bruuurrll"); err != nil {
		return result, 0, err
	}
	for _, index := range []int{1, 5, 6} {
		parts, err := requireRecord(fields[index], 2)
		if err != nil {
			return result, 0, err
		}
		if err := requireKinds(parts, "uu"); err != nil {
			return result, 0, err
		}
	}
	specs, err := listFields(fields[7])
	if err != nil {
		return result, 0, err
	}
	for _, spec := range specs {
		parts, err := requireRecord(spec, 5)
		if err != nil {
			return result, 0, err
		}
		if err := requireKinds(parts, "rruur"); err != nil {
			return result, 0, err
		}
		leaf, err := requireRecord(parts[0], 5)
		if err != nil {
			return result, 0, err
		}
		if err := requireKinds(leaf, "uuuub"); err != nil {
			return result, 0, err
		}
		inner, err := requireRecord(parts[1], 6)
		if err != nil {
			return result, 0, err
		}
		if err := requireKinds(inner, "luuubu"); err != nil {
			return result, 0, err
		}
		if err := requireListKind(inner[0], 'u'); err != nil {
			return result, 0, err
		}
		var boolean any
		if err := cbor.Unmarshal(parts[4], &boolean); err != nil {
			return result, 0, err
		}
		if _, err := DecodeNullaryConstructor(boolean, 1); err != nil {
			return result, 0, err
		}
	}
	if err := requireListKind(fields[8], 'b'); err != nil {
		return result, 0, err
	}
	// Decode into a method-free wire type to avoid recursive UnmarshalCBOR calls.
	encoded, err := cbor.Marshal(fields)
	if err != nil {
		return result, 0, err
	}
	type wire ClientStateDatum
	var decoded wire
	if err := cbor.Unmarshal(encoded, &decoded); err != nil {
		return result, 0, err
	}
	return ClientStateDatum(decoded), version, nil
}

func (datum *ClientStateDatum) UnmarshalCBOR(data []byte) error {
	decoded, _, err := DecodeClientState(data)
	if err != nil {
		return err
	}
	*datum = decoded
	return nil
}

func DecodeConsensusState(data []byte) (ConsensusStateDatum, error) {
	var result ConsensusStateDatum
	fields, err := requireRecord(data, 3)
	if err != nil {
		return result, err
	}
	if err := requireKinds(fields, "ubr"); err != nil {
		return result, err
	}
	root, err := requireRecord(fields[2], 1)
	if err != nil {
		return result, err
	}
	if err := requireKinds(root, "b"); err != nil {
		return result, err
	}
	err = cbor.Unmarshal(data, &result)
	return result, err
}

func DecodeConnectionEnd(data []byte) (ConnectionEndDatum, error) {
	var result ConnectionEndDatum
	fields, err := requireRecord(data, 5)
	if err != nil {
		return result, err
	}
	if err := requireKinds(fields, "blrru"); err != nil {
		return result, err
	}
	versions, err := listFields(fields[1])
	if err != nil {
		return result, err
	}
	for _, version := range versions {
		parts, err := requireRecord(version, 2)
		if err != nil {
			return result, err
		}
		if err := requireKinds(parts, "bl"); err != nil {
			return result, err
		}
		if err := requireListKind(parts[1], 'b'); err != nil {
			return result, err
		}
	}
	counterparty, err := requireRecord(fields[3], 3)
	if err != nil {
		return result, err
	}
	if err := requireKinds(counterparty, "bbr"); err != nil {
		return result, err
	}
	prefix, err := requireRecord(counterparty[2], 1)
	if err != nil {
		return result, err
	}
	if err := requireKinds(prefix, "b"); err != nil {
		return result, err
	}
	if err := cbor.Unmarshal(data, &result); err != nil {
		return result, err
	}
	_, err = DecodeNullaryConstructor(result.State, 3)
	return result, err
}

func DecodeChannel(data []byte) (ChannelDatum, error) {
	var result ChannelDatum
	fields, err := requireRecord(data, 5)
	if err != nil {
		return result, err
	}
	if err := requireKinds(fields, "rrrlb"); err != nil {
		return result, err
	}
	counterparty, err := requireRecord(fields[2], 2)
	if err != nil {
		return result, err
	}
	if err := requireKinds(counterparty, "bb"); err != nil {
		return result, err
	}
	if err := requireListKind(fields[3], 'b'); err != nil {
		return result, err
	}
	if err := cbor.Unmarshal(data, &result); err != nil {
		return result, err
	}
	if _, err := DecodeNullaryConstructor(result.State, 4); err != nil {
		return result, err
	}
	_, err = DecodeNullaryConstructor(result.Ordering, 2)
	return result, err
}

func DecodeRegistration(data []byte) (ModuleRegistrationDatum, error) {
	var result ModuleRegistrationDatum
	fields, err := requireRecord(data, 3)
	if err != nil {
		return result, err
	}
	if err := requireKinds(fields, "brr"); err != nil {
		return result, err
	}
	for _, index := range []int{1, 2} {
		token, err := requireRecord(fields[index], 2)
		if err != nil {
			return result, err
		}
		if err := requireKinds(token, "bb"); err != nil {
			return result, err
		}
	}
	err = cbor.Unmarshal(data, &result)
	return result, err
}

func ComparePacketBytes(committed, expected []byte) error {
	if len(committed) == 0 || committed[0]>>5 != 2 {
		return fmt.Errorf("committed packet value must be a CBOR bytestring")
	}
	var value []byte
	if err := cbor.Unmarshal(committed, &value); err != nil {
		return err
	}
	if !bytes.Equal(value, expected) {
		return fmt.Errorf("existence proof value mismatch")
	}
	return nil
}

func CompareNextSequenceRecv(committed, expected []byte) error {
	if len(expected) != 8 {
		return fmt.Errorf("invalid expected nextSequenceRecv length: %d (want 8)", len(expected))
	}
	if len(committed) == 0 || committed[0]>>5 != 0 {
		return fmt.Errorf("committed nextSequenceRecv must be a CBOR unsigned integer")
	}
	var value uint64
	if err := cbor.Unmarshal(committed, &value); err != nil {
		return err
	}
	if value != binary.BigEndian.Uint64(expected) {
		return fmt.Errorf("existence proof value mismatch")
	}
	return nil
}

func recordFields(data []byte) ([]cbor.RawMessage, error) {
	var tag cbor.RawTag
	if err := cbor.Unmarshal(data, &tag); err != nil {
		return nil, fmt.Errorf("expected Plutus record: %w", err)
	}
	if tag.Number != 121 {
		return nil, fmt.Errorf("unsupported record constructor: %d", tag.Number)
	}
	return listFields(tag.Content)
}

func requireRecord(data []byte, count int) ([]cbor.RawMessage, error) {
	fields, err := recordFields(data)
	if err != nil {
		return nil, err
	}
	if len(fields) != count {
		return nil, fmt.Errorf("invalid record field count: %d (want %d)", len(fields), count)
	}
	return fields, nil
}

func listFields(data []byte) ([]cbor.RawMessage, error) {
	if len(data) == 0 || data[0]>>5 != 4 {
		return nil, fmt.Errorf("expected CBOR array")
	}
	var fields []cbor.RawMessage
	if err := cbor.Unmarshal(data, &fields); err != nil {
		return nil, err
	}
	return fields, nil
}

// Check the Plutus value kind before decoding into Go. CBOR null must not
// silently become a protobuf default, and scalar tags cannot hide another kind.
func requireKinds(fields []cbor.RawMessage, kinds string) error {
	for i, kind := range []byte(kinds) {
		data := fields[i]
		if len(data) == 0 {
			return fmt.Errorf("empty field %d", i)
		}
		major := data[0] >> 5
		valid := kind == 'r' || kind == 'b' && major == 2 || kind == 'u' && major == 0 || kind == 'l' && major == 4
		if !valid {
			return fmt.Errorf("invalid Plutus field kind at %d", i)
		}
		if kind == 'u' {
			var number uint64
			if err := cbor.Unmarshal(data, &number); err != nil {
				return err
			}
		}
	}
	return nil
}

func requireListKind(data []byte, kind byte) error {
	fields, err := listFields(data)
	if err != nil {
		return err
	}
	for _, field := range fields {
		if err := requireKinds([]cbor.RawMessage{field}, string(kind)); err != nil {
			return err
		}
	}
	return nil
}
