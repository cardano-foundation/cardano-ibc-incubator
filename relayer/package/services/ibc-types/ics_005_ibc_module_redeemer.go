package ibc_types

import (
	"encoding/hex"
	"reflect"

	"github.com/fxamacker/cbor/v2"
)

type IBCModuleRedeemerSchemaType int

const (
	IBCModuleCallback IBCModuleRedeemerSchemaType = 121
	IBCModuleOperator IBCModuleRedeemerSchemaType = 122
)

type IBCModuleCallbackSchemaType int

const (
	OnChanOpenInit          IBCModuleCallbackSchemaType = 121
	OnChanOpenTry           IBCModuleCallbackSchemaType = 122
	OnChanOpenAck           IBCModuleCallbackSchemaType = 123
	OnChanOpenConfirm       IBCModuleCallbackSchemaType = 124
	OnChanCloseInit         IBCModuleCallbackSchemaType = 125
	OnChanCloseConfirm      IBCModuleCallbackSchemaType = 126
	OnRecvPacket            IBCModuleCallbackSchemaType = 127
	OnTimeoutPacket         IBCModuleCallbackSchemaType = 128
	OnAcknowledgementPacket IBCModuleCallbackSchemaType = 129
)

type IBCModuleRedeemerSchema struct {
	_     struct{} `cbor:",toarray"`
	Type  IBCModuleRedeemerSchemaType
	Value interface{}
}

type IBCModuleCallbackSchema struct {
	_     struct{} `cbor:",toarray"`
	Type  IBCModuleCallbackSchemaType
	Value interface{}
}

func (c *IBCModuleCallbackSchema) UnmarshalCBOR(data []byte) error {
	var r interface{}
	cbor.Unmarshal(data, &r)

	tags := cbor.NewTagSet()
	err := tags.Add(
		cbor.TagOptions{EncTag: cbor.EncTagRequired, DecTag: cbor.DecTagRequired},
		reflect.TypeOf(OnChanOpenInitSchema{}), // your custom type
		121,                                    // CBOR tag number for your custom type
	)
	err = tags.Add(
		cbor.TagOptions{EncTag: cbor.EncTagRequired, DecTag: cbor.DecTagRequired},
		reflect.TypeOf(OnChanOpenTrySchema{}), // your custom type
		122,                                   // CBOR tag number for your custom type
	)
	err = tags.Add(
		cbor.TagOptions{EncTag: cbor.EncTagRequired, DecTag: cbor.DecTagRequired},
		reflect.TypeOf(OnChanOpenAckSchema{}), // your custom type
		123,                                   // CBOR tag number for your custom type
	)
	err = tags.Add(
		cbor.TagOptions{EncTag: cbor.EncTagRequired, DecTag: cbor.DecTagRequired},
		reflect.TypeOf(OnChanOpenConfirmSchema{}), // your custom type
		124, // CBOR tag number for your custom type
	)
	err = tags.Add(
		cbor.TagOptions{EncTag: cbor.EncTagRequired, DecTag: cbor.DecTagRequired},
		reflect.TypeOf(OnChanCloseInitSchema{}), // your custom type
		125,                                     // CBOR tag number for your custom type
	)
	err = tags.Add(
		cbor.TagOptions{EncTag: cbor.EncTagRequired, DecTag: cbor.DecTagRequired},
		reflect.TypeOf(OnChanCloseConfirmSchema{}), // your custom type
		126, // CBOR tag number for your custom type
	)
	err = tags.Add(
		cbor.TagOptions{EncTag: cbor.EncTagRequired, DecTag: cbor.DecTagRequired},
		reflect.TypeOf(OnRecvPacketSchema{}), // your custom type
		127,                                  // CBOR tag number for your custom type
	)
	err = tags.Add(
		cbor.TagOptions{EncTag: cbor.EncTagRequired, DecTag: cbor.DecTagRequired},
		reflect.TypeOf(OnTimeoutPacketSchema{}), // your custom type
		128,                                     // CBOR tag number for your custom type
	)
	err = tags.Add(
		cbor.TagOptions{EncTag: cbor.EncTagRequired, DecTag: cbor.DecTagRequired},
		reflect.TypeOf(OnAcknowledgementPacketSchema{}), // your custom type
		129, // CBOR tag number for your custom type
	)
	// Create decoding mode with TagSet
	dm, err := cbor.DecOptions{}.DecModeWithTags(tags)
	var result []interface{}
	err = dm.Unmarshal(data, &result)

	if err != nil {
		return err
	}
	switch result[0].(type) {
	case OnChanOpenInitSchema:
		c.Value = result[0].(OnChanOpenInitSchema)
		c.Type = OnChanOpenInit
	case OnChanOpenTrySchema:
		c.Value = result[0].(OnChanOpenTrySchema)
		c.Type = OnChanOpenTry
	case OnChanOpenAckSchema:
		c.Value = result[0].(OnChanOpenAckSchema)
		c.Type = OnChanOpenAck
	case OnChanOpenConfirmSchema:
		c.Value = result[0].(OnChanOpenConfirmSchema)
		c.Type = OnChanOpenConfirm
	case OnChanCloseInitSchema:
		c.Value = result[0].(OnChanCloseInitSchema)
		c.Type = OnChanCloseInit
	case OnChanCloseConfirmSchema:
		c.Value = result[0].(OnChanCloseConfirmSchema)
		c.Type = OnChanCloseConfirm
	case OnRecvPacketSchema:
		c.Value = result[0].(OnRecvPacketSchema)
		c.Type = OnRecvPacket
	case OnTimeoutPacketSchema:
		c.Value = result[0].(OnTimeoutPacketSchema)
		c.Type = OnTimeoutPacket
	case OnAcknowledgementPacketSchema:
		c.Value = result[0].(OnAcknowledgementPacketSchema)
		c.Type = OnAcknowledgementPacket
	}

	return nil
}

type OnChanOpenInitSchema struct {
	_         struct{} `cbor:",toarray"`
	ChannelId []byte
}

type OnChanOpenTrySchema struct {
	_         struct{} `cbor:",toarray"`
	ChannelId []byte
}

type OnChanOpenAckSchema struct {
	_         struct{} `cbor:",toarray"`
	ChannelId []byte
}

type OnChanOpenConfirmSchema struct {
	_         struct{} `cbor:",toarray"`
	ChannelId []byte
}

type OnChanCloseInitSchema struct {
	_         struct{} `cbor:",toarray"`
	ChannelId []byte
}

type OnChanCloseConfirmSchema struct {
	_         struct{} `cbor:",toarray"`
	ChannelId []byte
}

type OnRecvPacketSchema struct {
	_               struct{} `cbor:",toarray"`
	ChannelId       []byte
	Acknowledgement AcknowledgementSchema
	Data            IBCModulePacketDataSchema
}
type OnTimeoutPacketSchema struct {
	_         struct{} `cbor:",toarray"`
	ChannelId []byte
	Data      IBCModulePacketDataSchema
}
type OnAcknowledgementPacketSchema struct {
	_               struct{} `cbor:",toarray"`
	ChannelId       []byte
	Acknowledgement AcknowledgementSchema
	Data            IBCModulePacketDataSchema
}

type AcknowledgementResponseSchemaType int

const (
	AcknowledgementResult AcknowledgementResponseSchemaType = 121
	AcknowledgementError  AcknowledgementResponseSchemaType = 122
)

type AcknowledgementResultSchema struct {
	_      struct{} `cbor:",toarray"`
	Result []byte
}

type AcknowledgementErrorSchema struct {
	_   struct{} `cbor:",toarray"`
	Err []byte
}

type AcknowledgementResponseSchema struct {
	_     struct{} `cbor:",toarray"`
	Type  AcknowledgementResponseSchemaType
	Value interface{}
}

func (c *AcknowledgementResponseSchema) UnmarshalCBOR(data []byte) error {
	tags := cbor.NewTagSet()
	err := tags.Add(
		cbor.TagOptions{EncTag: cbor.EncTagRequired, DecTag: cbor.DecTagRequired},
		reflect.TypeOf(AcknowledgementResultSchema{}), // your custom type
		121, // CBOR tag number for your custom type
	)
	err = tags.Add(
		cbor.TagOptions{EncTag: cbor.EncTagRequired, DecTag: cbor.DecTagRequired},
		reflect.TypeOf(AcknowledgementErrorSchema{}), // your custom type
		122, // CBOR tag number for your custom type
	)
	// Create decoding mode with TagSet
	dm, err := cbor.DecOptions{}.DecModeWithTags(tags)
	var result interface{}
	err = dm.Unmarshal(data, &result)

	if err != nil {
		return err
	}
	switch result.(type) {
	case AcknowledgementResultSchema:
		c.Value = result.(AcknowledgementResultSchema)
		c.Type = AcknowledgementResult
	case AcknowledgementErrorSchema:
		c.Value = result.(AcknowledgementErrorSchema)
		c.Type = AcknowledgementError
	}

	return nil

}

type AcknowledgementSchema struct {
	_        struct{} `cbor:",toarray"`
	Response AcknowledgementResponseSchema
}

type IBCModulePacketDataSchemaType int

const (
	TransferModuleData IBCModulePacketDataSchemaType = 121
	OtherModuleData    IBCModulePacketDataSchemaType = 122
)

type FungibleTokenPacketDataSchema struct {
	_        struct{} `cbor:",toarray"`
	Denom    []byte
	Amount   []byte
	Sender   []byte
	Receiver []byte
	Memo     []byte
}

type OtherModuleDataSchema []byte
type IBCModulePacketDataSchema struct {
	_     struct{} `cbor:",toarray"`
	Type  IBCModulePacketDataSchemaType
	Value interface{}
}

func (c *IBCModulePacketDataSchema) UnmarshalCBOR(data []byte) error {
	tags := cbor.NewTagSet()
	err := tags.Add(
		cbor.TagOptions{EncTag: cbor.EncTagRequired, DecTag: cbor.DecTagRequired},
		reflect.TypeOf(FungibleTokenPacketDataSchema{}), // your custom type
		121, // CBOR tag number for your custom type
	)
	err = tags.Add(
		cbor.TagOptions{EncTag: cbor.EncTagRequired, DecTag: cbor.DecTagRequired},
		reflect.TypeOf(OtherModuleDataSchema{}), // your custom type
		122,                                     // CBOR tag number for your custom type
	)
	// Create decoding mode with TagSet
	dm, err := cbor.DecOptions{}.DecModeWithTags(tags)
	var result []interface{}
	err = dm.Unmarshal(data, &result)

	if err != nil {
		return err
	}
	switch result[0].(type) {
	case FungibleTokenPacketDataSchema:
		c.Value = result[0].(FungibleTokenPacketDataSchema)
		c.Type = TransferModuleData
	case OtherModuleDataSchema:
		c.Value = result[0].(OtherModuleDataSchema)
		c.Type = OtherModuleData
	}

	return nil
}

type IBCModuleOperatorSchemaType int

const (
	TransferModuleOperator IBCModuleOperatorSchemaType = 121
	OtherModuleOperator    IBCModuleOperatorSchemaType = 122
)

type TransferModuleRedeemerSchemaType int

const (
	TransferModuleRedeemerTransfer              TransferModuleRedeemerSchemaType = 121
	TransferModuleRedeemerSchemaOtherTransferOp TransferModuleRedeemerSchemaType = 122
)

type TransferModuleRedeemerTransferSchema struct {
	_         struct{} `cbor:",toarray"`
	ChannelId []byte
	Data      FungibleTokenPacketDataSchema
}
type TransferModuleRedeemerSchemaOtherTransferOpSchema []byte
type TransferModuleRedeemerSchema struct {
	_     struct{} `cbor:",toarray"`
	Type  TransferModuleRedeemerSchemaType
	Value interface{}
}
type OtherModuleOperatorSchema []byte

type IBCModuleOperatorSchema struct {
	_     struct{} `cbor:",toarray"`
	Type  IBCModuleOperatorSchemaType
	Value interface{}
}

func DecodeIBCModuleRedeemerSchema(ibcModuleRedeemerEncoded string) (*IBCModuleRedeemerSchema, error) {
	datumBytes, err := hex.DecodeString(ibcModuleRedeemerEncoded)
	if err != nil {
		return nil, err
	}

	tags := cbor.NewTagSet()
	err = tags.Add(
		cbor.TagOptions{EncTag: cbor.EncTagRequired, DecTag: cbor.DecTagRequired},
		reflect.TypeOf(IBCModuleCallbackSchema{}), // your custom type
		121, // CBOR tag number for your custom type
	)
	err = tags.Add(
		cbor.TagOptions{EncTag: cbor.EncTagRequired, DecTag: cbor.DecTagRequired},
		reflect.TypeOf(IBCModuleOperatorSchema{}), // your custom type
		122, // CBOR tag number for your custom type
	)

	// var r interface{}
	// cbor.Unmarshal(datumBytes, &r)

	// Create decoding mode with TagSet
	dm, err := cbor.DecOptions{}.DecModeWithTags(tags)

	var result interface{}
	err = dm.Unmarshal(datumBytes, &result)
	if err != nil {
		return &IBCModuleRedeemerSchema{}, err
	}
	var schema IBCModuleRedeemerSchema
	switch result.(type) {
	case IBCModuleCallbackSchema:
		schema.Type = IBCModuleCallback
		schema.Value = result.(IBCModuleCallbackSchema)
	case IBCModuleOperatorSchema:
		schema.Type = IBCModuleOperator
		schema.Value = result.(IBCModuleOperatorSchema)
	}
	return &schema, nil
}
