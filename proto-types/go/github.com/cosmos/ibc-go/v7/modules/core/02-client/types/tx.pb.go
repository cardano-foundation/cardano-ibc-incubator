// Code generated by protoc-gen-go. DO NOT EDIT.
// versions:
// 	protoc-gen-go v1.32.0
// 	protoc        (unknown)
// source: ibc/core/client/v1/tx.proto

package types

import (
	_ "github.com/cosmos/gogoproto/gogoproto"
	protoreflect "google.golang.org/protobuf/reflect/protoreflect"
	protoimpl "google.golang.org/protobuf/runtime/protoimpl"
	anypb "google.golang.org/protobuf/types/known/anypb"
	reflect "reflect"
	sync "sync"
)

const (
	// Verify that this generated code is sufficiently up-to-date.
	_ = protoimpl.EnforceVersion(20 - protoimpl.MinVersion)
	// Verify that runtime/protoimpl is sufficiently up-to-date.
	_ = protoimpl.EnforceVersion(protoimpl.MaxVersion - 20)
)

// MsgCreateClient defines a message to create an IBC client
type MsgCreateClient struct {
	state         protoimpl.MessageState
	sizeCache     protoimpl.SizeCache
	unknownFields protoimpl.UnknownFields

	// light client state
	ClientState *anypb.Any `protobuf:"bytes,1,opt,name=client_state,json=clientState,proto3" json:"client_state,omitempty"`
	// consensus state associated with the client that corresponds to a given
	// height.
	ConsensusState *anypb.Any `protobuf:"bytes,2,opt,name=consensus_state,json=consensusState,proto3" json:"consensus_state,omitempty"`
	// signer address
	Signer string `protobuf:"bytes,3,opt,name=signer,proto3" json:"signer,omitempty"`
}

func (x *MsgCreateClient) Reset() {
	*x = MsgCreateClient{}
	if protoimpl.UnsafeEnabled {
		mi := &file_ibc_core_client_v1_tx_proto_msgTypes[0]
		ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
		ms.StoreMessageInfo(mi)
	}
}

func (x *MsgCreateClient) String() string {
	return protoimpl.X.MessageStringOf(x)
}

func (*MsgCreateClient) ProtoMessage() {}

func (x *MsgCreateClient) ProtoReflect() protoreflect.Message {
	mi := &file_ibc_core_client_v1_tx_proto_msgTypes[0]
	if protoimpl.UnsafeEnabled && x != nil {
		ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
		if ms.LoadMessageInfo() == nil {
			ms.StoreMessageInfo(mi)
		}
		return ms
	}
	return mi.MessageOf(x)
}

// Deprecated: Use MsgCreateClient.ProtoReflect.Descriptor instead.
func (*MsgCreateClient) Descriptor() ([]byte, []int) {
	return file_ibc_core_client_v1_tx_proto_rawDescGZIP(), []int{0}
}

func (x *MsgCreateClient) GetClientState() *anypb.Any {
	if x != nil {
		return x.ClientState
	}
	return nil
}

func (x *MsgCreateClient) GetConsensusState() *anypb.Any {
	if x != nil {
		return x.ConsensusState
	}
	return nil
}

func (x *MsgCreateClient) GetSigner() string {
	if x != nil {
		return x.Signer
	}
	return ""
}

// MsgCreateClientResponse defines the Msg/CreateClient response type.
type MsgCreateClientResponse struct {
	state         protoimpl.MessageState
	sizeCache     protoimpl.SizeCache
	unknownFields protoimpl.UnknownFields

	UnsignedTx *anypb.Any `protobuf:"bytes,1,opt,name=unsigned_tx,json=unsignedTx,proto3" json:"unsigned_tx,omitempty"`
	ClientId   string     `protobuf:"bytes,2,opt,name=client_id,json=clientId,proto3" json:"client_id,omitempty"`
}

func (x *MsgCreateClientResponse) Reset() {
	*x = MsgCreateClientResponse{}
	if protoimpl.UnsafeEnabled {
		mi := &file_ibc_core_client_v1_tx_proto_msgTypes[1]
		ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
		ms.StoreMessageInfo(mi)
	}
}

func (x *MsgCreateClientResponse) String() string {
	return protoimpl.X.MessageStringOf(x)
}

func (*MsgCreateClientResponse) ProtoMessage() {}

func (x *MsgCreateClientResponse) ProtoReflect() protoreflect.Message {
	mi := &file_ibc_core_client_v1_tx_proto_msgTypes[1]
	if protoimpl.UnsafeEnabled && x != nil {
		ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
		if ms.LoadMessageInfo() == nil {
			ms.StoreMessageInfo(mi)
		}
		return ms
	}
	return mi.MessageOf(x)
}

// Deprecated: Use MsgCreateClientResponse.ProtoReflect.Descriptor instead.
func (*MsgCreateClientResponse) Descriptor() ([]byte, []int) {
	return file_ibc_core_client_v1_tx_proto_rawDescGZIP(), []int{1}
}

func (x *MsgCreateClientResponse) GetUnsignedTx() *anypb.Any {
	if x != nil {
		return x.UnsignedTx
	}
	return nil
}

func (x *MsgCreateClientResponse) GetClientId() string {
	if x != nil {
		return x.ClientId
	}
	return ""
}

// MsgUpdateClient defines an sdk.Msg to update a IBC client state using
// the given client message.
type MsgUpdateClient struct {
	state         protoimpl.MessageState
	sizeCache     protoimpl.SizeCache
	unknownFields protoimpl.UnknownFields

	// client unique identifier
	ClientId string `protobuf:"bytes,1,opt,name=client_id,json=clientId,proto3" json:"client_id,omitempty"`
	// client message to update the light client
	ClientMessage *anypb.Any `protobuf:"bytes,2,opt,name=client_message,json=clientMessage,proto3" json:"client_message,omitempty"`
	// signer address
	Signer string `protobuf:"bytes,3,opt,name=signer,proto3" json:"signer,omitempty"`
}

func (x *MsgUpdateClient) Reset() {
	*x = MsgUpdateClient{}
	if protoimpl.UnsafeEnabled {
		mi := &file_ibc_core_client_v1_tx_proto_msgTypes[2]
		ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
		ms.StoreMessageInfo(mi)
	}
}

func (x *MsgUpdateClient) String() string {
	return protoimpl.X.MessageStringOf(x)
}

func (*MsgUpdateClient) ProtoMessage() {}

func (x *MsgUpdateClient) ProtoReflect() protoreflect.Message {
	mi := &file_ibc_core_client_v1_tx_proto_msgTypes[2]
	if protoimpl.UnsafeEnabled && x != nil {
		ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
		if ms.LoadMessageInfo() == nil {
			ms.StoreMessageInfo(mi)
		}
		return ms
	}
	return mi.MessageOf(x)
}

// Deprecated: Use MsgUpdateClient.ProtoReflect.Descriptor instead.
func (*MsgUpdateClient) Descriptor() ([]byte, []int) {
	return file_ibc_core_client_v1_tx_proto_rawDescGZIP(), []int{2}
}

func (x *MsgUpdateClient) GetClientId() string {
	if x != nil {
		return x.ClientId
	}
	return ""
}

func (x *MsgUpdateClient) GetClientMessage() *anypb.Any {
	if x != nil {
		return x.ClientMessage
	}
	return nil
}

func (x *MsgUpdateClient) GetSigner() string {
	if x != nil {
		return x.Signer
	}
	return ""
}

// MsgUpdateClientResponse defines the Msg/UpdateClient response type.
type MsgUpdateClientResponse struct {
	state         protoimpl.MessageState
	sizeCache     protoimpl.SizeCache
	unknownFields protoimpl.UnknownFields

	UnsignedTx *anypb.Any `protobuf:"bytes,1,opt,name=unsigned_tx,json=unsignedTx,proto3" json:"unsigned_tx,omitempty"`
}

func (x *MsgUpdateClientResponse) Reset() {
	*x = MsgUpdateClientResponse{}
	if protoimpl.UnsafeEnabled {
		mi := &file_ibc_core_client_v1_tx_proto_msgTypes[3]
		ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
		ms.StoreMessageInfo(mi)
	}
}

func (x *MsgUpdateClientResponse) String() string {
	return protoimpl.X.MessageStringOf(x)
}

func (*MsgUpdateClientResponse) ProtoMessage() {}

func (x *MsgUpdateClientResponse) ProtoReflect() protoreflect.Message {
	mi := &file_ibc_core_client_v1_tx_proto_msgTypes[3]
	if protoimpl.UnsafeEnabled && x != nil {
		ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
		if ms.LoadMessageInfo() == nil {
			ms.StoreMessageInfo(mi)
		}
		return ms
	}
	return mi.MessageOf(x)
}

// Deprecated: Use MsgUpdateClientResponse.ProtoReflect.Descriptor instead.
func (*MsgUpdateClientResponse) Descriptor() ([]byte, []int) {
	return file_ibc_core_client_v1_tx_proto_rawDescGZIP(), []int{3}
}

func (x *MsgUpdateClientResponse) GetUnsignedTx() *anypb.Any {
	if x != nil {
		return x.UnsignedTx
	}
	return nil
}

// MsgUpgradeClient defines an sdk.Msg to upgrade an IBC client to a new client
// state
type MsgUpgradeClient struct {
	state         protoimpl.MessageState
	sizeCache     protoimpl.SizeCache
	unknownFields protoimpl.UnknownFields

	// client unique identifier
	ClientId string `protobuf:"bytes,1,opt,name=client_id,json=clientId,proto3" json:"client_id,omitempty"`
	// upgraded client state
	ClientState *anypb.Any `protobuf:"bytes,2,opt,name=client_state,json=clientState,proto3" json:"client_state,omitempty"`
	// upgraded consensus state, only contains enough information to serve as a
	// basis of trust in update logic
	ConsensusState *anypb.Any `protobuf:"bytes,3,opt,name=consensus_state,json=consensusState,proto3" json:"consensus_state,omitempty"`
	// proof that old chain committed to new client
	ProofUpgradeClient []byte `protobuf:"bytes,4,opt,name=proof_upgrade_client,json=proofUpgradeClient,proto3" json:"proof_upgrade_client,omitempty"`
	// proof that old chain committed to new consensus state
	ProofUpgradeConsensusState []byte `protobuf:"bytes,5,opt,name=proof_upgrade_consensus_state,json=proofUpgradeConsensusState,proto3" json:"proof_upgrade_consensus_state,omitempty"`
	// signer address
	Signer string `protobuf:"bytes,6,opt,name=signer,proto3" json:"signer,omitempty"`
}

func (x *MsgUpgradeClient) Reset() {
	*x = MsgUpgradeClient{}
	if protoimpl.UnsafeEnabled {
		mi := &file_ibc_core_client_v1_tx_proto_msgTypes[4]
		ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
		ms.StoreMessageInfo(mi)
	}
}

func (x *MsgUpgradeClient) String() string {
	return protoimpl.X.MessageStringOf(x)
}

func (*MsgUpgradeClient) ProtoMessage() {}

func (x *MsgUpgradeClient) ProtoReflect() protoreflect.Message {
	mi := &file_ibc_core_client_v1_tx_proto_msgTypes[4]
	if protoimpl.UnsafeEnabled && x != nil {
		ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
		if ms.LoadMessageInfo() == nil {
			ms.StoreMessageInfo(mi)
		}
		return ms
	}
	return mi.MessageOf(x)
}

// Deprecated: Use MsgUpgradeClient.ProtoReflect.Descriptor instead.
func (*MsgUpgradeClient) Descriptor() ([]byte, []int) {
	return file_ibc_core_client_v1_tx_proto_rawDescGZIP(), []int{4}
}

func (x *MsgUpgradeClient) GetClientId() string {
	if x != nil {
		return x.ClientId
	}
	return ""
}

func (x *MsgUpgradeClient) GetClientState() *anypb.Any {
	if x != nil {
		return x.ClientState
	}
	return nil
}

func (x *MsgUpgradeClient) GetConsensusState() *anypb.Any {
	if x != nil {
		return x.ConsensusState
	}
	return nil
}

func (x *MsgUpgradeClient) GetProofUpgradeClient() []byte {
	if x != nil {
		return x.ProofUpgradeClient
	}
	return nil
}

func (x *MsgUpgradeClient) GetProofUpgradeConsensusState() []byte {
	if x != nil {
		return x.ProofUpgradeConsensusState
	}
	return nil
}

func (x *MsgUpgradeClient) GetSigner() string {
	if x != nil {
		return x.Signer
	}
	return ""
}

// MsgUpgradeClientResponse defines the Msg/UpgradeClient response type.
type MsgUpgradeClientResponse struct {
	state         protoimpl.MessageState
	sizeCache     protoimpl.SizeCache
	unknownFields protoimpl.UnknownFields
}

func (x *MsgUpgradeClientResponse) Reset() {
	*x = MsgUpgradeClientResponse{}
	if protoimpl.UnsafeEnabled {
		mi := &file_ibc_core_client_v1_tx_proto_msgTypes[5]
		ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
		ms.StoreMessageInfo(mi)
	}
}

func (x *MsgUpgradeClientResponse) String() string {
	return protoimpl.X.MessageStringOf(x)
}

func (*MsgUpgradeClientResponse) ProtoMessage() {}

func (x *MsgUpgradeClientResponse) ProtoReflect() protoreflect.Message {
	mi := &file_ibc_core_client_v1_tx_proto_msgTypes[5]
	if protoimpl.UnsafeEnabled && x != nil {
		ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
		if ms.LoadMessageInfo() == nil {
			ms.StoreMessageInfo(mi)
		}
		return ms
	}
	return mi.MessageOf(x)
}

// Deprecated: Use MsgUpgradeClientResponse.ProtoReflect.Descriptor instead.
func (*MsgUpgradeClientResponse) Descriptor() ([]byte, []int) {
	return file_ibc_core_client_v1_tx_proto_rawDescGZIP(), []int{5}
}

// MsgSubmitMisbehaviour defines an sdk.Msg type that submits Evidence for
// light client misbehaviour.
// Warning: DEPRECATED
type MsgSubmitMisbehaviour struct {
	state         protoimpl.MessageState
	sizeCache     protoimpl.SizeCache
	unknownFields protoimpl.UnknownFields

	// client unique identifier
	//
	// Deprecated: Marked as deprecated in ibc/core/client/v1/tx.proto.
	ClientId string `protobuf:"bytes,1,opt,name=client_id,json=clientId,proto3" json:"client_id,omitempty"`
	// misbehaviour used for freezing the light client
	//
	// Deprecated: Marked as deprecated in ibc/core/client/v1/tx.proto.
	Misbehaviour *anypb.Any `protobuf:"bytes,2,opt,name=misbehaviour,proto3" json:"misbehaviour,omitempty"`
	// signer address
	//
	// Deprecated: Marked as deprecated in ibc/core/client/v1/tx.proto.
	Signer string `protobuf:"bytes,3,opt,name=signer,proto3" json:"signer,omitempty"`
}

func (x *MsgSubmitMisbehaviour) Reset() {
	*x = MsgSubmitMisbehaviour{}
	if protoimpl.UnsafeEnabled {
		mi := &file_ibc_core_client_v1_tx_proto_msgTypes[6]
		ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
		ms.StoreMessageInfo(mi)
	}
}

func (x *MsgSubmitMisbehaviour) String() string {
	return protoimpl.X.MessageStringOf(x)
}

func (*MsgSubmitMisbehaviour) ProtoMessage() {}

func (x *MsgSubmitMisbehaviour) ProtoReflect() protoreflect.Message {
	mi := &file_ibc_core_client_v1_tx_proto_msgTypes[6]
	if protoimpl.UnsafeEnabled && x != nil {
		ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
		if ms.LoadMessageInfo() == nil {
			ms.StoreMessageInfo(mi)
		}
		return ms
	}
	return mi.MessageOf(x)
}

// Deprecated: Use MsgSubmitMisbehaviour.ProtoReflect.Descriptor instead.
func (*MsgSubmitMisbehaviour) Descriptor() ([]byte, []int) {
	return file_ibc_core_client_v1_tx_proto_rawDescGZIP(), []int{6}
}

// Deprecated: Marked as deprecated in ibc/core/client/v1/tx.proto.
func (x *MsgSubmitMisbehaviour) GetClientId() string {
	if x != nil {
		return x.ClientId
	}
	return ""
}

// Deprecated: Marked as deprecated in ibc/core/client/v1/tx.proto.
func (x *MsgSubmitMisbehaviour) GetMisbehaviour() *anypb.Any {
	if x != nil {
		return x.Misbehaviour
	}
	return nil
}

// Deprecated: Marked as deprecated in ibc/core/client/v1/tx.proto.
func (x *MsgSubmitMisbehaviour) GetSigner() string {
	if x != nil {
		return x.Signer
	}
	return ""
}

// MsgSubmitMisbehaviourResponse defines the Msg/SubmitMisbehaviour response
// type.
type MsgSubmitMisbehaviourResponse struct {
	state         protoimpl.MessageState
	sizeCache     protoimpl.SizeCache
	unknownFields protoimpl.UnknownFields
}

func (x *MsgSubmitMisbehaviourResponse) Reset() {
	*x = MsgSubmitMisbehaviourResponse{}
	if protoimpl.UnsafeEnabled {
		mi := &file_ibc_core_client_v1_tx_proto_msgTypes[7]
		ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
		ms.StoreMessageInfo(mi)
	}
}

func (x *MsgSubmitMisbehaviourResponse) String() string {
	return protoimpl.X.MessageStringOf(x)
}

func (*MsgSubmitMisbehaviourResponse) ProtoMessage() {}

func (x *MsgSubmitMisbehaviourResponse) ProtoReflect() protoreflect.Message {
	mi := &file_ibc_core_client_v1_tx_proto_msgTypes[7]
	if protoimpl.UnsafeEnabled && x != nil {
		ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
		if ms.LoadMessageInfo() == nil {
			ms.StoreMessageInfo(mi)
		}
		return ms
	}
	return mi.MessageOf(x)
}

// Deprecated: Use MsgSubmitMisbehaviourResponse.ProtoReflect.Descriptor instead.
func (*MsgSubmitMisbehaviourResponse) Descriptor() ([]byte, []int) {
	return file_ibc_core_client_v1_tx_proto_rawDescGZIP(), []int{7}
}

var File_ibc_core_client_v1_tx_proto protoreflect.FileDescriptor

var file_ibc_core_client_v1_tx_proto_rawDesc = []byte{
	0x0a, 0x1b, 0x69, 0x62, 0x63, 0x2f, 0x63, 0x6f, 0x72, 0x65, 0x2f, 0x63, 0x6c, 0x69, 0x65, 0x6e,
	0x74, 0x2f, 0x76, 0x31, 0x2f, 0x74, 0x78, 0x2e, 0x70, 0x72, 0x6f, 0x74, 0x6f, 0x12, 0x12, 0x69,
	0x62, 0x63, 0x2e, 0x63, 0x6f, 0x72, 0x65, 0x2e, 0x63, 0x6c, 0x69, 0x65, 0x6e, 0x74, 0x2e, 0x76,
	0x31, 0x1a, 0x14, 0x67, 0x6f, 0x67, 0x6f, 0x70, 0x72, 0x6f, 0x74, 0x6f, 0x2f, 0x67, 0x6f, 0x67,
	0x6f, 0x2e, 0x70, 0x72, 0x6f, 0x74, 0x6f, 0x1a, 0x19, 0x67, 0x6f, 0x6f, 0x67, 0x6c, 0x65, 0x2f,
	0x70, 0x72, 0x6f, 0x74, 0x6f, 0x62, 0x75, 0x66, 0x2f, 0x61, 0x6e, 0x79, 0x2e, 0x70, 0x72, 0x6f,
	0x74, 0x6f, 0x22, 0xe0, 0x01, 0x0a, 0x0f, 0x4d, 0x73, 0x67, 0x43, 0x72, 0x65, 0x61, 0x74, 0x65,
	0x43, 0x6c, 0x69, 0x65, 0x6e, 0x74, 0x12, 0x50, 0x0a, 0x0c, 0x63, 0x6c, 0x69, 0x65, 0x6e, 0x74,
	0x5f, 0x73, 0x74, 0x61, 0x74, 0x65, 0x18, 0x01, 0x20, 0x01, 0x28, 0x0b, 0x32, 0x14, 0x2e, 0x67,
	0x6f, 0x6f, 0x67, 0x6c, 0x65, 0x2e, 0x70, 0x72, 0x6f, 0x74, 0x6f, 0x62, 0x75, 0x66, 0x2e, 0x41,
	0x6e, 0x79, 0x42, 0x17, 0xf2, 0xde, 0x1f, 0x13, 0x79, 0x61, 0x6d, 0x6c, 0x3a, 0x22, 0x63, 0x6c,
	0x69, 0x65, 0x6e, 0x74, 0x5f, 0x73, 0x74, 0x61, 0x74, 0x65, 0x22, 0x52, 0x0b, 0x63, 0x6c, 0x69,
	0x65, 0x6e, 0x74, 0x53, 0x74, 0x61, 0x74, 0x65, 0x12, 0x59, 0x0a, 0x0f, 0x63, 0x6f, 0x6e, 0x73,
	0x65, 0x6e, 0x73, 0x75, 0x73, 0x5f, 0x73, 0x74, 0x61, 0x74, 0x65, 0x18, 0x02, 0x20, 0x01, 0x28,
	0x0b, 0x32, 0x14, 0x2e, 0x67, 0x6f, 0x6f, 0x67, 0x6c, 0x65, 0x2e, 0x70, 0x72, 0x6f, 0x74, 0x6f,
	0x62, 0x75, 0x66, 0x2e, 0x41, 0x6e, 0x79, 0x42, 0x1a, 0xf2, 0xde, 0x1f, 0x16, 0x79, 0x61, 0x6d,
	0x6c, 0x3a, 0x22, 0x63, 0x6f, 0x6e, 0x73, 0x65, 0x6e, 0x73, 0x75, 0x73, 0x5f, 0x73, 0x74, 0x61,
	0x74, 0x65, 0x22, 0x52, 0x0e, 0x63, 0x6f, 0x6e, 0x73, 0x65, 0x6e, 0x73, 0x75, 0x73, 0x53, 0x74,
	0x61, 0x74, 0x65, 0x12, 0x16, 0x0a, 0x06, 0x73, 0x69, 0x67, 0x6e, 0x65, 0x72, 0x18, 0x03, 0x20,
	0x01, 0x28, 0x09, 0x52, 0x06, 0x73, 0x69, 0x67, 0x6e, 0x65, 0x72, 0x3a, 0x08, 0x88, 0xa0, 0x1f,
	0x00, 0xe8, 0xa0, 0x1f, 0x00, 0x22, 0x6d, 0x0a, 0x17, 0x4d, 0x73, 0x67, 0x43, 0x72, 0x65, 0x61,
	0x74, 0x65, 0x43, 0x6c, 0x69, 0x65, 0x6e, 0x74, 0x52, 0x65, 0x73, 0x70, 0x6f, 0x6e, 0x73, 0x65,
	0x12, 0x35, 0x0a, 0x0b, 0x75, 0x6e, 0x73, 0x69, 0x67, 0x6e, 0x65, 0x64, 0x5f, 0x74, 0x78, 0x18,
	0x01, 0x20, 0x01, 0x28, 0x0b, 0x32, 0x14, 0x2e, 0x67, 0x6f, 0x6f, 0x67, 0x6c, 0x65, 0x2e, 0x70,
	0x72, 0x6f, 0x74, 0x6f, 0x62, 0x75, 0x66, 0x2e, 0x41, 0x6e, 0x79, 0x52, 0x0a, 0x75, 0x6e, 0x73,
	0x69, 0x67, 0x6e, 0x65, 0x64, 0x54, 0x78, 0x12, 0x1b, 0x0a, 0x09, 0x63, 0x6c, 0x69, 0x65, 0x6e,
	0x74, 0x5f, 0x69, 0x64, 0x18, 0x02, 0x20, 0x01, 0x28, 0x09, 0x52, 0x08, 0x63, 0x6c, 0x69, 0x65,
	0x6e, 0x74, 0x49, 0x64, 0x22, 0xa3, 0x01, 0x0a, 0x0f, 0x4d, 0x73, 0x67, 0x55, 0x70, 0x64, 0x61,
	0x74, 0x65, 0x43, 0x6c, 0x69, 0x65, 0x6e, 0x74, 0x12, 0x31, 0x0a, 0x09, 0x63, 0x6c, 0x69, 0x65,
	0x6e, 0x74, 0x5f, 0x69, 0x64, 0x18, 0x01, 0x20, 0x01, 0x28, 0x09, 0x42, 0x14, 0xf2, 0xde, 0x1f,
	0x10, 0x79, 0x61, 0x6d, 0x6c, 0x3a, 0x22, 0x63, 0x6c, 0x69, 0x65, 0x6e, 0x74, 0x5f, 0x69, 0x64,
	0x22, 0x52, 0x08, 0x63, 0x6c, 0x69, 0x65, 0x6e, 0x74, 0x49, 0x64, 0x12, 0x3b, 0x0a, 0x0e, 0x63,
	0x6c, 0x69, 0x65, 0x6e, 0x74, 0x5f, 0x6d, 0x65, 0x73, 0x73, 0x61, 0x67, 0x65, 0x18, 0x02, 0x20,
	0x01, 0x28, 0x0b, 0x32, 0x14, 0x2e, 0x67, 0x6f, 0x6f, 0x67, 0x6c, 0x65, 0x2e, 0x70, 0x72, 0x6f,
	0x74, 0x6f, 0x62, 0x75, 0x66, 0x2e, 0x41, 0x6e, 0x79, 0x52, 0x0d, 0x63, 0x6c, 0x69, 0x65, 0x6e,
	0x74, 0x4d, 0x65, 0x73, 0x73, 0x61, 0x67, 0x65, 0x12, 0x16, 0x0a, 0x06, 0x73, 0x69, 0x67, 0x6e,
	0x65, 0x72, 0x18, 0x03, 0x20, 0x01, 0x28, 0x09, 0x52, 0x06, 0x73, 0x69, 0x67, 0x6e, 0x65, 0x72,
	0x3a, 0x08, 0x88, 0xa0, 0x1f, 0x00, 0xe8, 0xa0, 0x1f, 0x00, 0x22, 0x50, 0x0a, 0x17, 0x4d, 0x73,
	0x67, 0x55, 0x70, 0x64, 0x61, 0x74, 0x65, 0x43, 0x6c, 0x69, 0x65, 0x6e, 0x74, 0x52, 0x65, 0x73,
	0x70, 0x6f, 0x6e, 0x73, 0x65, 0x12, 0x35, 0x0a, 0x0b, 0x75, 0x6e, 0x73, 0x69, 0x67, 0x6e, 0x65,
	0x64, 0x5f, 0x74, 0x78, 0x18, 0x01, 0x20, 0x01, 0x28, 0x0b, 0x32, 0x14, 0x2e, 0x67, 0x6f, 0x6f,
	0x67, 0x6c, 0x65, 0x2e, 0x70, 0x72, 0x6f, 0x74, 0x6f, 0x62, 0x75, 0x66, 0x2e, 0x41, 0x6e, 0x79,
	0x52, 0x0a, 0x75, 0x6e, 0x73, 0x69, 0x67, 0x6e, 0x65, 0x64, 0x54, 0x78, 0x22, 0xd4, 0x03, 0x0a,
	0x10, 0x4d, 0x73, 0x67, 0x55, 0x70, 0x67, 0x72, 0x61, 0x64, 0x65, 0x43, 0x6c, 0x69, 0x65, 0x6e,
	0x74, 0x12, 0x31, 0x0a, 0x09, 0x63, 0x6c, 0x69, 0x65, 0x6e, 0x74, 0x5f, 0x69, 0x64, 0x18, 0x01,
	0x20, 0x01, 0x28, 0x09, 0x42, 0x14, 0xf2, 0xde, 0x1f, 0x10, 0x79, 0x61, 0x6d, 0x6c, 0x3a, 0x22,
	0x63, 0x6c, 0x69, 0x65, 0x6e, 0x74, 0x5f, 0x69, 0x64, 0x22, 0x52, 0x08, 0x63, 0x6c, 0x69, 0x65,
	0x6e, 0x74, 0x49, 0x64, 0x12, 0x50, 0x0a, 0x0c, 0x63, 0x6c, 0x69, 0x65, 0x6e, 0x74, 0x5f, 0x73,
	0x74, 0x61, 0x74, 0x65, 0x18, 0x02, 0x20, 0x01, 0x28, 0x0b, 0x32, 0x14, 0x2e, 0x67, 0x6f, 0x6f,
	0x67, 0x6c, 0x65, 0x2e, 0x70, 0x72, 0x6f, 0x74, 0x6f, 0x62, 0x75, 0x66, 0x2e, 0x41, 0x6e, 0x79,
	0x42, 0x17, 0xf2, 0xde, 0x1f, 0x13, 0x79, 0x61, 0x6d, 0x6c, 0x3a, 0x22, 0x63, 0x6c, 0x69, 0x65,
	0x6e, 0x74, 0x5f, 0x73, 0x74, 0x61, 0x74, 0x65, 0x22, 0x52, 0x0b, 0x63, 0x6c, 0x69, 0x65, 0x6e,
	0x74, 0x53, 0x74, 0x61, 0x74, 0x65, 0x12, 0x59, 0x0a, 0x0f, 0x63, 0x6f, 0x6e, 0x73, 0x65, 0x6e,
	0x73, 0x75, 0x73, 0x5f, 0x73, 0x74, 0x61, 0x74, 0x65, 0x18, 0x03, 0x20, 0x01, 0x28, 0x0b, 0x32,
	0x14, 0x2e, 0x67, 0x6f, 0x6f, 0x67, 0x6c, 0x65, 0x2e, 0x70, 0x72, 0x6f, 0x74, 0x6f, 0x62, 0x75,
	0x66, 0x2e, 0x41, 0x6e, 0x79, 0x42, 0x1a, 0xf2, 0xde, 0x1f, 0x16, 0x79, 0x61, 0x6d, 0x6c, 0x3a,
	0x22, 0x63, 0x6f, 0x6e, 0x73, 0x65, 0x6e, 0x73, 0x75, 0x73, 0x5f, 0x73, 0x74, 0x61, 0x74, 0x65,
	0x22, 0x52, 0x0e, 0x63, 0x6f, 0x6e, 0x73, 0x65, 0x6e, 0x73, 0x75, 0x73, 0x53, 0x74, 0x61, 0x74,
	0x65, 0x12, 0x51, 0x0a, 0x14, 0x70, 0x72, 0x6f, 0x6f, 0x66, 0x5f, 0x75, 0x70, 0x67, 0x72, 0x61,
	0x64, 0x65, 0x5f, 0x63, 0x6c, 0x69, 0x65, 0x6e, 0x74, 0x18, 0x04, 0x20, 0x01, 0x28, 0x0c, 0x42,
	0x1f, 0xf2, 0xde, 0x1f, 0x1b, 0x79, 0x61, 0x6d, 0x6c, 0x3a, 0x22, 0x70, 0x72, 0x6f, 0x6f, 0x66,
	0x5f, 0x75, 0x70, 0x67, 0x72, 0x61, 0x64, 0x65, 0x5f, 0x63, 0x6c, 0x69, 0x65, 0x6e, 0x74, 0x22,
	0x52, 0x12, 0x70, 0x72, 0x6f, 0x6f, 0x66, 0x55, 0x70, 0x67, 0x72, 0x61, 0x64, 0x65, 0x43, 0x6c,
	0x69, 0x65, 0x6e, 0x74, 0x12, 0x6b, 0x0a, 0x1d, 0x70, 0x72, 0x6f, 0x6f, 0x66, 0x5f, 0x75, 0x70,
	0x67, 0x72, 0x61, 0x64, 0x65, 0x5f, 0x63, 0x6f, 0x6e, 0x73, 0x65, 0x6e, 0x73, 0x75, 0x73, 0x5f,
	0x73, 0x74, 0x61, 0x74, 0x65, 0x18, 0x05, 0x20, 0x01, 0x28, 0x0c, 0x42, 0x28, 0xf2, 0xde, 0x1f,
	0x24, 0x79, 0x61, 0x6d, 0x6c, 0x3a, 0x22, 0x70, 0x72, 0x6f, 0x6f, 0x66, 0x5f, 0x75, 0x70, 0x67,
	0x72, 0x61, 0x64, 0x65, 0x5f, 0x63, 0x6f, 0x6e, 0x73, 0x65, 0x6e, 0x73, 0x75, 0x73, 0x5f, 0x73,
	0x74, 0x61, 0x74, 0x65, 0x22, 0x52, 0x1a, 0x70, 0x72, 0x6f, 0x6f, 0x66, 0x55, 0x70, 0x67, 0x72,
	0x61, 0x64, 0x65, 0x43, 0x6f, 0x6e, 0x73, 0x65, 0x6e, 0x73, 0x75, 0x73, 0x53, 0x74, 0x61, 0x74,
	0x65, 0x12, 0x16, 0x0a, 0x06, 0x73, 0x69, 0x67, 0x6e, 0x65, 0x72, 0x18, 0x06, 0x20, 0x01, 0x28,
	0x09, 0x52, 0x06, 0x73, 0x69, 0x67, 0x6e, 0x65, 0x72, 0x3a, 0x08, 0x88, 0xa0, 0x1f, 0x00, 0xe8,
	0xa0, 0x1f, 0x00, 0x22, 0x1a, 0x0a, 0x18, 0x4d, 0x73, 0x67, 0x55, 0x70, 0x67, 0x72, 0x61, 0x64,
	0x65, 0x43, 0x6c, 0x69, 0x65, 0x6e, 0x74, 0x52, 0x65, 0x73, 0x70, 0x6f, 0x6e, 0x73, 0x65, 0x22,
	0xb0, 0x01, 0x0a, 0x15, 0x4d, 0x73, 0x67, 0x53, 0x75, 0x62, 0x6d, 0x69, 0x74, 0x4d, 0x69, 0x73,
	0x62, 0x65, 0x68, 0x61, 0x76, 0x69, 0x6f, 0x75, 0x72, 0x12, 0x33, 0x0a, 0x09, 0x63, 0x6c, 0x69,
	0x65, 0x6e, 0x74, 0x5f, 0x69, 0x64, 0x18, 0x01, 0x20, 0x01, 0x28, 0x09, 0x42, 0x16, 0xf2, 0xde,
	0x1f, 0x10, 0x79, 0x61, 0x6d, 0x6c, 0x3a, 0x22, 0x63, 0x6c, 0x69, 0x65, 0x6e, 0x74, 0x5f, 0x69,
	0x64, 0x22, 0x18, 0x01, 0x52, 0x08, 0x63, 0x6c, 0x69, 0x65, 0x6e, 0x74, 0x49, 0x64, 0x12, 0x3c,
	0x0a, 0x0c, 0x6d, 0x69, 0x73, 0x62, 0x65, 0x68, 0x61, 0x76, 0x69, 0x6f, 0x75, 0x72, 0x18, 0x02,
	0x20, 0x01, 0x28, 0x0b, 0x32, 0x14, 0x2e, 0x67, 0x6f, 0x6f, 0x67, 0x6c, 0x65, 0x2e, 0x70, 0x72,
	0x6f, 0x74, 0x6f, 0x62, 0x75, 0x66, 0x2e, 0x41, 0x6e, 0x79, 0x42, 0x02, 0x18, 0x01, 0x52, 0x0c,
	0x6d, 0x69, 0x73, 0x62, 0x65, 0x68, 0x61, 0x76, 0x69, 0x6f, 0x75, 0x72, 0x12, 0x1a, 0x0a, 0x06,
	0x73, 0x69, 0x67, 0x6e, 0x65, 0x72, 0x18, 0x03, 0x20, 0x01, 0x28, 0x09, 0x42, 0x02, 0x18, 0x01,
	0x52, 0x06, 0x73, 0x69, 0x67, 0x6e, 0x65, 0x72, 0x3a, 0x08, 0x88, 0xa0, 0x1f, 0x00, 0xe8, 0xa0,
	0x1f, 0x00, 0x22, 0x1f, 0x0a, 0x1d, 0x4d, 0x73, 0x67, 0x53, 0x75, 0x62, 0x6d, 0x69, 0x74, 0x4d,
	0x69, 0x73, 0x62, 0x65, 0x68, 0x61, 0x76, 0x69, 0x6f, 0x75, 0x72, 0x52, 0x65, 0x73, 0x70, 0x6f,
	0x6e, 0x73, 0x65, 0x32, 0xa2, 0x03, 0x0a, 0x03, 0x4d, 0x73, 0x67, 0x12, 0x60, 0x0a, 0x0c, 0x43,
	0x72, 0x65, 0x61, 0x74, 0x65, 0x43, 0x6c, 0x69, 0x65, 0x6e, 0x74, 0x12, 0x23, 0x2e, 0x69, 0x62,
	0x63, 0x2e, 0x63, 0x6f, 0x72, 0x65, 0x2e, 0x63, 0x6c, 0x69, 0x65, 0x6e, 0x74, 0x2e, 0x76, 0x31,
	0x2e, 0x4d, 0x73, 0x67, 0x43, 0x72, 0x65, 0x61, 0x74, 0x65, 0x43, 0x6c, 0x69, 0x65, 0x6e, 0x74,
	0x1a, 0x2b, 0x2e, 0x69, 0x62, 0x63, 0x2e, 0x63, 0x6f, 0x72, 0x65, 0x2e, 0x63, 0x6c, 0x69, 0x65,
	0x6e, 0x74, 0x2e, 0x76, 0x31, 0x2e, 0x4d, 0x73, 0x67, 0x43, 0x72, 0x65, 0x61, 0x74, 0x65, 0x43,
	0x6c, 0x69, 0x65, 0x6e, 0x74, 0x52, 0x65, 0x73, 0x70, 0x6f, 0x6e, 0x73, 0x65, 0x12, 0x60, 0x0a,
	0x0c, 0x55, 0x70, 0x64, 0x61, 0x74, 0x65, 0x43, 0x6c, 0x69, 0x65, 0x6e, 0x74, 0x12, 0x23, 0x2e,
	0x69, 0x62, 0x63, 0x2e, 0x63, 0x6f, 0x72, 0x65, 0x2e, 0x63, 0x6c, 0x69, 0x65, 0x6e, 0x74, 0x2e,
	0x76, 0x31, 0x2e, 0x4d, 0x73, 0x67, 0x55, 0x70, 0x64, 0x61, 0x74, 0x65, 0x43, 0x6c, 0x69, 0x65,
	0x6e, 0x74, 0x1a, 0x2b, 0x2e, 0x69, 0x62, 0x63, 0x2e, 0x63, 0x6f, 0x72, 0x65, 0x2e, 0x63, 0x6c,
	0x69, 0x65, 0x6e, 0x74, 0x2e, 0x76, 0x31, 0x2e, 0x4d, 0x73, 0x67, 0x55, 0x70, 0x64, 0x61, 0x74,
	0x65, 0x43, 0x6c, 0x69, 0x65, 0x6e, 0x74, 0x52, 0x65, 0x73, 0x70, 0x6f, 0x6e, 0x73, 0x65, 0x12,
	0x63, 0x0a, 0x0d, 0x55, 0x70, 0x67, 0x72, 0x61, 0x64, 0x65, 0x43, 0x6c, 0x69, 0x65, 0x6e, 0x74,
	0x12, 0x24, 0x2e, 0x69, 0x62, 0x63, 0x2e, 0x63, 0x6f, 0x72, 0x65, 0x2e, 0x63, 0x6c, 0x69, 0x65,
	0x6e, 0x74, 0x2e, 0x76, 0x31, 0x2e, 0x4d, 0x73, 0x67, 0x55, 0x70, 0x67, 0x72, 0x61, 0x64, 0x65,
	0x43, 0x6c, 0x69, 0x65, 0x6e, 0x74, 0x1a, 0x2c, 0x2e, 0x69, 0x62, 0x63, 0x2e, 0x63, 0x6f, 0x72,
	0x65, 0x2e, 0x63, 0x6c, 0x69, 0x65, 0x6e, 0x74, 0x2e, 0x76, 0x31, 0x2e, 0x4d, 0x73, 0x67, 0x55,
	0x70, 0x67, 0x72, 0x61, 0x64, 0x65, 0x43, 0x6c, 0x69, 0x65, 0x6e, 0x74, 0x52, 0x65, 0x73, 0x70,
	0x6f, 0x6e, 0x73, 0x65, 0x12, 0x72, 0x0a, 0x12, 0x53, 0x75, 0x62, 0x6d, 0x69, 0x74, 0x4d, 0x69,
	0x73, 0x62, 0x65, 0x68, 0x61, 0x76, 0x69, 0x6f, 0x75, 0x72, 0x12, 0x29, 0x2e, 0x69, 0x62, 0x63,
	0x2e, 0x63, 0x6f, 0x72, 0x65, 0x2e, 0x63, 0x6c, 0x69, 0x65, 0x6e, 0x74, 0x2e, 0x76, 0x31, 0x2e,
	0x4d, 0x73, 0x67, 0x53, 0x75, 0x62, 0x6d, 0x69, 0x74, 0x4d, 0x69, 0x73, 0x62, 0x65, 0x68, 0x61,
	0x76, 0x69, 0x6f, 0x75, 0x72, 0x1a, 0x31, 0x2e, 0x69, 0x62, 0x63, 0x2e, 0x63, 0x6f, 0x72, 0x65,
	0x2e, 0x63, 0x6c, 0x69, 0x65, 0x6e, 0x74, 0x2e, 0x76, 0x31, 0x2e, 0x4d, 0x73, 0x67, 0x53, 0x75,
	0x62, 0x6d, 0x69, 0x74, 0x4d, 0x69, 0x73, 0x62, 0x65, 0x68, 0x61, 0x76, 0x69, 0x6f, 0x75, 0x72,
	0x52, 0x65, 0x73, 0x70, 0x6f, 0x6e, 0x73, 0x65, 0x42, 0x3a, 0x5a, 0x38, 0x67, 0x69, 0x74, 0x68,
	0x75, 0x62, 0x2e, 0x63, 0x6f, 0x6d, 0x2f, 0x63, 0x6f, 0x73, 0x6d, 0x6f, 0x73, 0x2f, 0x69, 0x62,
	0x63, 0x2d, 0x67, 0x6f, 0x2f, 0x76, 0x37, 0x2f, 0x6d, 0x6f, 0x64, 0x75, 0x6c, 0x65, 0x73, 0x2f,
	0x63, 0x6f, 0x72, 0x65, 0x2f, 0x30, 0x32, 0x2d, 0x63, 0x6c, 0x69, 0x65, 0x6e, 0x74, 0x2f, 0x74,
	0x79, 0x70, 0x65, 0x73, 0x62, 0x06, 0x70, 0x72, 0x6f, 0x74, 0x6f, 0x33,
}

var (
	file_ibc_core_client_v1_tx_proto_rawDescOnce sync.Once
	file_ibc_core_client_v1_tx_proto_rawDescData = file_ibc_core_client_v1_tx_proto_rawDesc
)

func file_ibc_core_client_v1_tx_proto_rawDescGZIP() []byte {
	file_ibc_core_client_v1_tx_proto_rawDescOnce.Do(func() {
		file_ibc_core_client_v1_tx_proto_rawDescData = protoimpl.X.CompressGZIP(file_ibc_core_client_v1_tx_proto_rawDescData)
	})
	return file_ibc_core_client_v1_tx_proto_rawDescData
}

var file_ibc_core_client_v1_tx_proto_msgTypes = make([]protoimpl.MessageInfo, 8)
var file_ibc_core_client_v1_tx_proto_goTypes = []interface{}{
	(*MsgCreateClient)(nil),               // 0: ibc.core.client.v1.MsgCreateClient
	(*MsgCreateClientResponse)(nil),       // 1: ibc.core.client.v1.MsgCreateClientResponse
	(*MsgUpdateClient)(nil),               // 2: ibc.core.client.v1.MsgUpdateClient
	(*MsgUpdateClientResponse)(nil),       // 3: ibc.core.client.v1.MsgUpdateClientResponse
	(*MsgUpgradeClient)(nil),              // 4: ibc.core.client.v1.MsgUpgradeClient
	(*MsgUpgradeClientResponse)(nil),      // 5: ibc.core.client.v1.MsgUpgradeClientResponse
	(*MsgSubmitMisbehaviour)(nil),         // 6: ibc.core.client.v1.MsgSubmitMisbehaviour
	(*MsgSubmitMisbehaviourResponse)(nil), // 7: ibc.core.client.v1.MsgSubmitMisbehaviourResponse
	(*anypb.Any)(nil),                     // 8: google.protobuf.Any
}
var file_ibc_core_client_v1_tx_proto_depIdxs = []int32{
	8,  // 0: ibc.core.client.v1.MsgCreateClient.client_state:type_name -> google.protobuf.Any
	8,  // 1: ibc.core.client.v1.MsgCreateClient.consensus_state:type_name -> google.protobuf.Any
	8,  // 2: ibc.core.client.v1.MsgCreateClientResponse.unsigned_tx:type_name -> google.protobuf.Any
	8,  // 3: ibc.core.client.v1.MsgUpdateClient.client_message:type_name -> google.protobuf.Any
	8,  // 4: ibc.core.client.v1.MsgUpdateClientResponse.unsigned_tx:type_name -> google.protobuf.Any
	8,  // 5: ibc.core.client.v1.MsgUpgradeClient.client_state:type_name -> google.protobuf.Any
	8,  // 6: ibc.core.client.v1.MsgUpgradeClient.consensus_state:type_name -> google.protobuf.Any
	8,  // 7: ibc.core.client.v1.MsgSubmitMisbehaviour.misbehaviour:type_name -> google.protobuf.Any
	0,  // 8: ibc.core.client.v1.Msg.CreateClient:input_type -> ibc.core.client.v1.MsgCreateClient
	2,  // 9: ibc.core.client.v1.Msg.UpdateClient:input_type -> ibc.core.client.v1.MsgUpdateClient
	4,  // 10: ibc.core.client.v1.Msg.UpgradeClient:input_type -> ibc.core.client.v1.MsgUpgradeClient
	6,  // 11: ibc.core.client.v1.Msg.SubmitMisbehaviour:input_type -> ibc.core.client.v1.MsgSubmitMisbehaviour
	1,  // 12: ibc.core.client.v1.Msg.CreateClient:output_type -> ibc.core.client.v1.MsgCreateClientResponse
	3,  // 13: ibc.core.client.v1.Msg.UpdateClient:output_type -> ibc.core.client.v1.MsgUpdateClientResponse
	5,  // 14: ibc.core.client.v1.Msg.UpgradeClient:output_type -> ibc.core.client.v1.MsgUpgradeClientResponse
	7,  // 15: ibc.core.client.v1.Msg.SubmitMisbehaviour:output_type -> ibc.core.client.v1.MsgSubmitMisbehaviourResponse
	12, // [12:16] is the sub-list for method output_type
	8,  // [8:12] is the sub-list for method input_type
	8,  // [8:8] is the sub-list for extension type_name
	8,  // [8:8] is the sub-list for extension extendee
	0,  // [0:8] is the sub-list for field type_name
}

func init() { file_ibc_core_client_v1_tx_proto_init() }
func file_ibc_core_client_v1_tx_proto_init() {
	if File_ibc_core_client_v1_tx_proto != nil {
		return
	}
	if !protoimpl.UnsafeEnabled {
		file_ibc_core_client_v1_tx_proto_msgTypes[0].Exporter = func(v interface{}, i int) interface{} {
			switch v := v.(*MsgCreateClient); i {
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
		file_ibc_core_client_v1_tx_proto_msgTypes[1].Exporter = func(v interface{}, i int) interface{} {
			switch v := v.(*MsgCreateClientResponse); i {
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
		file_ibc_core_client_v1_tx_proto_msgTypes[2].Exporter = func(v interface{}, i int) interface{} {
			switch v := v.(*MsgUpdateClient); i {
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
		file_ibc_core_client_v1_tx_proto_msgTypes[3].Exporter = func(v interface{}, i int) interface{} {
			switch v := v.(*MsgUpdateClientResponse); i {
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
		file_ibc_core_client_v1_tx_proto_msgTypes[4].Exporter = func(v interface{}, i int) interface{} {
			switch v := v.(*MsgUpgradeClient); i {
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
		file_ibc_core_client_v1_tx_proto_msgTypes[5].Exporter = func(v interface{}, i int) interface{} {
			switch v := v.(*MsgUpgradeClientResponse); i {
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
		file_ibc_core_client_v1_tx_proto_msgTypes[6].Exporter = func(v interface{}, i int) interface{} {
			switch v := v.(*MsgSubmitMisbehaviour); i {
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
		file_ibc_core_client_v1_tx_proto_msgTypes[7].Exporter = func(v interface{}, i int) interface{} {
			switch v := v.(*MsgSubmitMisbehaviourResponse); i {
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
			RawDescriptor: file_ibc_core_client_v1_tx_proto_rawDesc,
			NumEnums:      0,
			NumMessages:   8,
			NumExtensions: 0,
			NumServices:   1,
		},
		GoTypes:           file_ibc_core_client_v1_tx_proto_goTypes,
		DependencyIndexes: file_ibc_core_client_v1_tx_proto_depIdxs,
		MessageInfos:      file_ibc_core_client_v1_tx_proto_msgTypes,
	}.Build()
	File_ibc_core_client_v1_tx_proto = out.File
	file_ibc_core_client_v1_tx_proto_rawDesc = nil
	file_ibc_core_client_v1_tx_proto_goTypes = nil
	file_ibc_core_client_v1_tx_proto_depIdxs = nil
}
