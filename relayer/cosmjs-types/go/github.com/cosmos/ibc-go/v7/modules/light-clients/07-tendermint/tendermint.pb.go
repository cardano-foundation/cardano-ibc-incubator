// Code generated by protoc-gen-go. DO NOT EDIT.
// versions:
// 	protoc-gen-go v1.25.0-devel
// 	protoc        (unknown)
// source: ibc/lightclients/tendermint/v1/tendermint.proto

package tendermint

import (
	types2 "github.com/cometbft/cometbft/proto/tendermint/types"
	_ "github.com/cosmos/gogoproto/gogoproto"
	types "github.com/cosmos/ibc-go/v7/modules/core/02-client/types"
	types1 "github.com/cosmos/ibc-go/v7/modules/core/23-commitment/types"
	_go "github.com/cosmos/ics23/go"
	protoreflect "google.golang.org/protobuf/reflect/protoreflect"
	protoimpl "google.golang.org/protobuf/runtime/protoimpl"
	durationpb "google.golang.org/protobuf/types/known/durationpb"
	timestamppb "google.golang.org/protobuf/types/known/timestamppb"
	reflect "reflect"
	sync "sync"
)

const (
	// Verify that this generated code is sufficiently up-to-date.
	_ = protoimpl.EnforceVersion(20 - protoimpl.MinVersion)
	// Verify that runtime/protoimpl is sufficiently up-to-date.
	_ = protoimpl.EnforceVersion(protoimpl.MaxVersion - 20)
)

// ClientState from Tendermint tracks the current validator set, latest height,
// and a possible frozen height.
type ClientState struct {
	state         protoimpl.MessageState
	sizeCache     protoimpl.SizeCache
	unknownFields protoimpl.UnknownFields

	ChainId    string    `protobuf:"bytes,1,opt,name=chain_id,json=chainId,proto3" json:"chain_id,omitempty"`
	TrustLevel *Fraction `protobuf:"bytes,2,opt,name=trust_level,json=trustLevel,proto3" json:"trust_level,omitempty"`
	// duration of the period since the LastestTimestamp during which the
	// submitted headers are valid for upgrade
	TrustingPeriod *durationpb.Duration `protobuf:"bytes,3,opt,name=trusting_period,json=trustingPeriod,proto3" json:"trusting_period,omitempty"`
	// duration of the staking unbonding period
	UnbondingPeriod *durationpb.Duration `protobuf:"bytes,4,opt,name=unbonding_period,json=unbondingPeriod,proto3" json:"unbonding_period,omitempty"`
	// defines how much new (untrusted) header's Time can drift into the future.
	MaxClockDrift *durationpb.Duration `protobuf:"bytes,5,opt,name=max_clock_drift,json=maxClockDrift,proto3" json:"max_clock_drift,omitempty"`
	// Block height when the client was frozen due to a misbehaviour
	FrozenHeight *types.Height `protobuf:"bytes,6,opt,name=frozen_height,json=frozenHeight,proto3" json:"frozen_height,omitempty"`
	// Latest height the client was updated to
	LatestHeight *types.Height `protobuf:"bytes,7,opt,name=latest_height,json=latestHeight,proto3" json:"latest_height,omitempty"`
	// Proof specifications used in verifying counterparty state
	ProofSpecs []*_go.ProofSpec `protobuf:"bytes,8,rep,name=proof_specs,json=proofSpecs,proto3" json:"proof_specs,omitempty"`
	// Path at which next upgraded client will be committed.
	// Each element corresponds to the key for a single CommitmentProof in the
	// chained proof. NOTE: ClientState must stored under
	// `{upgradePath}/{upgradeHeight}/clientState` ConsensusState must be stored
	// under `{upgradepath}/{upgradeHeight}/consensusState` For SDK chains using
	// the default upgrade module, upgrade_path should be []string{"upgrade",
	// "upgradedIBCState"}`
	UpgradePath []string `protobuf:"bytes,9,rep,name=upgrade_path,json=upgradePath,proto3" json:"upgrade_path,omitempty"`
	// allow_update_after_expiry is deprecated
	//
	// Deprecated: Do not use.
	AllowUpdateAfterExpiry bool `protobuf:"varint,10,opt,name=allow_update_after_expiry,json=allowUpdateAfterExpiry,proto3" json:"allow_update_after_expiry,omitempty"`
	// allow_update_after_misbehaviour is deprecated
	//
	// Deprecated: Do not use.
	AllowUpdateAfterMisbehaviour bool `protobuf:"varint,11,opt,name=allow_update_after_misbehaviour,json=allowUpdateAfterMisbehaviour,proto3" json:"allow_update_after_misbehaviour,omitempty"`
}

func (x *ClientState) Reset() {
	*x = ClientState{}
	if protoimpl.UnsafeEnabled {
		mi := &file_ibc_lightclients_tendermint_v1_tendermint_proto_msgTypes[0]
		ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
		ms.StoreMessageInfo(mi)
	}
}

func (x *ClientState) String() string {
	return protoimpl.X.MessageStringOf(x)
}

func (*ClientState) ProtoMessage() {}

func (x *ClientState) ProtoReflect() protoreflect.Message {
	mi := &file_ibc_lightclients_tendermint_v1_tendermint_proto_msgTypes[0]
	if protoimpl.UnsafeEnabled && x != nil {
		ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
		if ms.LoadMessageInfo() == nil {
			ms.StoreMessageInfo(mi)
		}
		return ms
	}
	return mi.MessageOf(x)
}

// Deprecated: Use ClientState.ProtoReflect.Descriptor instead.
func (*ClientState) Descriptor() ([]byte, []int) {
	return file_ibc_lightclients_tendermint_v1_tendermint_proto_rawDescGZIP(), []int{0}
}

func (x *ClientState) GetChainId() string {
	if x != nil {
		return x.ChainId
	}
	return ""
}

func (x *ClientState) GetTrustLevel() *Fraction {
	if x != nil {
		return x.TrustLevel
	}
	return nil
}

func (x *ClientState) GetTrustingPeriod() *durationpb.Duration {
	if x != nil {
		return x.TrustingPeriod
	}
	return nil
}

func (x *ClientState) GetUnbondingPeriod() *durationpb.Duration {
	if x != nil {
		return x.UnbondingPeriod
	}
	return nil
}

func (x *ClientState) GetMaxClockDrift() *durationpb.Duration {
	if x != nil {
		return x.MaxClockDrift
	}
	return nil
}

func (x *ClientState) GetFrozenHeight() *types.Height {
	if x != nil {
		return x.FrozenHeight
	}
	return nil
}

func (x *ClientState) GetLatestHeight() *types.Height {
	if x != nil {
		return x.LatestHeight
	}
	return nil
}

func (x *ClientState) GetProofSpecs() []*_go.ProofSpec {
	if x != nil {
		return x.ProofSpecs
	}
	return nil
}

func (x *ClientState) GetUpgradePath() []string {
	if x != nil {
		return x.UpgradePath
	}
	return nil
}

// Deprecated: Do not use.
func (x *ClientState) GetAllowUpdateAfterExpiry() bool {
	if x != nil {
		return x.AllowUpdateAfterExpiry
	}
	return false
}

// Deprecated: Do not use.
func (x *ClientState) GetAllowUpdateAfterMisbehaviour() bool {
	if x != nil {
		return x.AllowUpdateAfterMisbehaviour
	}
	return false
}

// ConsensusState defines the consensus state from Tendermint.
type ConsensusState struct {
	state         protoimpl.MessageState
	sizeCache     protoimpl.SizeCache
	unknownFields protoimpl.UnknownFields

	// timestamp that corresponds to the block height in which the ConsensusState
	// was stored.
	Timestamp *timestamppb.Timestamp `protobuf:"bytes,1,opt,name=timestamp,proto3" json:"timestamp,omitempty"`
	// commitment root (i.e app hash)
	Root               *types1.MerkleRoot `protobuf:"bytes,2,opt,name=root,proto3" json:"root,omitempty"`
	NextValidatorsHash []byte             `protobuf:"bytes,3,opt,name=next_validators_hash,json=nextValidatorsHash,proto3" json:"next_validators_hash,omitempty"`
}

func (x *ConsensusState) Reset() {
	*x = ConsensusState{}
	if protoimpl.UnsafeEnabled {
		mi := &file_ibc_lightclients_tendermint_v1_tendermint_proto_msgTypes[1]
		ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
		ms.StoreMessageInfo(mi)
	}
}

func (x *ConsensusState) String() string {
	return protoimpl.X.MessageStringOf(x)
}

func (*ConsensusState) ProtoMessage() {}

func (x *ConsensusState) ProtoReflect() protoreflect.Message {
	mi := &file_ibc_lightclients_tendermint_v1_tendermint_proto_msgTypes[1]
	if protoimpl.UnsafeEnabled && x != nil {
		ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
		if ms.LoadMessageInfo() == nil {
			ms.StoreMessageInfo(mi)
		}
		return ms
	}
	return mi.MessageOf(x)
}

// Deprecated: Use ConsensusState.ProtoReflect.Descriptor instead.
func (*ConsensusState) Descriptor() ([]byte, []int) {
	return file_ibc_lightclients_tendermint_v1_tendermint_proto_rawDescGZIP(), []int{1}
}

func (x *ConsensusState) GetTimestamp() *timestamppb.Timestamp {
	if x != nil {
		return x.Timestamp
	}
	return nil
}

func (x *ConsensusState) GetRoot() *types1.MerkleRoot {
	if x != nil {
		return x.Root
	}
	return nil
}

func (x *ConsensusState) GetNextValidatorsHash() []byte {
	if x != nil {
		return x.NextValidatorsHash
	}
	return nil
}

// Misbehaviour is a wrapper over two conflicting Headers
// that implements Misbehaviour interface expected by ICS-02
type Misbehaviour struct {
	state         protoimpl.MessageState
	sizeCache     protoimpl.SizeCache
	unknownFields protoimpl.UnknownFields

	// ClientID is deprecated
	//
	// Deprecated: Do not use.
	ClientId string  `protobuf:"bytes,1,opt,name=client_id,json=clientId,proto3" json:"client_id,omitempty"`
	Header_1 *Header `protobuf:"bytes,2,opt,name=header_1,json=header1,proto3" json:"header_1,omitempty"`
	Header_2 *Header `protobuf:"bytes,3,opt,name=header_2,json=header2,proto3" json:"header_2,omitempty"`
}

func (x *Misbehaviour) Reset() {
	*x = Misbehaviour{}
	if protoimpl.UnsafeEnabled {
		mi := &file_ibc_lightclients_tendermint_v1_tendermint_proto_msgTypes[2]
		ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
		ms.StoreMessageInfo(mi)
	}
}

func (x *Misbehaviour) String() string {
	return protoimpl.X.MessageStringOf(x)
}

func (*Misbehaviour) ProtoMessage() {}

func (x *Misbehaviour) ProtoReflect() protoreflect.Message {
	mi := &file_ibc_lightclients_tendermint_v1_tendermint_proto_msgTypes[2]
	if protoimpl.UnsafeEnabled && x != nil {
		ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
		if ms.LoadMessageInfo() == nil {
			ms.StoreMessageInfo(mi)
		}
		return ms
	}
	return mi.MessageOf(x)
}

// Deprecated: Use Misbehaviour.ProtoReflect.Descriptor instead.
func (*Misbehaviour) Descriptor() ([]byte, []int) {
	return file_ibc_lightclients_tendermint_v1_tendermint_proto_rawDescGZIP(), []int{2}
}

// Deprecated: Do not use.
func (x *Misbehaviour) GetClientId() string {
	if x != nil {
		return x.ClientId
	}
	return ""
}

func (x *Misbehaviour) GetHeader_1() *Header {
	if x != nil {
		return x.Header_1
	}
	return nil
}

func (x *Misbehaviour) GetHeader_2() *Header {
	if x != nil {
		return x.Header_2
	}
	return nil
}

// Header defines the Tendermint client consensus Header.
// It encapsulates all the information necessary to update from a trusted
// Tendermint ConsensusState. The inclusion of TrustedHeight and
// TrustedValidators allows this update to process correctly, so long as the
// ConsensusState for the TrustedHeight exists, this removes race conditions
// among relayers The SignedHeader and ValidatorSet are the new untrusted update
// fields for the client. The TrustedHeight is the height of a stored
// ConsensusState on the client that will be used to verify the new untrusted
// header. The Trusted ConsensusState must be within the unbonding period of
// current time in order to correctly verify, and the TrustedValidators must
// hash to TrustedConsensusState.NextValidatorsHash since that is the last
// trusted validator set at the TrustedHeight.
type Header struct {
	state         protoimpl.MessageState
	sizeCache     protoimpl.SizeCache
	unknownFields protoimpl.UnknownFields

	SignedHeader      *types2.SignedHeader `protobuf:"bytes,1,opt,name=signed_header,json=signedHeader,proto3" json:"signed_header,omitempty"`
	ValidatorSet      *types2.ValidatorSet `protobuf:"bytes,2,opt,name=validator_set,json=validatorSet,proto3" json:"validator_set,omitempty"`
	TrustedHeight     *types.Height        `protobuf:"bytes,3,opt,name=trusted_height,json=trustedHeight,proto3" json:"trusted_height,omitempty"`
	TrustedValidators *types2.ValidatorSet `protobuf:"bytes,4,opt,name=trusted_validators,json=trustedValidators,proto3" json:"trusted_validators,omitempty"`
}

func (x *Header) Reset() {
	*x = Header{}
	if protoimpl.UnsafeEnabled {
		mi := &file_ibc_lightclients_tendermint_v1_tendermint_proto_msgTypes[3]
		ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
		ms.StoreMessageInfo(mi)
	}
}

func (x *Header) String() string {
	return protoimpl.X.MessageStringOf(x)
}

func (*Header) ProtoMessage() {}

func (x *Header) ProtoReflect() protoreflect.Message {
	mi := &file_ibc_lightclients_tendermint_v1_tendermint_proto_msgTypes[3]
	if protoimpl.UnsafeEnabled && x != nil {
		ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
		if ms.LoadMessageInfo() == nil {
			ms.StoreMessageInfo(mi)
		}
		return ms
	}
	return mi.MessageOf(x)
}

// Deprecated: Use Header.ProtoReflect.Descriptor instead.
func (*Header) Descriptor() ([]byte, []int) {
	return file_ibc_lightclients_tendermint_v1_tendermint_proto_rawDescGZIP(), []int{3}
}

func (x *Header) GetSignedHeader() *types2.SignedHeader {
	if x != nil {
		return x.SignedHeader
	}
	return nil
}

func (x *Header) GetValidatorSet() *types2.ValidatorSet {
	if x != nil {
		return x.ValidatorSet
	}
	return nil
}

func (x *Header) GetTrustedHeight() *types.Height {
	if x != nil {
		return x.TrustedHeight
	}
	return nil
}

func (x *Header) GetTrustedValidators() *types2.ValidatorSet {
	if x != nil {
		return x.TrustedValidators
	}
	return nil
}

// Fraction defines the protobuf message type for tmmath.Fraction that only
// supports positive values.
type Fraction struct {
	state         protoimpl.MessageState
	sizeCache     protoimpl.SizeCache
	unknownFields protoimpl.UnknownFields

	Numerator   uint64 `protobuf:"varint,1,opt,name=numerator,proto3" json:"numerator,omitempty"`
	Denominator uint64 `protobuf:"varint,2,opt,name=denominator,proto3" json:"denominator,omitempty"`
}

func (x *Fraction) Reset() {
	*x = Fraction{}
	if protoimpl.UnsafeEnabled {
		mi := &file_ibc_lightclients_tendermint_v1_tendermint_proto_msgTypes[4]
		ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
		ms.StoreMessageInfo(mi)
	}
}

func (x *Fraction) String() string {
	return protoimpl.X.MessageStringOf(x)
}

func (*Fraction) ProtoMessage() {}

func (x *Fraction) ProtoReflect() protoreflect.Message {
	mi := &file_ibc_lightclients_tendermint_v1_tendermint_proto_msgTypes[4]
	if protoimpl.UnsafeEnabled && x != nil {
		ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
		if ms.LoadMessageInfo() == nil {
			ms.StoreMessageInfo(mi)
		}
		return ms
	}
	return mi.MessageOf(x)
}

// Deprecated: Use Fraction.ProtoReflect.Descriptor instead.
func (*Fraction) Descriptor() ([]byte, []int) {
	return file_ibc_lightclients_tendermint_v1_tendermint_proto_rawDescGZIP(), []int{4}
}

func (x *Fraction) GetNumerator() uint64 {
	if x != nil {
		return x.Numerator
	}
	return 0
}

func (x *Fraction) GetDenominator() uint64 {
	if x != nil {
		return x.Denominator
	}
	return 0
}

var File_ibc_lightclients_tendermint_v1_tendermint_proto protoreflect.FileDescriptor

var file_ibc_lightclients_tendermint_v1_tendermint_proto_rawDesc = []byte{
	0x0a, 0x2f, 0x69, 0x62, 0x63, 0x2f, 0x6c, 0x69, 0x67, 0x68, 0x74, 0x63, 0x6c, 0x69, 0x65, 0x6e,
	0x74, 0x73, 0x2f, 0x74, 0x65, 0x6e, 0x64, 0x65, 0x72, 0x6d, 0x69, 0x6e, 0x74, 0x2f, 0x76, 0x31,
	0x2f, 0x74, 0x65, 0x6e, 0x64, 0x65, 0x72, 0x6d, 0x69, 0x6e, 0x74, 0x2e, 0x70, 0x72, 0x6f, 0x74,
	0x6f, 0x12, 0x1e, 0x69, 0x62, 0x63, 0x2e, 0x6c, 0x69, 0x67, 0x68, 0x74, 0x63, 0x6c, 0x69, 0x65,
	0x6e, 0x74, 0x73, 0x2e, 0x74, 0x65, 0x6e, 0x64, 0x65, 0x72, 0x6d, 0x69, 0x6e, 0x74, 0x2e, 0x76,
	0x31, 0x1a, 0x20, 0x74, 0x65, 0x6e, 0x64, 0x65, 0x72, 0x6d, 0x69, 0x6e, 0x74, 0x2f, 0x74, 0x79,
	0x70, 0x65, 0x73, 0x2f, 0x76, 0x61, 0x6c, 0x69, 0x64, 0x61, 0x74, 0x6f, 0x72, 0x2e, 0x70, 0x72,
	0x6f, 0x74, 0x6f, 0x1a, 0x1c, 0x74, 0x65, 0x6e, 0x64, 0x65, 0x72, 0x6d, 0x69, 0x6e, 0x74, 0x2f,
	0x74, 0x79, 0x70, 0x65, 0x73, 0x2f, 0x74, 0x79, 0x70, 0x65, 0x73, 0x2e, 0x70, 0x72, 0x6f, 0x74,
	0x6f, 0x1a, 0x1c, 0x63, 0x6f, 0x73, 0x6d, 0x6f, 0x73, 0x2f, 0x69, 0x63, 0x73, 0x32, 0x33, 0x2f,
	0x76, 0x31, 0x2f, 0x70, 0x72, 0x6f, 0x6f, 0x66, 0x73, 0x2e, 0x70, 0x72, 0x6f, 0x74, 0x6f, 0x1a,
	0x1e, 0x67, 0x6f, 0x6f, 0x67, 0x6c, 0x65, 0x2f, 0x70, 0x72, 0x6f, 0x74, 0x6f, 0x62, 0x75, 0x66,
	0x2f, 0x64, 0x75, 0x72, 0x61, 0x74, 0x69, 0x6f, 0x6e, 0x2e, 0x70, 0x72, 0x6f, 0x74, 0x6f, 0x1a,
	0x1f, 0x67, 0x6f, 0x6f, 0x67, 0x6c, 0x65, 0x2f, 0x70, 0x72, 0x6f, 0x74, 0x6f, 0x62, 0x75, 0x66,
	0x2f, 0x74, 0x69, 0x6d, 0x65, 0x73, 0x74, 0x61, 0x6d, 0x70, 0x2e, 0x70, 0x72, 0x6f, 0x74, 0x6f,
	0x1a, 0x1f, 0x69, 0x62, 0x63, 0x2f, 0x63, 0x6f, 0x72, 0x65, 0x2f, 0x63, 0x6c, 0x69, 0x65, 0x6e,
	0x74, 0x2f, 0x76, 0x31, 0x2f, 0x63, 0x6c, 0x69, 0x65, 0x6e, 0x74, 0x2e, 0x70, 0x72, 0x6f, 0x74,
	0x6f, 0x1a, 0x27, 0x69, 0x62, 0x63, 0x2f, 0x63, 0x6f, 0x72, 0x65, 0x2f, 0x63, 0x6f, 0x6d, 0x6d,
	0x69, 0x74, 0x6d, 0x65, 0x6e, 0x74, 0x2f, 0x76, 0x31, 0x2f, 0x63, 0x6f, 0x6d, 0x6d, 0x69, 0x74,
	0x6d, 0x65, 0x6e, 0x74, 0x2e, 0x70, 0x72, 0x6f, 0x74, 0x6f, 0x1a, 0x14, 0x67, 0x6f, 0x67, 0x6f,
	0x70, 0x72, 0x6f, 0x74, 0x6f, 0x2f, 0x67, 0x6f, 0x67, 0x6f, 0x2e, 0x70, 0x72, 0x6f, 0x74, 0x6f,
	0x22, 0xf6, 0x07, 0x0a, 0x0b, 0x43, 0x6c, 0x69, 0x65, 0x6e, 0x74, 0x53, 0x74, 0x61, 0x74, 0x65,
	0x12, 0x19, 0x0a, 0x08, 0x63, 0x68, 0x61, 0x69, 0x6e, 0x5f, 0x69, 0x64, 0x18, 0x01, 0x20, 0x01,
	0x28, 0x09, 0x52, 0x07, 0x63, 0x68, 0x61, 0x69, 0x6e, 0x49, 0x64, 0x12, 0x65, 0x0a, 0x0b, 0x74,
	0x72, 0x75, 0x73, 0x74, 0x5f, 0x6c, 0x65, 0x76, 0x65, 0x6c, 0x18, 0x02, 0x20, 0x01, 0x28, 0x0b,
	0x32, 0x28, 0x2e, 0x69, 0x62, 0x63, 0x2e, 0x6c, 0x69, 0x67, 0x68, 0x74, 0x63, 0x6c, 0x69, 0x65,
	0x6e, 0x74, 0x73, 0x2e, 0x74, 0x65, 0x6e, 0x64, 0x65, 0x72, 0x6d, 0x69, 0x6e, 0x74, 0x2e, 0x76,
	0x31, 0x2e, 0x46, 0x72, 0x61, 0x63, 0x74, 0x69, 0x6f, 0x6e, 0x42, 0x1a, 0xc8, 0xde, 0x1f, 0x00,
	0xf2, 0xde, 0x1f, 0x12, 0x79, 0x61, 0x6d, 0x6c, 0x3a, 0x22, 0x74, 0x72, 0x75, 0x73, 0x74, 0x5f,
	0x6c, 0x65, 0x76, 0x65, 0x6c, 0x22, 0x52, 0x0a, 0x74, 0x72, 0x75, 0x73, 0x74, 0x4c, 0x65, 0x76,
	0x65, 0x6c, 0x12, 0x66, 0x0a, 0x0f, 0x74, 0x72, 0x75, 0x73, 0x74, 0x69, 0x6e, 0x67, 0x5f, 0x70,
	0x65, 0x72, 0x69, 0x6f, 0x64, 0x18, 0x03, 0x20, 0x01, 0x28, 0x0b, 0x32, 0x19, 0x2e, 0x67, 0x6f,
	0x6f, 0x67, 0x6c, 0x65, 0x2e, 0x70, 0x72, 0x6f, 0x74, 0x6f, 0x62, 0x75, 0x66, 0x2e, 0x44, 0x75,
	0x72, 0x61, 0x74, 0x69, 0x6f, 0x6e, 0x42, 0x22, 0xc8, 0xde, 0x1f, 0x00, 0xf2, 0xde, 0x1f, 0x16,
	0x79, 0x61, 0x6d, 0x6c, 0x3a, 0x22, 0x74, 0x72, 0x75, 0x73, 0x74, 0x69, 0x6e, 0x67, 0x5f, 0x70,
	0x65, 0x72, 0x69, 0x6f, 0x64, 0x22, 0x98, 0xdf, 0x1f, 0x01, 0x52, 0x0e, 0x74, 0x72, 0x75, 0x73,
	0x74, 0x69, 0x6e, 0x67, 0x50, 0x65, 0x72, 0x69, 0x6f, 0x64, 0x12, 0x69, 0x0a, 0x10, 0x75, 0x6e,
	0x62, 0x6f, 0x6e, 0x64, 0x69, 0x6e, 0x67, 0x5f, 0x70, 0x65, 0x72, 0x69, 0x6f, 0x64, 0x18, 0x04,
	0x20, 0x01, 0x28, 0x0b, 0x32, 0x19, 0x2e, 0x67, 0x6f, 0x6f, 0x67, 0x6c, 0x65, 0x2e, 0x70, 0x72,
	0x6f, 0x74, 0x6f, 0x62, 0x75, 0x66, 0x2e, 0x44, 0x75, 0x72, 0x61, 0x74, 0x69, 0x6f, 0x6e, 0x42,
	0x23, 0xc8, 0xde, 0x1f, 0x00, 0xf2, 0xde, 0x1f, 0x17, 0x79, 0x61, 0x6d, 0x6c, 0x3a, 0x22, 0x75,
	0x6e, 0x62, 0x6f, 0x6e, 0x64, 0x69, 0x6e, 0x67, 0x5f, 0x70, 0x65, 0x72, 0x69, 0x6f, 0x64, 0x22,
	0x98, 0xdf, 0x1f, 0x01, 0x52, 0x0f, 0x75, 0x6e, 0x62, 0x6f, 0x6e, 0x64, 0x69, 0x6e, 0x67, 0x50,
	0x65, 0x72, 0x69, 0x6f, 0x64, 0x12, 0x65, 0x0a, 0x0f, 0x6d, 0x61, 0x78, 0x5f, 0x63, 0x6c, 0x6f,
	0x63, 0x6b, 0x5f, 0x64, 0x72, 0x69, 0x66, 0x74, 0x18, 0x05, 0x20, 0x01, 0x28, 0x0b, 0x32, 0x19,
	0x2e, 0x67, 0x6f, 0x6f, 0x67, 0x6c, 0x65, 0x2e, 0x70, 0x72, 0x6f, 0x74, 0x6f, 0x62, 0x75, 0x66,
	0x2e, 0x44, 0x75, 0x72, 0x61, 0x74, 0x69, 0x6f, 0x6e, 0x42, 0x22, 0xc8, 0xde, 0x1f, 0x00, 0xf2,
	0xde, 0x1f, 0x16, 0x79, 0x61, 0x6d, 0x6c, 0x3a, 0x22, 0x6d, 0x61, 0x78, 0x5f, 0x63, 0x6c, 0x6f,
	0x63, 0x6b, 0x5f, 0x64, 0x72, 0x69, 0x66, 0x74, 0x22, 0x98, 0xdf, 0x1f, 0x01, 0x52, 0x0d, 0x6d,
	0x61, 0x78, 0x43, 0x6c, 0x6f, 0x63, 0x6b, 0x44, 0x72, 0x69, 0x66, 0x74, 0x12, 0x5d, 0x0a, 0x0d,
	0x66, 0x72, 0x6f, 0x7a, 0x65, 0x6e, 0x5f, 0x68, 0x65, 0x69, 0x67, 0x68, 0x74, 0x18, 0x06, 0x20,
	0x01, 0x28, 0x0b, 0x32, 0x1a, 0x2e, 0x69, 0x62, 0x63, 0x2e, 0x63, 0x6f, 0x72, 0x65, 0x2e, 0x63,
	0x6c, 0x69, 0x65, 0x6e, 0x74, 0x2e, 0x76, 0x31, 0x2e, 0x48, 0x65, 0x69, 0x67, 0x68, 0x74, 0x42,
	0x1c, 0xc8, 0xde, 0x1f, 0x00, 0xf2, 0xde, 0x1f, 0x14, 0x79, 0x61, 0x6d, 0x6c, 0x3a, 0x22, 0x66,
	0x72, 0x6f, 0x7a, 0x65, 0x6e, 0x5f, 0x68, 0x65, 0x69, 0x67, 0x68, 0x74, 0x22, 0x52, 0x0c, 0x66,
	0x72, 0x6f, 0x7a, 0x65, 0x6e, 0x48, 0x65, 0x69, 0x67, 0x68, 0x74, 0x12, 0x5d, 0x0a, 0x0d, 0x6c,
	0x61, 0x74, 0x65, 0x73, 0x74, 0x5f, 0x68, 0x65, 0x69, 0x67, 0x68, 0x74, 0x18, 0x07, 0x20, 0x01,
	0x28, 0x0b, 0x32, 0x1a, 0x2e, 0x69, 0x62, 0x63, 0x2e, 0x63, 0x6f, 0x72, 0x65, 0x2e, 0x63, 0x6c,
	0x69, 0x65, 0x6e, 0x74, 0x2e, 0x76, 0x31, 0x2e, 0x48, 0x65, 0x69, 0x67, 0x68, 0x74, 0x42, 0x1c,
	0xc8, 0xde, 0x1f, 0x00, 0xf2, 0xde, 0x1f, 0x14, 0x79, 0x61, 0x6d, 0x6c, 0x3a, 0x22, 0x6c, 0x61,
	0x74, 0x65, 0x73, 0x74, 0x5f, 0x68, 0x65, 0x69, 0x67, 0x68, 0x74, 0x22, 0x52, 0x0c, 0x6c, 0x61,
	0x74, 0x65, 0x73, 0x74, 0x48, 0x65, 0x69, 0x67, 0x68, 0x74, 0x12, 0x53, 0x0a, 0x0b, 0x70, 0x72,
	0x6f, 0x6f, 0x66, 0x5f, 0x73, 0x70, 0x65, 0x63, 0x73, 0x18, 0x08, 0x20, 0x03, 0x28, 0x0b, 0x32,
	0x1a, 0x2e, 0x63, 0x6f, 0x73, 0x6d, 0x6f, 0x73, 0x2e, 0x69, 0x63, 0x73, 0x32, 0x33, 0x2e, 0x76,
	0x31, 0x2e, 0x50, 0x72, 0x6f, 0x6f, 0x66, 0x53, 0x70, 0x65, 0x63, 0x42, 0x16, 0xf2, 0xde, 0x1f,
	0x12, 0x79, 0x61, 0x6d, 0x6c, 0x3a, 0x22, 0x70, 0x72, 0x6f, 0x6f, 0x66, 0x5f, 0x73, 0x70, 0x65,
	0x63, 0x73, 0x22, 0x52, 0x0a, 0x70, 0x72, 0x6f, 0x6f, 0x66, 0x53, 0x70, 0x65, 0x63, 0x73, 0x12,
	0x3a, 0x0a, 0x0c, 0x75, 0x70, 0x67, 0x72, 0x61, 0x64, 0x65, 0x5f, 0x70, 0x61, 0x74, 0x68, 0x18,
	0x09, 0x20, 0x03, 0x28, 0x09, 0x42, 0x17, 0xf2, 0xde, 0x1f, 0x13, 0x79, 0x61, 0x6d, 0x6c, 0x3a,
	0x22, 0x75, 0x70, 0x67, 0x72, 0x61, 0x64, 0x65, 0x5f, 0x70, 0x61, 0x74, 0x68, 0x22, 0x52, 0x0b,
	0x75, 0x70, 0x67, 0x72, 0x61, 0x64, 0x65, 0x50, 0x61, 0x74, 0x68, 0x12, 0x61, 0x0a, 0x19, 0x61,
	0x6c, 0x6c, 0x6f, 0x77, 0x5f, 0x75, 0x70, 0x64, 0x61, 0x74, 0x65, 0x5f, 0x61, 0x66, 0x74, 0x65,
	0x72, 0x5f, 0x65, 0x78, 0x70, 0x69, 0x72, 0x79, 0x18, 0x0a, 0x20, 0x01, 0x28, 0x08, 0x42, 0x26,
	0x18, 0x01, 0xf2, 0xde, 0x1f, 0x20, 0x79, 0x61, 0x6d, 0x6c, 0x3a, 0x22, 0x61, 0x6c, 0x6c, 0x6f,
	0x77, 0x5f, 0x75, 0x70, 0x64, 0x61, 0x74, 0x65, 0x5f, 0x61, 0x66, 0x74, 0x65, 0x72, 0x5f, 0x65,
	0x78, 0x70, 0x69, 0x72, 0x79, 0x22, 0x52, 0x16, 0x61, 0x6c, 0x6c, 0x6f, 0x77, 0x55, 0x70, 0x64,
	0x61, 0x74, 0x65, 0x41, 0x66, 0x74, 0x65, 0x72, 0x45, 0x78, 0x70, 0x69, 0x72, 0x79, 0x12, 0x73,
	0x0a, 0x1f, 0x61, 0x6c, 0x6c, 0x6f, 0x77, 0x5f, 0x75, 0x70, 0x64, 0x61, 0x74, 0x65, 0x5f, 0x61,
	0x66, 0x74, 0x65, 0x72, 0x5f, 0x6d, 0x69, 0x73, 0x62, 0x65, 0x68, 0x61, 0x76, 0x69, 0x6f, 0x75,
	0x72, 0x18, 0x0b, 0x20, 0x01, 0x28, 0x08, 0x42, 0x2c, 0x18, 0x01, 0xf2, 0xde, 0x1f, 0x26, 0x79,
	0x61, 0x6d, 0x6c, 0x3a, 0x22, 0x61, 0x6c, 0x6c, 0x6f, 0x77, 0x5f, 0x75, 0x70, 0x64, 0x61, 0x74,
	0x65, 0x5f, 0x61, 0x66, 0x74, 0x65, 0x72, 0x5f, 0x6d, 0x69, 0x73, 0x62, 0x65, 0x68, 0x61, 0x76,
	0x69, 0x6f, 0x75, 0x72, 0x22, 0x52, 0x1c, 0x61, 0x6c, 0x6c, 0x6f, 0x77, 0x55, 0x70, 0x64, 0x61,
	0x74, 0x65, 0x41, 0x66, 0x74, 0x65, 0x72, 0x4d, 0x69, 0x73, 0x62, 0x65, 0x68, 0x61, 0x76, 0x69,
	0x6f, 0x75, 0x72, 0x3a, 0x04, 0x88, 0xa0, 0x1f, 0x00, 0x22, 0xa0, 0x02, 0x0a, 0x0e, 0x43, 0x6f,
	0x6e, 0x73, 0x65, 0x6e, 0x73, 0x75, 0x73, 0x53, 0x74, 0x61, 0x74, 0x65, 0x12, 0x42, 0x0a, 0x09,
	0x74, 0x69, 0x6d, 0x65, 0x73, 0x74, 0x61, 0x6d, 0x70, 0x18, 0x01, 0x20, 0x01, 0x28, 0x0b, 0x32,
	0x1a, 0x2e, 0x67, 0x6f, 0x6f, 0x67, 0x6c, 0x65, 0x2e, 0x70, 0x72, 0x6f, 0x74, 0x6f, 0x62, 0x75,
	0x66, 0x2e, 0x54, 0x69, 0x6d, 0x65, 0x73, 0x74, 0x61, 0x6d, 0x70, 0x42, 0x08, 0xc8, 0xde, 0x1f,
	0x00, 0x90, 0xdf, 0x1f, 0x01, 0x52, 0x09, 0x74, 0x69, 0x6d, 0x65, 0x73, 0x74, 0x61, 0x6d, 0x70,
	0x12, 0x3c, 0x0a, 0x04, 0x72, 0x6f, 0x6f, 0x74, 0x18, 0x02, 0x20, 0x01, 0x28, 0x0b, 0x32, 0x22,
	0x2e, 0x69, 0x62, 0x63, 0x2e, 0x63, 0x6f, 0x72, 0x65, 0x2e, 0x63, 0x6f, 0x6d, 0x6d, 0x69, 0x74,
	0x6d, 0x65, 0x6e, 0x74, 0x2e, 0x76, 0x31, 0x2e, 0x4d, 0x65, 0x72, 0x6b, 0x6c, 0x65, 0x52, 0x6f,
	0x6f, 0x74, 0x42, 0x04, 0xc8, 0xde, 0x1f, 0x00, 0x52, 0x04, 0x72, 0x6f, 0x6f, 0x74, 0x12, 0x85,
	0x01, 0x0a, 0x14, 0x6e, 0x65, 0x78, 0x74, 0x5f, 0x76, 0x61, 0x6c, 0x69, 0x64, 0x61, 0x74, 0x6f,
	0x72, 0x73, 0x5f, 0x68, 0x61, 0x73, 0x68, 0x18, 0x03, 0x20, 0x01, 0x28, 0x0c, 0x42, 0x53, 0xf2,
	0xde, 0x1f, 0x1b, 0x79, 0x61, 0x6d, 0x6c, 0x3a, 0x22, 0x6e, 0x65, 0x78, 0x74, 0x5f, 0x76, 0x61,
	0x6c, 0x69, 0x64, 0x61, 0x74, 0x6f, 0x72, 0x73, 0x5f, 0x68, 0x61, 0x73, 0x68, 0x22, 0xfa, 0xde,
	0x1f, 0x30, 0x67, 0x69, 0x74, 0x68, 0x75, 0x62, 0x2e, 0x63, 0x6f, 0x6d, 0x2f, 0x63, 0x6f, 0x6d,
	0x65, 0x74, 0x62, 0x66, 0x74, 0x2f, 0x63, 0x6f, 0x6d, 0x65, 0x74, 0x62, 0x66, 0x74, 0x2f, 0x6c,
	0x69, 0x62, 0x73, 0x2f, 0x62, 0x79, 0x74, 0x65, 0x73, 0x2e, 0x48, 0x65, 0x78, 0x42, 0x79, 0x74,
	0x65, 0x73, 0x52, 0x12, 0x6e, 0x65, 0x78, 0x74, 0x56, 0x61, 0x6c, 0x69, 0x64, 0x61, 0x74, 0x6f,
	0x72, 0x73, 0x48, 0x61, 0x73, 0x68, 0x3a, 0x04, 0x88, 0xa0, 0x1f, 0x00, 0x22, 0x8f, 0x02, 0x0a,
	0x0c, 0x4d, 0x69, 0x73, 0x62, 0x65, 0x68, 0x61, 0x76, 0x69, 0x6f, 0x75, 0x72, 0x12, 0x33, 0x0a,
	0x09, 0x63, 0x6c, 0x69, 0x65, 0x6e, 0x74, 0x5f, 0x69, 0x64, 0x18, 0x01, 0x20, 0x01, 0x28, 0x09,
	0x42, 0x16, 0x18, 0x01, 0xf2, 0xde, 0x1f, 0x10, 0x79, 0x61, 0x6d, 0x6c, 0x3a, 0x22, 0x63, 0x6c,
	0x69, 0x65, 0x6e, 0x74, 0x5f, 0x69, 0x64, 0x22, 0x52, 0x08, 0x63, 0x6c, 0x69, 0x65, 0x6e, 0x74,
	0x49, 0x64, 0x12, 0x61, 0x0a, 0x08, 0x68, 0x65, 0x61, 0x64, 0x65, 0x72, 0x5f, 0x31, 0x18, 0x02,
	0x20, 0x01, 0x28, 0x0b, 0x32, 0x26, 0x2e, 0x69, 0x62, 0x63, 0x2e, 0x6c, 0x69, 0x67, 0x68, 0x74,
	0x63, 0x6c, 0x69, 0x65, 0x6e, 0x74, 0x73, 0x2e, 0x74, 0x65, 0x6e, 0x64, 0x65, 0x72, 0x6d, 0x69,
	0x6e, 0x74, 0x2e, 0x76, 0x31, 0x2e, 0x48, 0x65, 0x61, 0x64, 0x65, 0x72, 0x42, 0x1e, 0xe2, 0xde,
	0x1f, 0x07, 0x48, 0x65, 0x61, 0x64, 0x65, 0x72, 0x31, 0xf2, 0xde, 0x1f, 0x0f, 0x79, 0x61, 0x6d,
	0x6c, 0x3a, 0x22, 0x68, 0x65, 0x61, 0x64, 0x65, 0x72, 0x5f, 0x31, 0x22, 0x52, 0x07, 0x68, 0x65,
	0x61, 0x64, 0x65, 0x72, 0x31, 0x12, 0x61, 0x0a, 0x08, 0x68, 0x65, 0x61, 0x64, 0x65, 0x72, 0x5f,
	0x32, 0x18, 0x03, 0x20, 0x01, 0x28, 0x0b, 0x32, 0x26, 0x2e, 0x69, 0x62, 0x63, 0x2e, 0x6c, 0x69,
	0x67, 0x68, 0x74, 0x63, 0x6c, 0x69, 0x65, 0x6e, 0x74, 0x73, 0x2e, 0x74, 0x65, 0x6e, 0x64, 0x65,
	0x72, 0x6d, 0x69, 0x6e, 0x74, 0x2e, 0x76, 0x31, 0x2e, 0x48, 0x65, 0x61, 0x64, 0x65, 0x72, 0x42,
	0x1e, 0xe2, 0xde, 0x1f, 0x07, 0x48, 0x65, 0x61, 0x64, 0x65, 0x72, 0x32, 0xf2, 0xde, 0x1f, 0x0f,
	0x79, 0x61, 0x6d, 0x6c, 0x3a, 0x22, 0x68, 0x65, 0x61, 0x64, 0x65, 0x72, 0x5f, 0x32, 0x22, 0x52,
	0x07, 0x68, 0x65, 0x61, 0x64, 0x65, 0x72, 0x32, 0x3a, 0x04, 0x88, 0xa0, 0x1f, 0x00, 0x22, 0x9a,
	0x03, 0x0a, 0x06, 0x48, 0x65, 0x61, 0x64, 0x65, 0x72, 0x12, 0x61, 0x0a, 0x0d, 0x73, 0x69, 0x67,
	0x6e, 0x65, 0x64, 0x5f, 0x68, 0x65, 0x61, 0x64, 0x65, 0x72, 0x18, 0x01, 0x20, 0x01, 0x28, 0x0b,
	0x32, 0x1e, 0x2e, 0x74, 0x65, 0x6e, 0x64, 0x65, 0x72, 0x6d, 0x69, 0x6e, 0x74, 0x2e, 0x74, 0x79,
	0x70, 0x65, 0x73, 0x2e, 0x53, 0x69, 0x67, 0x6e, 0x65, 0x64, 0x48, 0x65, 0x61, 0x64, 0x65, 0x72,
	0x42, 0x1c, 0xd0, 0xde, 0x1f, 0x01, 0xf2, 0xde, 0x1f, 0x14, 0x79, 0x61, 0x6d, 0x6c, 0x3a, 0x22,
	0x73, 0x69, 0x67, 0x6e, 0x65, 0x64, 0x5f, 0x68, 0x65, 0x61, 0x64, 0x65, 0x72, 0x22, 0x52, 0x0c,
	0x73, 0x69, 0x67, 0x6e, 0x65, 0x64, 0x48, 0x65, 0x61, 0x64, 0x65, 0x72, 0x12, 0x5d, 0x0a, 0x0d,
	0x76, 0x61, 0x6c, 0x69, 0x64, 0x61, 0x74, 0x6f, 0x72, 0x5f, 0x73, 0x65, 0x74, 0x18, 0x02, 0x20,
	0x01, 0x28, 0x0b, 0x32, 0x1e, 0x2e, 0x74, 0x65, 0x6e, 0x64, 0x65, 0x72, 0x6d, 0x69, 0x6e, 0x74,
	0x2e, 0x74, 0x79, 0x70, 0x65, 0x73, 0x2e, 0x56, 0x61, 0x6c, 0x69, 0x64, 0x61, 0x74, 0x6f, 0x72,
	0x53, 0x65, 0x74, 0x42, 0x18, 0xf2, 0xde, 0x1f, 0x14, 0x79, 0x61, 0x6d, 0x6c, 0x3a, 0x22, 0x76,
	0x61, 0x6c, 0x69, 0x64, 0x61, 0x74, 0x6f, 0x72, 0x5f, 0x73, 0x65, 0x74, 0x22, 0x52, 0x0c, 0x76,
	0x61, 0x6c, 0x69, 0x64, 0x61, 0x74, 0x6f, 0x72, 0x53, 0x65, 0x74, 0x12, 0x60, 0x0a, 0x0e, 0x74,
	0x72, 0x75, 0x73, 0x74, 0x65, 0x64, 0x5f, 0x68, 0x65, 0x69, 0x67, 0x68, 0x74, 0x18, 0x03, 0x20,
	0x01, 0x28, 0x0b, 0x32, 0x1a, 0x2e, 0x69, 0x62, 0x63, 0x2e, 0x63, 0x6f, 0x72, 0x65, 0x2e, 0x63,
	0x6c, 0x69, 0x65, 0x6e, 0x74, 0x2e, 0x76, 0x31, 0x2e, 0x48, 0x65, 0x69, 0x67, 0x68, 0x74, 0x42,
	0x1d, 0xc8, 0xde, 0x1f, 0x00, 0xf2, 0xde, 0x1f, 0x15, 0x79, 0x61, 0x6d, 0x6c, 0x3a, 0x22, 0x74,
	0x72, 0x75, 0x73, 0x74, 0x65, 0x64, 0x5f, 0x68, 0x65, 0x69, 0x67, 0x68, 0x74, 0x22, 0x52, 0x0d,
	0x74, 0x72, 0x75, 0x73, 0x74, 0x65, 0x64, 0x48, 0x65, 0x69, 0x67, 0x68, 0x74, 0x12, 0x6c, 0x0a,
	0x12, 0x74, 0x72, 0x75, 0x73, 0x74, 0x65, 0x64, 0x5f, 0x76, 0x61, 0x6c, 0x69, 0x64, 0x61, 0x74,
	0x6f, 0x72, 0x73, 0x18, 0x04, 0x20, 0x01, 0x28, 0x0b, 0x32, 0x1e, 0x2e, 0x74, 0x65, 0x6e, 0x64,
	0x65, 0x72, 0x6d, 0x69, 0x6e, 0x74, 0x2e, 0x74, 0x79, 0x70, 0x65, 0x73, 0x2e, 0x56, 0x61, 0x6c,
	0x69, 0x64, 0x61, 0x74, 0x6f, 0x72, 0x53, 0x65, 0x74, 0x42, 0x1d, 0xf2, 0xde, 0x1f, 0x19, 0x79,
	0x61, 0x6d, 0x6c, 0x3a, 0x22, 0x74, 0x72, 0x75, 0x73, 0x74, 0x65, 0x64, 0x5f, 0x76, 0x61, 0x6c,
	0x69, 0x64, 0x61, 0x74, 0x6f, 0x72, 0x73, 0x22, 0x52, 0x11, 0x74, 0x72, 0x75, 0x73, 0x74, 0x65,
	0x64, 0x56, 0x61, 0x6c, 0x69, 0x64, 0x61, 0x74, 0x6f, 0x72, 0x73, 0x22, 0x4a, 0x0a, 0x08, 0x46,
	0x72, 0x61, 0x63, 0x74, 0x69, 0x6f, 0x6e, 0x12, 0x1c, 0x0a, 0x09, 0x6e, 0x75, 0x6d, 0x65, 0x72,
	0x61, 0x74, 0x6f, 0x72, 0x18, 0x01, 0x20, 0x01, 0x28, 0x04, 0x52, 0x09, 0x6e, 0x75, 0x6d, 0x65,
	0x72, 0x61, 0x74, 0x6f, 0x72, 0x12, 0x20, 0x0a, 0x0b, 0x64, 0x65, 0x6e, 0x6f, 0x6d, 0x69, 0x6e,
	0x61, 0x74, 0x6f, 0x72, 0x18, 0x02, 0x20, 0x01, 0x28, 0x04, 0x52, 0x0b, 0x64, 0x65, 0x6e, 0x6f,
	0x6d, 0x69, 0x6e, 0x61, 0x74, 0x6f, 0x72, 0x42, 0x4c, 0x5a, 0x4a, 0x67, 0x69, 0x74, 0x68, 0x75,
	0x62, 0x2e, 0x63, 0x6f, 0x6d, 0x2f, 0x63, 0x6f, 0x73, 0x6d, 0x6f, 0x73, 0x2f, 0x69, 0x62, 0x63,
	0x2d, 0x67, 0x6f, 0x2f, 0x76, 0x37, 0x2f, 0x6d, 0x6f, 0x64, 0x75, 0x6c, 0x65, 0x73, 0x2f, 0x6c,
	0x69, 0x67, 0x68, 0x74, 0x2d, 0x63, 0x6c, 0x69, 0x65, 0x6e, 0x74, 0x73, 0x2f, 0x30, 0x37, 0x2d,
	0x74, 0x65, 0x6e, 0x64, 0x65, 0x72, 0x6d, 0x69, 0x6e, 0x74, 0x3b, 0x74, 0x65, 0x6e, 0x64, 0x65,
	0x72, 0x6d, 0x69, 0x6e, 0x74, 0x62, 0x06, 0x70, 0x72, 0x6f, 0x74, 0x6f, 0x33,
}

var (
	file_ibc_lightclients_tendermint_v1_tendermint_proto_rawDescOnce sync.Once
	file_ibc_lightclients_tendermint_v1_tendermint_proto_rawDescData = file_ibc_lightclients_tendermint_v1_tendermint_proto_rawDesc
)

func file_ibc_lightclients_tendermint_v1_tendermint_proto_rawDescGZIP() []byte {
	file_ibc_lightclients_tendermint_v1_tendermint_proto_rawDescOnce.Do(func() {
		file_ibc_lightclients_tendermint_v1_tendermint_proto_rawDescData = protoimpl.X.CompressGZIP(file_ibc_lightclients_tendermint_v1_tendermint_proto_rawDescData)
	})
	return file_ibc_lightclients_tendermint_v1_tendermint_proto_rawDescData
}

var file_ibc_lightclients_tendermint_v1_tendermint_proto_msgTypes = make([]protoimpl.MessageInfo, 5)
var file_ibc_lightclients_tendermint_v1_tendermint_proto_goTypes = []interface{}{
	(*ClientState)(nil),           // 0: ibc.lightclients.tendermint.v1.ClientState
	(*ConsensusState)(nil),        // 1: ibc.lightclients.tendermint.v1.ConsensusState
	(*Misbehaviour)(nil),          // 2: ibc.lightclients.tendermint.v1.Misbehaviour
	(*Header)(nil),                // 3: ibc.lightclients.tendermint.v1.Header
	(*Fraction)(nil),              // 4: ibc.lightclients.tendermint.v1.Fraction
	(*durationpb.Duration)(nil),   // 5: google.protobuf.Duration
	(*types.Height)(nil),          // 6: ibc.core.client.v1.Height
	(*_go.ProofSpec)(nil),         // 7: cosmos.ics23.v1.ProofSpec
	(*timestamppb.Timestamp)(nil), // 8: google.protobuf.Timestamp
	(*types1.MerkleRoot)(nil),     // 9: ibc.core.commitment.v1.MerkleRoot
	(*types2.SignedHeader)(nil),   // 10: tendermint.types.SignedHeader
	(*types2.ValidatorSet)(nil),   // 11: tendermint.types.ValidatorSet
}
var file_ibc_lightclients_tendermint_v1_tendermint_proto_depIdxs = []int32{
	4,  // 0: ibc.lightclients.tendermint.v1.ClientState.trust_level:type_name -> ibc.lightclients.tendermint.v1.Fraction
	5,  // 1: ibc.lightclients.tendermint.v1.ClientState.trusting_period:type_name -> google.protobuf.Duration
	5,  // 2: ibc.lightclients.tendermint.v1.ClientState.unbonding_period:type_name -> google.protobuf.Duration
	5,  // 3: ibc.lightclients.tendermint.v1.ClientState.max_clock_drift:type_name -> google.protobuf.Duration
	6,  // 4: ibc.lightclients.tendermint.v1.ClientState.frozen_height:type_name -> ibc.core.client.v1.Height
	6,  // 5: ibc.lightclients.tendermint.v1.ClientState.latest_height:type_name -> ibc.core.client.v1.Height
	7,  // 6: ibc.lightclients.tendermint.v1.ClientState.proof_specs:type_name -> cosmos.ics23.v1.ProofSpec
	8,  // 7: ibc.lightclients.tendermint.v1.ConsensusState.timestamp:type_name -> google.protobuf.Timestamp
	9,  // 8: ibc.lightclients.tendermint.v1.ConsensusState.root:type_name -> ibc.core.commitment.v1.MerkleRoot
	3,  // 9: ibc.lightclients.tendermint.v1.Misbehaviour.header_1:type_name -> ibc.lightclients.tendermint.v1.Header
	3,  // 10: ibc.lightclients.tendermint.v1.Misbehaviour.header_2:type_name -> ibc.lightclients.tendermint.v1.Header
	10, // 11: ibc.lightclients.tendermint.v1.Header.signed_header:type_name -> tendermint.types.SignedHeader
	11, // 12: ibc.lightclients.tendermint.v1.Header.validator_set:type_name -> tendermint.types.ValidatorSet
	6,  // 13: ibc.lightclients.tendermint.v1.Header.trusted_height:type_name -> ibc.core.client.v1.Height
	11, // 14: ibc.lightclients.tendermint.v1.Header.trusted_validators:type_name -> tendermint.types.ValidatorSet
	15, // [15:15] is the sub-list for method output_type
	15, // [15:15] is the sub-list for method input_type
	15, // [15:15] is the sub-list for extension type_name
	15, // [15:15] is the sub-list for extension extendee
	0,  // [0:15] is the sub-list for field type_name
}

func init() { file_ibc_lightclients_tendermint_v1_tendermint_proto_init() }
func file_ibc_lightclients_tendermint_v1_tendermint_proto_init() {
	if File_ibc_lightclients_tendermint_v1_tendermint_proto != nil {
		return
	}
	if !protoimpl.UnsafeEnabled {
		file_ibc_lightclients_tendermint_v1_tendermint_proto_msgTypes[0].Exporter = func(v interface{}, i int) interface{} {
			switch v := v.(*ClientState); i {
			case 0:
				return &v.state
			case 1:
				return &v.sizeCache
			case 2:
				return &v.unknownFields
			default:
				return nil
			}
		}
		file_ibc_lightclients_tendermint_v1_tendermint_proto_msgTypes[1].Exporter = func(v interface{}, i int) interface{} {
			switch v := v.(*ConsensusState); i {
			case 0:
				return &v.state
			case 1:
				return &v.sizeCache
			case 2:
				return &v.unknownFields
			default:
				return nil
			}
		}
		file_ibc_lightclients_tendermint_v1_tendermint_proto_msgTypes[2].Exporter = func(v interface{}, i int) interface{} {
			switch v := v.(*Misbehaviour); i {
			case 0:
				return &v.state
			case 1:
				return &v.sizeCache
			case 2:
				return &v.unknownFields
			default:
				return nil
			}
		}
		file_ibc_lightclients_tendermint_v1_tendermint_proto_msgTypes[3].Exporter = func(v interface{}, i int) interface{} {
			switch v := v.(*Header); i {
			case 0:
				return &v.state
			case 1:
				return &v.sizeCache
			case 2:
				return &v.unknownFields
			default:
				return nil
			}
		}
		file_ibc_lightclients_tendermint_v1_tendermint_proto_msgTypes[4].Exporter = func(v interface{}, i int) interface{} {
			switch v := v.(*Fraction); i {
			case 0:
				return &v.state
			case 1:
				return &v.sizeCache
			case 2:
				return &v.unknownFields
			default:
				return nil
			}
		}
	}
	type x struct{}
	out := protoimpl.TypeBuilder{
		File: protoimpl.DescBuilder{
			GoPackagePath: reflect.TypeOf(x{}).PkgPath(),
			RawDescriptor: file_ibc_lightclients_tendermint_v1_tendermint_proto_rawDesc,
			NumEnums:      0,
			NumMessages:   5,
			NumExtensions: 0,
			NumServices:   0,
		},
		GoTypes:           file_ibc_lightclients_tendermint_v1_tendermint_proto_goTypes,
		DependencyIndexes: file_ibc_lightclients_tendermint_v1_tendermint_proto_depIdxs,
		MessageInfos:      file_ibc_lightclients_tendermint_v1_tendermint_proto_msgTypes,
	}.Build()
	File_ibc_lightclients_tendermint_v1_tendermint_proto = out.File
	file_ibc_lightclients_tendermint_v1_tendermint_proto_rawDesc = nil
	file_ibc_lightclients_tendermint_v1_tendermint_proto_goTypes = nil
	file_ibc_lightclients_tendermint_v1_tendermint_proto_depIdxs = nil
}