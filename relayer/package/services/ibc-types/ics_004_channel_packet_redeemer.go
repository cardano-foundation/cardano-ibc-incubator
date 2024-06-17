package ibc_types

import (
	"encoding/hex"
	"github.com/fxamacker/cbor/v2"
	"reflect"
)

type PacketSchema struct {
	_                  struct{} `cbor:",toarray"`
	Sequence           uint64
	SourcePort         []byte
	SourceChannel      []byte
	DestinationPort    []byte
	DestinationChannel []byte
	Data               []byte
	TimeoutHeight      HeightSchema
	TimeoutTimestamp   uint64
}

type MintChannelRedeemerType int

const (
	ChanOpenInit MintChannelRedeemerType = 121
	ChanOpenTry  MintChannelRedeemerType = 122
)

type SpendChannelRedeemerType int

const (
	ChanOpenAck     SpendChannelRedeemerType = 121
	ChanOpenConfirm SpendChannelRedeemerType = 122
)

type MintChannelRedeemerChanOpenInit struct {
	_                struct{} `cbor:",toarray"`
	HandlerAuthToken AuthTokenSchema
}

type MintChannelRedeemerChanOpenTry struct {
	_                   struct{} `cbor:",toarray"`
	HandlerAuthToken    AuthTokenSchema
	CounterpartyVersion []byte
	ProofInit           MerkleProofSchema
	ProofHeight         HeightSchema
}

type MintChannelRedeemerSchema struct {
	Type  MintChannelRedeemerType
	Value interface{}
}

type SpendChannelRedeemerSchema struct {
	Type  SpendChannelRedeemerType
	Value interface{}
}

type SpendChannelRedeemerChanOpenAck struct {
	_                   struct{} `cbor:",toarray"`
	CounterpartyVersion []byte
	ProofTry            MerkleProofSchema
	ProofHeight         HeightSchema
}

type SpendChannelRedeemerChanOpenConfirm struct {
	_           struct{} `cbor:",toarray"`
	ProofAck    MerkleProofSchema
	ProofHeight HeightSchema
}

type SpendChannelRedeemerRecvPacket struct {
	_               struct{} `cbor:",toarray"`
	Packet          PacketSchema
	ProofCommitment MerkleProofSchema
	ProofHeight     HeightSchema
}

type SpendChannelRedeemerTimeoutPacket struct {
	_                struct{} `cbor:",toarray"`
	Packet           PacketSchema
	ProofUnreceived  MerkleProofSchema
	ProofHeight      HeightSchema
	NextSequenceRecv uint64
}
type SpendChannelRedeemerAcknowledgePacket struct {
	_               struct{} `cbor:",toarray"`
	Packet          PacketSchema
	Acknowledgement []byte
	ProofAcked      MerkleProofSchema
	ProofHeight     HeightSchema
}
type SpendChannelRedeemerSendPacket struct {
	_      struct{} `cbor:",toarray"`
	Packet PacketSchema
}

// Data.Literal('RefreshUtxo')

type SpendChannelRedeemerRefreshUtxo interface {
}

func DecodeMintChannelRedeemerSchema(mintChannEncoded string) (MintChannelRedeemerSchema, error) {
	datumBytes, _ := hex.DecodeString(mintChannEncoded)
	tags := cbor.NewTagSet()
	err := tags.Add(
		cbor.TagOptions{EncTag: cbor.EncTagRequired, DecTag: cbor.DecTagRequired},
		reflect.TypeOf(MintChannelRedeemerChanOpenInit{}), // your custom type
		121, // CBOR tag number for your custom type
	)
	err = tags.Add(
		cbor.TagOptions{EncTag: cbor.EncTagRequired, DecTag: cbor.DecTagRequired},
		reflect.TypeOf(MintChannelRedeemerChanOpenTry{}), // your custom type
		122, // CBOR tag number for your custom type
	)

	// Create decoding mode with TagSet
	dm, err := cbor.DecOptions{}.DecModeWithTags(tags)

	var result interface{}
	err = dm.Unmarshal(datumBytes, &result)
	if err != nil {
		return MintChannelRedeemerSchema{}, err
	}
	var mintChannRedeemer MintChannelRedeemerSchema
	switch result.(type) {
	case MintChannelRedeemerChanOpenInit: // custom type
		mintChannRedeemer.Type = ChanOpenInit
		mintChannRedeemer.Value = result.(MintChannelRedeemerChanOpenInit)
	case MintChannelRedeemerChanOpenTry:
		mintChannRedeemer.Type = ChanOpenTry
		mintChannRedeemer.Value = result.(MintChannelRedeemerChanOpenTry)
	}
	return mintChannRedeemer, nil
}

func DecodeSpendChannelRedeemerSchema(spendChannEncoded string) (SpendChannelRedeemerSchema, error) {
	datumBytes, _ := hex.DecodeString(spendChannEncoded)
	tags := cbor.NewTagSet()
	err := tags.Add(
		cbor.TagOptions{EncTag: cbor.EncTagRequired, DecTag: cbor.DecTagRequired},
		reflect.TypeOf(SpendChannelRedeemerChanOpenAck{}), // your custom type
		121, // CBOR tag number for your custom type
	)
	err = tags.Add(
		cbor.TagOptions{EncTag: cbor.EncTagRequired, DecTag: cbor.DecTagRequired},
		reflect.TypeOf(SpendChannelRedeemerChanOpenConfirm{}), // your custom type
		122, // CBOR tag number for your custom type
	)

	// Create decoding mode with TagSet
	dm, err := cbor.DecOptions{}.DecModeWithTags(tags)

	var result interface{}
	err = dm.Unmarshal(datumBytes, &result)
	if err != nil {
		return SpendChannelRedeemerSchema{}, err
	}
	var spendChannRedeemer SpendChannelRedeemerSchema
	switch result.(type) {
	case SpendChannelRedeemerChanOpenAck: // custom type
		spendChannRedeemer.Type = ChanOpenAck
		spendChannRedeemer.Value = result.(SpendChannelRedeemerChanOpenAck)
	case SpendChannelRedeemerChanOpenConfirm:
		spendChannRedeemer.Type = ChanOpenConfirm
		spendChannRedeemer.Value = result.(SpendChannelRedeemerChanOpenConfirm)
	}
	return spendChannRedeemer, nil

}
