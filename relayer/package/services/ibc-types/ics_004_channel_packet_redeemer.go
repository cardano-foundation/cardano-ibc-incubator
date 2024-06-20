package ibc_types

import (
	"encoding/hex"
	"reflect"

	"github.com/fxamacker/cbor/v2"
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
	ChanOpenAck       SpendChannelRedeemerType = 121
	ChanOpenConfirm   SpendChannelRedeemerType = 122
	RecvPacket        SpendChannelRedeemerType = 123
	TimeoutPacket     SpendChannelRedeemerType = 124
	AcknowledgePacket SpendChannelRedeemerType = 125
	SendPacket        SpendChannelRedeemerType = 126
	ChanCloseInit     SpendChannelRedeemerType = 127
	ChanCloseConfirm  SpendChannelRedeemerType = 128
	RefreshUtxo       SpendChannelRedeemerType = 129
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

type SpendChannelRedeemerChanCloseInit []byte
type SpendChannelRedeemerChanCloseConfirm struct {
	_           struct{} `cbor:",toarray"`
	ProofInit   MerkleProofSchema
	ProofHeight HeightSchema
}
type SpendChannelRedeemerRefreshUtxo []byte

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
	err = tags.Add(
		cbor.TagOptions{EncTag: cbor.EncTagRequired, DecTag: cbor.DecTagRequired},
		reflect.TypeOf(SpendChannelRedeemerRecvPacket{}), // your custom type
		123, // CBOR tag number for your custom type
	)
	err = tags.Add(
		cbor.TagOptions{EncTag: cbor.EncTagRequired, DecTag: cbor.DecTagRequired},
		reflect.TypeOf(SpendChannelRedeemerTimeoutPacket{}), // your custom type
		124, // CBOR tag number for your custom type
	)
	err = tags.Add(
		cbor.TagOptions{EncTag: cbor.EncTagRequired, DecTag: cbor.DecTagRequired},
		reflect.TypeOf(SpendChannelRedeemerAcknowledgePacket{}), // your custom type
		125, // CBOR tag number for your custom type
	)
	err = tags.Add(
		cbor.TagOptions{EncTag: cbor.EncTagRequired, DecTag: cbor.DecTagRequired},
		reflect.TypeOf(SpendChannelRedeemerSendPacket{}), // your custom type
		126, // CBOR tag number for your custom type
	)
	err = tags.Add(
		cbor.TagOptions{EncTag: cbor.EncTagRequired, DecTag: cbor.DecTagRequired},
		reflect.TypeOf(SpendChannelRedeemerChanCloseInit{}), // your custom type
		127, // CBOR tag number for your custom type
	)
	err = tags.Add(
		cbor.TagOptions{EncTag: cbor.EncTagRequired, DecTag: cbor.DecTagRequired},
		reflect.TypeOf(SpendChannelRedeemerChanCloseConfirm{}), // your custom type
		128, // CBOR tag number for your custom type
	)
	err = tags.Add(
		cbor.TagOptions{EncTag: cbor.EncTagRequired, DecTag: cbor.DecTagRequired},
		reflect.TypeOf(SpendChannelRedeemerRefreshUtxo{}), // your custom type
		129, // CBOR tag number for your custom type
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
	case SpendChannelRedeemerRecvPacket:
		spendChannRedeemer.Type = RecvPacket
		spendChannRedeemer.Value = result.(SpendChannelRedeemerRecvPacket)
	case SpendChannelRedeemerTimeoutPacket:
		spendChannRedeemer.Type = TimeoutPacket
		spendChannRedeemer.Value = result.(SpendChannelRedeemerTimeoutPacket)
	case SpendChannelRedeemerAcknowledgePacket:
		spendChannRedeemer.Type = AcknowledgePacket
		spendChannRedeemer.Value = result.(SpendChannelRedeemerAcknowledgePacket)
	case SpendChannelRedeemerSendPacket:
		spendChannRedeemer.Type = SendPacket
		spendChannRedeemer.Value = result.(SpendChannelRedeemerSendPacket)
	case SpendChannelRedeemerChanCloseInit:
		spendChannRedeemer.Type = ChanCloseInit
		spendChannRedeemer.Value = result.(SpendChannelRedeemerChanCloseInit)
	case SpendChannelRedeemerChanCloseConfirm:
		spendChannRedeemer.Type = ChanCloseConfirm
		spendChannRedeemer.Value = result.(SpendChannelRedeemerChanCloseConfirm)
	case SpendChannelRedeemerRefreshUtxo:
		spendChannRedeemer.Type = RefreshUtxo
		spendChannRedeemer.Value = result.(SpendChannelRedeemerRefreshUtxo)
	}
	return spendChannRedeemer, nil
}
