package entities

import (
	"encoding/hex"
	"entrypoint/x/clients/mithril/crypto"
	"fmt"
)

type ImmutableFileNumber = uint64

type ProtocolVersion = string

type PartyId = string

type Stake = uint64

type ProtocolMultiSignature struct {
	Key *crypto.StmAggrSig
}

type ProtocolStakeDistribution = []*struct {
	PartyId ProtocolPartyId
	Stake   ProtocolStake
}

type ProtocolPartyId = string

type ProtocolStake = Stake

type ProtocolSigner = crypto.StmSigner

type ProtocolInitializer = StmInitializerWrapper

type HexEncodedKey = string

// ToJSONHex converts the proof to a JSON hex string
func ToJSONHexEncodedKey(key HexEncodedKey) (string, error) {
	// Assuming TransactionsProof is already a hex-encoded string.
	// If not, you'll need to convert it to hex here.
	_, err := hex.DecodeString(string(key))
	if err != nil {
		return "", fmt.Errorf("invalid Hex")
	}
	return string(key), nil
}
