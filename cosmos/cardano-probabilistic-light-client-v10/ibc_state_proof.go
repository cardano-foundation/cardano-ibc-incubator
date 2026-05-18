package probabilistic

import (
	"bytes"
	"fmt"
	"strings"

	// Import the existing Cardano CBOR datum decoders/comparators so we can
	// semantically compare Cardano-committed values (CBOR / PlutusData) with the
	// protobuf-encoded values produced by ibc-go.
	//
	// The Cardano commitment scheme commits to `aiken/cbor.serialise(...)` bytes,
	// not to protobuf bytes. The light client is responsible for bridging that
	// encoding difference during verification.
	probabilisticcore "github.com/cardano-foundation/cardano-ibc-incubator/cosmos/cardano-probabilistic-light-client-core"
	cardanodatum "github.com/cardano-foundation/cardano-ibc-incubator/cosmos/cardano-probabilistic-light-client-v10/internal/cardanodatum"
	proto "github.com/cosmos/gogoproto/proto"
	gogotypes "github.com/cosmos/gogoproto/types"
	connectiontypes "github.com/cosmos/ibc-go/v10/modules/core/03-connection/types"
	channeltypes "github.com/cosmos/ibc-go/v10/modules/core/04-channel/types"
	commitmenttypes "github.com/cosmos/ibc-go/v10/modules/core/23-commitment/types"
	tmtypes "github.com/cosmos/ibc-go/v10/modules/light-clients/07-tendermint"
	ics23 "github.com/cosmos/ics23/go"
	"github.com/fxamacker/cbor/v2"
)

// VerifyIbcStateMembership verifies a Gateway-provided proof for `key -> value`
// against an authenticated `ibc_state_root`.
//
// This verifier mirrors the on-chain commitment scheme in:
// `cardano/onchain/lib/ibc/core/ics-025-handler-interface/ibc_state_commitment.ak`.
//
// Important details:
//   - Non-empty leaves commit to both sha256(key) and sha256(value).
//   - The key also determines the path:
//     we derive a 64-bit path selector from the first 8 bytes of sha256(key).
//   - The proof path is always 64 steps (fixed-depth binary tree).
//
// Proof encoding:
//   - Preferred: standard protobuf `MerkleProof` bytes (IBC / ICS-23).
//   - Backwards-compatible: the Gateway currently returns a JSON-encoded proof with
//     the same logical fields (key/value + 64 sibling hashes encoded as InnerOps).
func VerifyIbcStateMembership(root []byte, key []byte, value []byte, proofBytes []byte) error {
	exist, err := decodeExistenceProof(proofBytes)
	if err != nil {
		return err
	}
	return probabilisticcore.VerifyIbcStateMembershipWithExistenceProof(root, key, value, exist, verifyCardanoValueMatchesExpected)
}

func verifyCardanoValueMatchesExpected(key []byte, expectedValue []byte, committedValue []byte) error {
	keyStr := string(key)

	switch {
	case strings.HasPrefix(keyStr, "connections/"):
		var expected connectiontypes.ConnectionEnd
		if err := proto.Unmarshal(expectedValue, &expected); err != nil {
			return fmt.Errorf("failed to decode expected ConnectionEnd protobuf: %w", err)
		}
		var committed cardanodatum.ConnectionEndDatum
		if err := cbor.Unmarshal(committedValue, &committed); err != nil {
			return fmt.Errorf("failed to decode committed ConnectionEnd CBOR: %w", err)
		}
		if err := committed.Cmp(expected); err != nil {
			return err
		}
		return nil

	case strings.HasPrefix(keyStr, "clients/") && strings.HasSuffix(keyStr, "/clientState"):
		// On Cosmos chains, IBC stores the client state value as a protobuf `Any`
		// (type_url + value), not as the raw concrete client state bytes.
		//
		// Our Cardano commitment scheme commits to the *CBOR datum bytes* for the
		// concrete client state (no Any wrapper). During verification we therefore:
		//  1) unwrap the Any from the expected IBC store value
		//  2) decode the inner Tendermint ClientState protobuf
		//  3) semantically compare it with the committed CBOR datum
		var expectedAny gogotypes.Any
		innerExpectedValue := expectedValue
		if err := proto.Unmarshal(expectedValue, &expectedAny); err == nil && len(expectedAny.Value) > 0 {
			innerExpectedValue = expectedAny.Value
		}

		var expected tmtypes.ClientState
		if err := proto.Unmarshal(innerExpectedValue, &expected); err != nil {
			return fmt.Errorf("failed to decode expected Tendermint ClientState protobuf: %w", err)
		}
		var committed cardanodatum.ClientStateDatum
		if err := cbor.Unmarshal(committedValue, &committed); err != nil {
			return fmt.Errorf("failed to decode committed Tendermint ClientState CBOR: %w", err)
		}
		if err := committed.Cmp(&expected); err != nil {
			return err
		}
		return nil

	case strings.HasPrefix(keyStr, "clients/") && strings.Contains(keyStr, "/consensusStates/"):
		// Consensus states are also stored as a protobuf `Any` value in the IBC store.
		var expectedAny gogotypes.Any
		innerExpectedValue := expectedValue
		if err := proto.Unmarshal(expectedValue, &expectedAny); err == nil && len(expectedAny.Value) > 0 {
			innerExpectedValue = expectedAny.Value
		}

		var expected tmtypes.ConsensusState
		if err := proto.Unmarshal(innerExpectedValue, &expected); err != nil {
			return fmt.Errorf("failed to decode expected Tendermint ConsensusState protobuf: %w", err)
		}
		var committed cardanodatum.ConsensusStateDatum
		if err := cbor.Unmarshal(committedValue, &committed); err != nil {
			return fmt.Errorf("failed to decode committed Tendermint ConsensusState CBOR: %w", err)
		}
		if err := committed.Cmp(&expected); err != nil {
			return err
		}
		return nil

	case strings.HasPrefix(keyStr, "channelEnds/"):
		var expected channeltypes.Channel
		if err := proto.Unmarshal(expectedValue, &expected); err != nil {
			return fmt.Errorf("failed to decode expected Channel protobuf: %w", err)
		}
		var committed cardanodatum.ChannelDatum
		if err := cbor.Unmarshal(committedValue, &committed); err != nil {
			return fmt.Errorf("failed to decode committed Channel CBOR: %w", err)
		}
		if err := committed.Cmp(expected); err != nil {
			return err
		}
		return nil

	case strings.HasPrefix(keyStr, "commitments/ports/"),
		strings.HasPrefix(keyStr, "acks/ports/"),
		strings.HasPrefix(keyStr, "receipts/ports/"),
		strings.HasPrefix(keyStr, "nextSequenceRecv/ports/"):
		// Packet commitments / acknowledgements / receipts are stored on Cosmos chains
		// as raw bytes (not protobuf-encoded). Cardano commits to the CBOR-serialised
		// Plutus `ByteArray` for these values, so we need to unwrap the committed
		// CBOR bytestring and compare the underlying bytes.
		var committedBytes []byte
		if err := cbor.Unmarshal(committedValue, &committedBytes); err != nil {
			return fmt.Errorf("failed to decode committed packet bytes CBOR: %w", err)
		}
		if !bytes.Equal(committedBytes, expectedValue) {
			return fmt.Errorf("existence proof value mismatch")
		}
		return nil
	}

	return fmt.Errorf("existence proof value mismatch")
}

// VerifyIbcStateNonMembership verifies that `key` is absent under `root`.
//
// In this commitment scheme, absence is represented by an empty value, which
// maps to the all-zero leaf hash on-chain.
func VerifyIbcStateNonMembership(root []byte, key []byte, proofBytes []byte) error {
	nonexist, err := decodeNonExistenceProof(proofBytes)
	if err != nil {
		return err
	}
	return probabilisticcore.VerifyIbcStateNonMembershipWithNonExistenceProof(root, key, nonexist)
}

func decodeExistenceProof(proofBytes []byte) (*ics23.ExistenceProof, error) {
	// Preferred: standard protobuf MerkleProof bytes.
	var mp commitmenttypes.MerkleProof
	if err := mp.Unmarshal(proofBytes); err == nil {
		if len(mp.Proofs) == 0 {
			return nil, fmt.Errorf("empty merkle proof")
		}
		exist := mp.Proofs[0].GetExist()
		if exist == nil {
			return nil, fmt.Errorf("expected existence proof")
		}
		return exist, nil
	}

	// Backwards-compatible: Gateway JSON placeholder proof.
	return probabilisticcore.DecodeJSONExistenceProof(proofBytes)
}

func decodeNonExistenceProof(proofBytes []byte) (*ics23.NonExistenceProof, error) {
	var mp commitmenttypes.MerkleProof
	if err := mp.Unmarshal(proofBytes); err == nil {
		if len(mp.Proofs) == 0 {
			return nil, fmt.Errorf("empty merkle proof")
		}
		nonexist := mp.Proofs[0].GetNonexist()
		if nonexist == nil {
			return nil, fmt.Errorf("expected non-existence proof")
		}
		return nonexist, nil
	}

	return probabilisticcore.DecodeJSONNonExistenceProof(proofBytes)
}
