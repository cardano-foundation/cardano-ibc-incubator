package ibc_types

import (
	"encoding/hex"
	tendermint "github.com/cardano/proto-types/go/github.com/cosmos/ibc-go/v7/modules/light-clients/07-tendermint"
	"github.com/cometbft/cometbft/proto/tendermint/crypto"
	cometproto "github.com/cometbft/cometbft/proto/tendermint/types"
	version "github.com/cometbft/cometbft/proto/tendermint/version"
	clienttypes "github.com/cosmos/ibc-go/v7/modules/core/02-client/types"
	"github.com/fxamacker/cbor/v2"
	"reflect"
	"time"
)

type HeightSchema struct {
	_              struct{} `cbor:",toarray"`
	RevisionNumber uint64
	RevisionHeight uint64
}

type SpendClientRedeemerSchema struct {
	_     struct{} `cbor:",toarray"`
	Value interface{}
	Type  string
}

type ClientMessageSchema struct {
	_     struct{} `cbor:",toarray"`
	Value interface{}
	Type  string
}

type UpdateClientSchema struct {
	_   struct{} `cbor:",toarray"`
	Msg ClientMessageSchema
}
type ConsensusSchema struct {
	_     struct{} `cbor:",toarray"`
	Block uint64
	App   uint64
}
type PartSetHeaderSchema struct {
	_     struct{} `cbor:",toarray"`
	Total uint32
	Hash  []byte
}
type BlockIDSchema struct {
	_             struct{} `cbor:",toarray"`
	Hash          []byte
	PartSetHeader PartSetHeaderSchema
}
type TmHeaderSchema struct {
	_                  struct{} `cbor:",toarray"`
	Version            ConsensusSchema
	ChainID            []byte
	Height             uint64
	Time               uint64
	LastBlockID        BlockIDSchema
	LastCommitHash     []byte
	DataHash           []byte
	ValidatorsHash     []byte
	NextValidatorsHash []byte
	ConsensusHash      []byte
	AppHash            []byte
	LastResultsHash    []byte
	EvidenceHash       []byte
	ProposerAddress    []byte
}
type CommitSigSchema struct {
	_                struct{} `cbor:",toarray"`
	BlockIdFlag      int32
	ValidatorAddress []byte
	Timestamp        uint64
	Signature        []byte
}
type CommitSchema struct {
	_          struct{} `cbor:",toarray"`
	Height     int64
	Round      int32
	BlockId    BlockIDSchema
	Signatures []CommitSigSchema
}
type SignedHeaderSchema struct {
	_      struct{} `cbor:",toarray"`
	Header TmHeaderSchema
	Commit CommitSchema
}
type ValidatorSchema struct {
	_                struct{} `cbor:",toarray"`
	Address          []byte
	Pubkey           []byte
	VotingPower      int64
	ProposerPriority int64
}
type ValidatorSetSchema struct {
	_                struct{} `cbor:",toarray"`
	Validators       []ValidatorSchema
	Proposer         ValidatorSchema
	TotalVotingPower int64
}

type HeaderSchema struct {
	_                 struct{} `cbor:",toarray"`
	SignedHeader      SignedHeaderSchema
	ValidatorSet      ValidatorSetSchema
	TrustedHeight     HeightSchema
	TrustedValidators ValidatorSetSchema
}

type MisbehaviourSchema struct {
	_        struct{} `cbor:",toarray"`
	ClientId []byte
	Header1  HeaderSchema
	Header2  HeaderSchema
}

type OtherSpendClientRedeemer []byte

func (c *ClientMessageSchema) UnmarshalCBOR(data []byte) error {
	tags := cbor.NewTagSet()
	err := tags.Add(
		cbor.TagOptions{EncTag: cbor.EncTagRequired, DecTag: cbor.DecTagRequired},
		reflect.TypeOf(HeaderSchema{}), // your custom type
		121,                            // CBOR tag number for your custom type
	)
	err = tags.Add(
		cbor.TagOptions{EncTag: cbor.EncTagRequired, DecTag: cbor.DecTagRequired},
		reflect.TypeOf(MisbehaviourSchema{}), // your custom type
		122,                                  // CBOR tag number for your custom type
	)
	// Create decoding mode with TagSet
	dm, err := cbor.DecOptions{}.DecModeWithTags(tags)
	var result []interface{}
	err = dm.Unmarshal(data, &result)

	if err != nil {
		return err
	}
	switch result[0].(type) {
	case HeaderSchema:
		c.Value = result[0].(HeaderSchema)
		c.Type = "HeaderCase"
	case MisbehaviourSchema:
		c.Value = result[0].(MisbehaviourSchema)
		c.Type = "MisbehaviourCase"
	}

	return nil
}

func ConvertHeaderSchemaToHeaderTendermint(headerMsg HeaderSchema) tendermint.Header {
	seconds := int64(headerMsg.SignedHeader.Header.Time) / int64(time.Second)
	nanos := int64(headerMsg.SignedHeader.Header.Time) % int64(time.Second)
	signedHeaderTime := time.Unix(seconds, nanos)

	var commitSignatures []cometproto.CommitSig
	for _, signature := range headerMsg.SignedHeader.Commit.Signatures {
		seconds := int64(headerMsg.SignedHeader.Header.Time) / int64(time.Second)
		nanos := int64(headerMsg.SignedHeader.Header.Time) % int64(time.Second)
		signatureTime := time.Unix(seconds, nanos)
		commitSignatures = append(commitSignatures, cometproto.CommitSig{
			BlockIdFlag:      cometproto.BlockIDFlag(signature.BlockIdFlag), // todo
			ValidatorAddress: signature.ValidatorAddress,
			Timestamp:        signatureTime,
			Signature:        signature.Signature,
		})
	}

	var validatorSetVals []*cometproto.Validator
	for _, validator := range headerMsg.ValidatorSet.Validators {
		validatorSetVals = append(validatorSetVals, &cometproto.Validator{
			Address: validator.Address,
			PubKey: crypto.PublicKey{
				Sum: &crypto.PublicKey_Ed25519{
					Ed25519: headerMsg.ValidatorSet.Proposer.Pubkey,
				},
			},
			VotingPower:      validator.VotingPower,
			ProposerPriority: validator.ProposerPriority,
		})
	}

	var trustedValidators []*cometproto.Validator
	for _, validator := range headerMsg.TrustedValidators.Validators {
		trustedValidators = append(trustedValidators, &cometproto.Validator{
			Address: validator.Address,
			PubKey: crypto.PublicKey{
				Sum: &crypto.PublicKey_Ed25519{
					Ed25519: headerMsg.ValidatorSet.Proposer.Pubkey,
				},
			},
			VotingPower:      validator.VotingPower,
			ProposerPriority: validator.ProposerPriority,
		})
	}

	return tendermint.Header{
		SignedHeader: &cometproto.SignedHeader{
			Header: &cometproto.Header{
				Version: version.Consensus{
					Block: headerMsg.SignedHeader.Header.Version.Block,
					App:   headerMsg.SignedHeader.Header.Version.App,
				},
				ChainID: string(headerMsg.SignedHeader.Header.ChainID),
				Height:  int64(headerMsg.SignedHeader.Header.Height),
				Time:    signedHeaderTime,
				LastBlockId: cometproto.BlockID{
					Hash: headerMsg.SignedHeader.Header.LastBlockID.Hash,
					PartSetHeader: cometproto.PartSetHeader{
						Total: headerMsg.SignedHeader.Header.LastBlockID.PartSetHeader.Total,
						Hash:  headerMsg.SignedHeader.Header.LastBlockID.PartSetHeader.Hash,
					},
				},
				LastCommitHash:     headerMsg.SignedHeader.Header.LastCommitHash,
				DataHash:           headerMsg.SignedHeader.Header.DataHash,
				ValidatorsHash:     headerMsg.SignedHeader.Header.ValidatorsHash,
				NextValidatorsHash: headerMsg.SignedHeader.Header.NextValidatorsHash,
				ConsensusHash:      headerMsg.SignedHeader.Header.ConsensusHash,
				AppHash:            headerMsg.SignedHeader.Header.AppHash,
				LastResultsHash:    headerMsg.SignedHeader.Header.LastResultsHash,
				EvidenceHash:       headerMsg.SignedHeader.Header.EvidenceHash,
				ProposerAddress:    headerMsg.SignedHeader.Header.ProposerAddress,
			},
			Commit: &cometproto.Commit{
				Height: headerMsg.SignedHeader.Commit.Height,
				Round:  headerMsg.SignedHeader.Commit.Round,
				BlockID: cometproto.BlockID{
					Hash: headerMsg.SignedHeader.Commit.BlockId.Hash,
					PartSetHeader: cometproto.PartSetHeader{
						Total: headerMsg.SignedHeader.Commit.BlockId.PartSetHeader.Total,
						Hash:  headerMsg.SignedHeader.Commit.BlockId.PartSetHeader.Hash,
					},
				},
				Signatures: commitSignatures,
			},
		},
		ValidatorSet: &cometproto.ValidatorSet{
			Validators: validatorSetVals,
			Proposer: &cometproto.Validator{
				Address: headerMsg.ValidatorSet.Proposer.Address,
				PubKey: crypto.PublicKey{
					Sum: &crypto.PublicKey_Ed25519{
						Ed25519: headerMsg.ValidatorSet.Proposer.Pubkey,
					},
				},
				VotingPower:      headerMsg.ValidatorSet.Proposer.VotingPower,
				ProposerPriority: headerMsg.ValidatorSet.Proposer.ProposerPriority,
			},
			TotalVotingPower: headerMsg.ValidatorSet.TotalVotingPower,
		},
		TrustedHeight: &clienttypes.Height{
			RevisionNumber: headerMsg.TrustedHeight.RevisionNumber,
			RevisionHeight: headerMsg.TrustedHeight.RevisionHeight,
		},
		TrustedValidators: &cometproto.ValidatorSet{
			Validators: trustedValidators,
			Proposer: &cometproto.Validator{
				Address: headerMsg.TrustedValidators.Proposer.Address,
				PubKey: crypto.PublicKey{
					Sum: &crypto.PublicKey_Ed25519{
						Ed25519: headerMsg.TrustedValidators.Proposer.Pubkey,
					},
				},
				VotingPower:      headerMsg.TrustedValidators.Proposer.VotingPower,
				ProposerPriority: headerMsg.TrustedValidators.Proposer.ProposerPriority,
			},
			TotalVotingPower: headerMsg.TrustedValidators.TotalVotingPower,
		},
	}
}

func DecodeSpendClientRedeemerSchema(spendClientRdEncoded string) (SpendClientRedeemerSchema, error) {
	dataBytes, err := hex.DecodeString(spendClientRdEncoded)
	if err != nil {
		return SpendClientRedeemerSchema{}, err
	}
	tags := cbor.NewTagSet()
	err = tags.Add(
		cbor.TagOptions{EncTag: cbor.EncTagRequired, DecTag: cbor.DecTagRequired},
		reflect.TypeOf(UpdateClientSchema{}), // your custom type
		121,                                  // CBOR tag number for your custom type
	)
	err = tags.Add(
		cbor.TagOptions{EncTag: cbor.EncTagRequired, DecTag: cbor.DecTagRequired},
		reflect.TypeOf(OtherSpendClientRedeemer{}), // your custom type
		122, // CBOR tag number for your custom type
	)
	// Create decoding mode with TagSet
	dm, err := cbor.DecOptions{}.DecModeWithTags(tags)
	var result interface{}
	err = dm.Unmarshal(dataBytes, &result)

	if err != nil {
		return SpendClientRedeemerSchema{}, err
	}
	var spendClientRedeemer SpendClientRedeemerSchema
	switch result.(type) {
	case UpdateClientSchema:
		spendClientRedeemer.Type = "UpdateClient"
		spendClientRedeemer.Value = result.(UpdateClientSchema)
	case OtherSpendClientRedeemer:
		spendClientRedeemer.Type = "Other"
		spendClientRedeemer.Value = result.(OtherSpendClientRedeemer)
	}
	return spendClientRedeemer, nil
}
