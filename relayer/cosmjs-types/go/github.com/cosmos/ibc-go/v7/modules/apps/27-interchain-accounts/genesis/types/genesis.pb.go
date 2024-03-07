// Code generated by protoc-gen-go. DO NOT EDIT.
// versions:
// 	protoc-gen-go v1.25.0-devel
// 	protoc        (unknown)
// source: ibc/applications/interchain_accounts/genesis/v1/genesis.proto

package types

import (
	_ "github.com/cosmos/gogoproto/gogoproto"
	types "github.com/cosmos/ibc-go/v7/modules/apps/27-interchain-accounts/controller/types"
	types1 "github.com/cosmos/ibc-go/v7/modules/apps/27-interchain-accounts/host/types"
	protoreflect "google.golang.org/protobuf/reflect/protoreflect"
	protoimpl "google.golang.org/protobuf/runtime/protoimpl"
	reflect "reflect"
	sync "sync"
)

const (
	// Verify that this generated code is sufficiently up-to-date.
	_ = protoimpl.EnforceVersion(20 - protoimpl.MinVersion)
	// Verify that runtime/protoimpl is sufficiently up-to-date.
	_ = protoimpl.EnforceVersion(protoimpl.MaxVersion - 20)
)

// GenesisState defines the interchain accounts genesis state
type GenesisState struct {
	state         protoimpl.MessageState
	sizeCache     protoimpl.SizeCache
	unknownFields protoimpl.UnknownFields

	ControllerGenesisState *ControllerGenesisState `protobuf:"bytes,1,opt,name=controller_genesis_state,json=controllerGenesisState,proto3" json:"controller_genesis_state,omitempty"`
	HostGenesisState       *HostGenesisState       `protobuf:"bytes,2,opt,name=host_genesis_state,json=hostGenesisState,proto3" json:"host_genesis_state,omitempty"`
}

func (x *GenesisState) Reset() {
	*x = GenesisState{}
	if protoimpl.UnsafeEnabled {
		mi := &file_ibc_applications_interchain_accounts_genesis_v1_genesis_proto_msgTypes[0]
		ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
		ms.StoreMessageInfo(mi)
	}
}

func (x *GenesisState) String() string {
	return protoimpl.X.MessageStringOf(x)
}

func (*GenesisState) ProtoMessage() {}

func (x *GenesisState) ProtoReflect() protoreflect.Message {
	mi := &file_ibc_applications_interchain_accounts_genesis_v1_genesis_proto_msgTypes[0]
	if protoimpl.UnsafeEnabled && x != nil {
		ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
		if ms.LoadMessageInfo() == nil {
			ms.StoreMessageInfo(mi)
		}
		return ms
	}
	return mi.MessageOf(x)
}

// Deprecated: Use GenesisState.ProtoReflect.Descriptor instead.
func (*GenesisState) Descriptor() ([]byte, []int) {
	return file_ibc_applications_interchain_accounts_genesis_v1_genesis_proto_rawDescGZIP(), []int{0}
}

func (x *GenesisState) GetControllerGenesisState() *ControllerGenesisState {
	if x != nil {
		return x.ControllerGenesisState
	}
	return nil
}

func (x *GenesisState) GetHostGenesisState() *HostGenesisState {
	if x != nil {
		return x.HostGenesisState
	}
	return nil
}

// ControllerGenesisState defines the interchain accounts controller genesis state
type ControllerGenesisState struct {
	state         protoimpl.MessageState
	sizeCache     protoimpl.SizeCache
	unknownFields protoimpl.UnknownFields

	ActiveChannels     []*ActiveChannel               `protobuf:"bytes,1,rep,name=active_channels,json=activeChannels,proto3" json:"active_channels,omitempty"`
	InterchainAccounts []*RegisteredInterchainAccount `protobuf:"bytes,2,rep,name=interchain_accounts,json=interchainAccounts,proto3" json:"interchain_accounts,omitempty"`
	Ports              []string                       `protobuf:"bytes,3,rep,name=ports,proto3" json:"ports,omitempty"`
	Params             *types.Params                  `protobuf:"bytes,4,opt,name=params,proto3" json:"params,omitempty"`
}

func (x *ControllerGenesisState) Reset() {
	*x = ControllerGenesisState{}
	if protoimpl.UnsafeEnabled {
		mi := &file_ibc_applications_interchain_accounts_genesis_v1_genesis_proto_msgTypes[1]
		ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
		ms.StoreMessageInfo(mi)
	}
}

func (x *ControllerGenesisState) String() string {
	return protoimpl.X.MessageStringOf(x)
}

func (*ControllerGenesisState) ProtoMessage() {}

func (x *ControllerGenesisState) ProtoReflect() protoreflect.Message {
	mi := &file_ibc_applications_interchain_accounts_genesis_v1_genesis_proto_msgTypes[1]
	if protoimpl.UnsafeEnabled && x != nil {
		ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
		if ms.LoadMessageInfo() == nil {
			ms.StoreMessageInfo(mi)
		}
		return ms
	}
	return mi.MessageOf(x)
}

// Deprecated: Use ControllerGenesisState.ProtoReflect.Descriptor instead.
func (*ControllerGenesisState) Descriptor() ([]byte, []int) {
	return file_ibc_applications_interchain_accounts_genesis_v1_genesis_proto_rawDescGZIP(), []int{1}
}

func (x *ControllerGenesisState) GetActiveChannels() []*ActiveChannel {
	if x != nil {
		return x.ActiveChannels
	}
	return nil
}

func (x *ControllerGenesisState) GetInterchainAccounts() []*RegisteredInterchainAccount {
	if x != nil {
		return x.InterchainAccounts
	}
	return nil
}

func (x *ControllerGenesisState) GetPorts() []string {
	if x != nil {
		return x.Ports
	}
	return nil
}

func (x *ControllerGenesisState) GetParams() *types.Params {
	if x != nil {
		return x.Params
	}
	return nil
}

// HostGenesisState defines the interchain accounts host genesis state
type HostGenesisState struct {
	state         protoimpl.MessageState
	sizeCache     protoimpl.SizeCache
	unknownFields protoimpl.UnknownFields

	ActiveChannels     []*ActiveChannel               `protobuf:"bytes,1,rep,name=active_channels,json=activeChannels,proto3" json:"active_channels,omitempty"`
	InterchainAccounts []*RegisteredInterchainAccount `protobuf:"bytes,2,rep,name=interchain_accounts,json=interchainAccounts,proto3" json:"interchain_accounts,omitempty"`
	Port               string                         `protobuf:"bytes,3,opt,name=port,proto3" json:"port,omitempty"`
	Params             *types1.Params                 `protobuf:"bytes,4,opt,name=params,proto3" json:"params,omitempty"`
}

func (x *HostGenesisState) Reset() {
	*x = HostGenesisState{}
	if protoimpl.UnsafeEnabled {
		mi := &file_ibc_applications_interchain_accounts_genesis_v1_genesis_proto_msgTypes[2]
		ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
		ms.StoreMessageInfo(mi)
	}
}

func (x *HostGenesisState) String() string {
	return protoimpl.X.MessageStringOf(x)
}

func (*HostGenesisState) ProtoMessage() {}

func (x *HostGenesisState) ProtoReflect() protoreflect.Message {
	mi := &file_ibc_applications_interchain_accounts_genesis_v1_genesis_proto_msgTypes[2]
	if protoimpl.UnsafeEnabled && x != nil {
		ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
		if ms.LoadMessageInfo() == nil {
			ms.StoreMessageInfo(mi)
		}
		return ms
	}
	return mi.MessageOf(x)
}

// Deprecated: Use HostGenesisState.ProtoReflect.Descriptor instead.
func (*HostGenesisState) Descriptor() ([]byte, []int) {
	return file_ibc_applications_interchain_accounts_genesis_v1_genesis_proto_rawDescGZIP(), []int{2}
}

func (x *HostGenesisState) GetActiveChannels() []*ActiveChannel {
	if x != nil {
		return x.ActiveChannels
	}
	return nil
}

func (x *HostGenesisState) GetInterchainAccounts() []*RegisteredInterchainAccount {
	if x != nil {
		return x.InterchainAccounts
	}
	return nil
}

func (x *HostGenesisState) GetPort() string {
	if x != nil {
		return x.Port
	}
	return ""
}

func (x *HostGenesisState) GetParams() *types1.Params {
	if x != nil {
		return x.Params
	}
	return nil
}

// ActiveChannel contains a connection ID, port ID and associated active channel ID, as well as a boolean flag to
// indicate if the channel is middleware enabled
type ActiveChannel struct {
	state         protoimpl.MessageState
	sizeCache     protoimpl.SizeCache
	unknownFields protoimpl.UnknownFields

	ConnectionId        string `protobuf:"bytes,1,opt,name=connection_id,json=connectionId,proto3" json:"connection_id,omitempty"`
	PortId              string `protobuf:"bytes,2,opt,name=port_id,json=portId,proto3" json:"port_id,omitempty"`
	ChannelId           string `protobuf:"bytes,3,opt,name=channel_id,json=channelId,proto3" json:"channel_id,omitempty"`
	IsMiddlewareEnabled bool   `protobuf:"varint,4,opt,name=is_middleware_enabled,json=isMiddlewareEnabled,proto3" json:"is_middleware_enabled,omitempty"`
}

func (x *ActiveChannel) Reset() {
	*x = ActiveChannel{}
	if protoimpl.UnsafeEnabled {
		mi := &file_ibc_applications_interchain_accounts_genesis_v1_genesis_proto_msgTypes[3]
		ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
		ms.StoreMessageInfo(mi)
	}
}

func (x *ActiveChannel) String() string {
	return protoimpl.X.MessageStringOf(x)
}

func (*ActiveChannel) ProtoMessage() {}

func (x *ActiveChannel) ProtoReflect() protoreflect.Message {
	mi := &file_ibc_applications_interchain_accounts_genesis_v1_genesis_proto_msgTypes[3]
	if protoimpl.UnsafeEnabled && x != nil {
		ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
		if ms.LoadMessageInfo() == nil {
			ms.StoreMessageInfo(mi)
		}
		return ms
	}
	return mi.MessageOf(x)
}

// Deprecated: Use ActiveChannel.ProtoReflect.Descriptor instead.
func (*ActiveChannel) Descriptor() ([]byte, []int) {
	return file_ibc_applications_interchain_accounts_genesis_v1_genesis_proto_rawDescGZIP(), []int{3}
}

func (x *ActiveChannel) GetConnectionId() string {
	if x != nil {
		return x.ConnectionId
	}
	return ""
}

func (x *ActiveChannel) GetPortId() string {
	if x != nil {
		return x.PortId
	}
	return ""
}

func (x *ActiveChannel) GetChannelId() string {
	if x != nil {
		return x.ChannelId
	}
	return ""
}

func (x *ActiveChannel) GetIsMiddlewareEnabled() bool {
	if x != nil {
		return x.IsMiddlewareEnabled
	}
	return false
}

// RegisteredInterchainAccount contains a connection ID, port ID and associated interchain account address
type RegisteredInterchainAccount struct {
	state         protoimpl.MessageState
	sizeCache     protoimpl.SizeCache
	unknownFields protoimpl.UnknownFields

	ConnectionId   string `protobuf:"bytes,1,opt,name=connection_id,json=connectionId,proto3" json:"connection_id,omitempty"`
	PortId         string `protobuf:"bytes,2,opt,name=port_id,json=portId,proto3" json:"port_id,omitempty"`
	AccountAddress string `protobuf:"bytes,3,opt,name=account_address,json=accountAddress,proto3" json:"account_address,omitempty"`
}

func (x *RegisteredInterchainAccount) Reset() {
	*x = RegisteredInterchainAccount{}
	if protoimpl.UnsafeEnabled {
		mi := &file_ibc_applications_interchain_accounts_genesis_v1_genesis_proto_msgTypes[4]
		ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
		ms.StoreMessageInfo(mi)
	}
}

func (x *RegisteredInterchainAccount) String() string {
	return protoimpl.X.MessageStringOf(x)
}

func (*RegisteredInterchainAccount) ProtoMessage() {}

func (x *RegisteredInterchainAccount) ProtoReflect() protoreflect.Message {
	mi := &file_ibc_applications_interchain_accounts_genesis_v1_genesis_proto_msgTypes[4]
	if protoimpl.UnsafeEnabled && x != nil {
		ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
		if ms.LoadMessageInfo() == nil {
			ms.StoreMessageInfo(mi)
		}
		return ms
	}
	return mi.MessageOf(x)
}

// Deprecated: Use RegisteredInterchainAccount.ProtoReflect.Descriptor instead.
func (*RegisteredInterchainAccount) Descriptor() ([]byte, []int) {
	return file_ibc_applications_interchain_accounts_genesis_v1_genesis_proto_rawDescGZIP(), []int{4}
}

func (x *RegisteredInterchainAccount) GetConnectionId() string {
	if x != nil {
		return x.ConnectionId
	}
	return ""
}

func (x *RegisteredInterchainAccount) GetPortId() string {
	if x != nil {
		return x.PortId
	}
	return ""
}

func (x *RegisteredInterchainAccount) GetAccountAddress() string {
	if x != nil {
		return x.AccountAddress
	}
	return ""
}

var File_ibc_applications_interchain_accounts_genesis_v1_genesis_proto protoreflect.FileDescriptor

var file_ibc_applications_interchain_accounts_genesis_v1_genesis_proto_rawDesc = []byte{
	0x0a, 0x3d, 0x69, 0x62, 0x63, 0x2f, 0x61, 0x70, 0x70, 0x6c, 0x69, 0x63, 0x61, 0x74, 0x69, 0x6f,
	0x6e, 0x73, 0x2f, 0x69, 0x6e, 0x74, 0x65, 0x72, 0x63, 0x68, 0x61, 0x69, 0x6e, 0x5f, 0x61, 0x63,
	0x63, 0x6f, 0x75, 0x6e, 0x74, 0x73, 0x2f, 0x67, 0x65, 0x6e, 0x65, 0x73, 0x69, 0x73, 0x2f, 0x76,
	0x31, 0x2f, 0x67, 0x65, 0x6e, 0x65, 0x73, 0x69, 0x73, 0x2e, 0x70, 0x72, 0x6f, 0x74, 0x6f, 0x12,
	0x2f, 0x69, 0x62, 0x63, 0x2e, 0x61, 0x70, 0x70, 0x6c, 0x69, 0x63, 0x61, 0x74, 0x69, 0x6f, 0x6e,
	0x73, 0x2e, 0x69, 0x6e, 0x74, 0x65, 0x72, 0x63, 0x68, 0x61, 0x69, 0x6e, 0x5f, 0x61, 0x63, 0x63,
	0x6f, 0x75, 0x6e, 0x74, 0x73, 0x2e, 0x67, 0x65, 0x6e, 0x65, 0x73, 0x69, 0x73, 0x2e, 0x76, 0x31,
	0x1a, 0x14, 0x67, 0x6f, 0x67, 0x6f, 0x70, 0x72, 0x6f, 0x74, 0x6f, 0x2f, 0x67, 0x6f, 0x67, 0x6f,
	0x2e, 0x70, 0x72, 0x6f, 0x74, 0x6f, 0x1a, 0x43, 0x69, 0x62, 0x63, 0x2f, 0x61, 0x70, 0x70, 0x6c,
	0x69, 0x63, 0x61, 0x74, 0x69, 0x6f, 0x6e, 0x73, 0x2f, 0x69, 0x6e, 0x74, 0x65, 0x72, 0x63, 0x68,
	0x61, 0x69, 0x6e, 0x5f, 0x61, 0x63, 0x63, 0x6f, 0x75, 0x6e, 0x74, 0x73, 0x2f, 0x63, 0x6f, 0x6e,
	0x74, 0x72, 0x6f, 0x6c, 0x6c, 0x65, 0x72, 0x2f, 0x76, 0x31, 0x2f, 0x63, 0x6f, 0x6e, 0x74, 0x72,
	0x6f, 0x6c, 0x6c, 0x65, 0x72, 0x2e, 0x70, 0x72, 0x6f, 0x74, 0x6f, 0x1a, 0x37, 0x69, 0x62, 0x63,
	0x2f, 0x61, 0x70, 0x70, 0x6c, 0x69, 0x63, 0x61, 0x74, 0x69, 0x6f, 0x6e, 0x73, 0x2f, 0x69, 0x6e,
	0x74, 0x65, 0x72, 0x63, 0x68, 0x61, 0x69, 0x6e, 0x5f, 0x61, 0x63, 0x63, 0x6f, 0x75, 0x6e, 0x74,
	0x73, 0x2f, 0x68, 0x6f, 0x73, 0x74, 0x2f, 0x76, 0x31, 0x2f, 0x68, 0x6f, 0x73, 0x74, 0x2e, 0x70,
	0x72, 0x6f, 0x74, 0x6f, 0x22, 0xd0, 0x02, 0x0a, 0x0c, 0x47, 0x65, 0x6e, 0x65, 0x73, 0x69, 0x73,
	0x53, 0x74, 0x61, 0x74, 0x65, 0x12, 0xaa, 0x01, 0x0a, 0x18, 0x63, 0x6f, 0x6e, 0x74, 0x72, 0x6f,
	0x6c, 0x6c, 0x65, 0x72, 0x5f, 0x67, 0x65, 0x6e, 0x65, 0x73, 0x69, 0x73, 0x5f, 0x73, 0x74, 0x61,
	0x74, 0x65, 0x18, 0x01, 0x20, 0x01, 0x28, 0x0b, 0x32, 0x47, 0x2e, 0x69, 0x62, 0x63, 0x2e, 0x61,
	0x70, 0x70, 0x6c, 0x69, 0x63, 0x61, 0x74, 0x69, 0x6f, 0x6e, 0x73, 0x2e, 0x69, 0x6e, 0x74, 0x65,
	0x72, 0x63, 0x68, 0x61, 0x69, 0x6e, 0x5f, 0x61, 0x63, 0x63, 0x6f, 0x75, 0x6e, 0x74, 0x73, 0x2e,
	0x67, 0x65, 0x6e, 0x65, 0x73, 0x69, 0x73, 0x2e, 0x76, 0x31, 0x2e, 0x43, 0x6f, 0x6e, 0x74, 0x72,
	0x6f, 0x6c, 0x6c, 0x65, 0x72, 0x47, 0x65, 0x6e, 0x65, 0x73, 0x69, 0x73, 0x53, 0x74, 0x61, 0x74,
	0x65, 0x42, 0x27, 0xc8, 0xde, 0x1f, 0x00, 0xf2, 0xde, 0x1f, 0x1f, 0x79, 0x61, 0x6d, 0x6c, 0x3a,
	0x22, 0x63, 0x6f, 0x6e, 0x74, 0x72, 0x6f, 0x6c, 0x6c, 0x65, 0x72, 0x5f, 0x67, 0x65, 0x6e, 0x65,
	0x73, 0x69, 0x73, 0x5f, 0x73, 0x74, 0x61, 0x74, 0x65, 0x22, 0x52, 0x16, 0x63, 0x6f, 0x6e, 0x74,
	0x72, 0x6f, 0x6c, 0x6c, 0x65, 0x72, 0x47, 0x65, 0x6e, 0x65, 0x73, 0x69, 0x73, 0x53, 0x74, 0x61,
	0x74, 0x65, 0x12, 0x92, 0x01, 0x0a, 0x12, 0x68, 0x6f, 0x73, 0x74, 0x5f, 0x67, 0x65, 0x6e, 0x65,
	0x73, 0x69, 0x73, 0x5f, 0x73, 0x74, 0x61, 0x74, 0x65, 0x18, 0x02, 0x20, 0x01, 0x28, 0x0b, 0x32,
	0x41, 0x2e, 0x69, 0x62, 0x63, 0x2e, 0x61, 0x70, 0x70, 0x6c, 0x69, 0x63, 0x61, 0x74, 0x69, 0x6f,
	0x6e, 0x73, 0x2e, 0x69, 0x6e, 0x74, 0x65, 0x72, 0x63, 0x68, 0x61, 0x69, 0x6e, 0x5f, 0x61, 0x63,
	0x63, 0x6f, 0x75, 0x6e, 0x74, 0x73, 0x2e, 0x67, 0x65, 0x6e, 0x65, 0x73, 0x69, 0x73, 0x2e, 0x76,
	0x31, 0x2e, 0x48, 0x6f, 0x73, 0x74, 0x47, 0x65, 0x6e, 0x65, 0x73, 0x69, 0x73, 0x53, 0x74, 0x61,
	0x74, 0x65, 0x42, 0x21, 0xc8, 0xde, 0x1f, 0x00, 0xf2, 0xde, 0x1f, 0x19, 0x79, 0x61, 0x6d, 0x6c,
	0x3a, 0x22, 0x68, 0x6f, 0x73, 0x74, 0x5f, 0x67, 0x65, 0x6e, 0x65, 0x73, 0x69, 0x73, 0x5f, 0x73,
	0x74, 0x61, 0x74, 0x65, 0x22, 0x52, 0x10, 0x68, 0x6f, 0x73, 0x74, 0x47, 0x65, 0x6e, 0x65, 0x73,
	0x69, 0x73, 0x53, 0x74, 0x61, 0x74, 0x65, 0x22, 0xb6, 0x03, 0x0a, 0x16, 0x43, 0x6f, 0x6e, 0x74,
	0x72, 0x6f, 0x6c, 0x6c, 0x65, 0x72, 0x47, 0x65, 0x6e, 0x65, 0x73, 0x69, 0x73, 0x53, 0x74, 0x61,
	0x74, 0x65, 0x12, 0x87, 0x01, 0x0a, 0x0f, 0x61, 0x63, 0x74, 0x69, 0x76, 0x65, 0x5f, 0x63, 0x68,
	0x61, 0x6e, 0x6e, 0x65, 0x6c, 0x73, 0x18, 0x01, 0x20, 0x03, 0x28, 0x0b, 0x32, 0x3e, 0x2e, 0x69,
	0x62, 0x63, 0x2e, 0x61, 0x70, 0x70, 0x6c, 0x69, 0x63, 0x61, 0x74, 0x69, 0x6f, 0x6e, 0x73, 0x2e,
	0x69, 0x6e, 0x74, 0x65, 0x72, 0x63, 0x68, 0x61, 0x69, 0x6e, 0x5f, 0x61, 0x63, 0x63, 0x6f, 0x75,
	0x6e, 0x74, 0x73, 0x2e, 0x67, 0x65, 0x6e, 0x65, 0x73, 0x69, 0x73, 0x2e, 0x76, 0x31, 0x2e, 0x41,
	0x63, 0x74, 0x69, 0x76, 0x65, 0x43, 0x68, 0x61, 0x6e, 0x6e, 0x65, 0x6c, 0x42, 0x1e, 0xc8, 0xde,
	0x1f, 0x00, 0xf2, 0xde, 0x1f, 0x16, 0x79, 0x61, 0x6d, 0x6c, 0x3a, 0x22, 0x61, 0x63, 0x74, 0x69,
	0x76, 0x65, 0x5f, 0x63, 0x68, 0x61, 0x6e, 0x6e, 0x65, 0x6c, 0x73, 0x22, 0x52, 0x0e, 0x61, 0x63,
	0x74, 0x69, 0x76, 0x65, 0x43, 0x68, 0x61, 0x6e, 0x6e, 0x65, 0x6c, 0x73, 0x12, 0xa1, 0x01, 0x0a,
	0x13, 0x69, 0x6e, 0x74, 0x65, 0x72, 0x63, 0x68, 0x61, 0x69, 0x6e, 0x5f, 0x61, 0x63, 0x63, 0x6f,
	0x75, 0x6e, 0x74, 0x73, 0x18, 0x02, 0x20, 0x03, 0x28, 0x0b, 0x32, 0x4c, 0x2e, 0x69, 0x62, 0x63,
	0x2e, 0x61, 0x70, 0x70, 0x6c, 0x69, 0x63, 0x61, 0x74, 0x69, 0x6f, 0x6e, 0x73, 0x2e, 0x69, 0x6e,
	0x74, 0x65, 0x72, 0x63, 0x68, 0x61, 0x69, 0x6e, 0x5f, 0x61, 0x63, 0x63, 0x6f, 0x75, 0x6e, 0x74,
	0x73, 0x2e, 0x67, 0x65, 0x6e, 0x65, 0x73, 0x69, 0x73, 0x2e, 0x76, 0x31, 0x2e, 0x52, 0x65, 0x67,
	0x69, 0x73, 0x74, 0x65, 0x72, 0x65, 0x64, 0x49, 0x6e, 0x74, 0x65, 0x72, 0x63, 0x68, 0x61, 0x69,
	0x6e, 0x41, 0x63, 0x63, 0x6f, 0x75, 0x6e, 0x74, 0x42, 0x22, 0xc8, 0xde, 0x1f, 0x00, 0xf2, 0xde,
	0x1f, 0x1a, 0x79, 0x61, 0x6d, 0x6c, 0x3a, 0x22, 0x69, 0x6e, 0x74, 0x65, 0x72, 0x63, 0x68, 0x61,
	0x69, 0x6e, 0x5f, 0x61, 0x63, 0x63, 0x6f, 0x75, 0x6e, 0x74, 0x73, 0x22, 0x52, 0x12, 0x69, 0x6e,
	0x74, 0x65, 0x72, 0x63, 0x68, 0x61, 0x69, 0x6e, 0x41, 0x63, 0x63, 0x6f, 0x75, 0x6e, 0x74, 0x73,
	0x12, 0x14, 0x0a, 0x05, 0x70, 0x6f, 0x72, 0x74, 0x73, 0x18, 0x03, 0x20, 0x03, 0x28, 0x09, 0x52,
	0x05, 0x70, 0x6f, 0x72, 0x74, 0x73, 0x12, 0x58, 0x0a, 0x06, 0x70, 0x61, 0x72, 0x61, 0x6d, 0x73,
	0x18, 0x04, 0x20, 0x01, 0x28, 0x0b, 0x32, 0x3a, 0x2e, 0x69, 0x62, 0x63, 0x2e, 0x61, 0x70, 0x70,
	0x6c, 0x69, 0x63, 0x61, 0x74, 0x69, 0x6f, 0x6e, 0x73, 0x2e, 0x69, 0x6e, 0x74, 0x65, 0x72, 0x63,
	0x68, 0x61, 0x69, 0x6e, 0x5f, 0x61, 0x63, 0x63, 0x6f, 0x75, 0x6e, 0x74, 0x73, 0x2e, 0x63, 0x6f,
	0x6e, 0x74, 0x72, 0x6f, 0x6c, 0x6c, 0x65, 0x72, 0x2e, 0x76, 0x31, 0x2e, 0x50, 0x61, 0x72, 0x61,
	0x6d, 0x73, 0x42, 0x04, 0xc8, 0xde, 0x1f, 0x00, 0x52, 0x06, 0x70, 0x61, 0x72, 0x61, 0x6d, 0x73,
	0x22, 0xa8, 0x03, 0x0a, 0x10, 0x48, 0x6f, 0x73, 0x74, 0x47, 0x65, 0x6e, 0x65, 0x73, 0x69, 0x73,
	0x53, 0x74, 0x61, 0x74, 0x65, 0x12, 0x87, 0x01, 0x0a, 0x0f, 0x61, 0x63, 0x74, 0x69, 0x76, 0x65,
	0x5f, 0x63, 0x68, 0x61, 0x6e, 0x6e, 0x65, 0x6c, 0x73, 0x18, 0x01, 0x20, 0x03, 0x28, 0x0b, 0x32,
	0x3e, 0x2e, 0x69, 0x62, 0x63, 0x2e, 0x61, 0x70, 0x70, 0x6c, 0x69, 0x63, 0x61, 0x74, 0x69, 0x6f,
	0x6e, 0x73, 0x2e, 0x69, 0x6e, 0x74, 0x65, 0x72, 0x63, 0x68, 0x61, 0x69, 0x6e, 0x5f, 0x61, 0x63,
	0x63, 0x6f, 0x75, 0x6e, 0x74, 0x73, 0x2e, 0x67, 0x65, 0x6e, 0x65, 0x73, 0x69, 0x73, 0x2e, 0x76,
	0x31, 0x2e, 0x41, 0x63, 0x74, 0x69, 0x76, 0x65, 0x43, 0x68, 0x61, 0x6e, 0x6e, 0x65, 0x6c, 0x42,
	0x1e, 0xc8, 0xde, 0x1f, 0x00, 0xf2, 0xde, 0x1f, 0x16, 0x79, 0x61, 0x6d, 0x6c, 0x3a, 0x22, 0x61,
	0x63, 0x74, 0x69, 0x76, 0x65, 0x5f, 0x63, 0x68, 0x61, 0x6e, 0x6e, 0x65, 0x6c, 0x73, 0x22, 0x52,
	0x0e, 0x61, 0x63, 0x74, 0x69, 0x76, 0x65, 0x43, 0x68, 0x61, 0x6e, 0x6e, 0x65, 0x6c, 0x73, 0x12,
	0xa1, 0x01, 0x0a, 0x13, 0x69, 0x6e, 0x74, 0x65, 0x72, 0x63, 0x68, 0x61, 0x69, 0x6e, 0x5f, 0x61,
	0x63, 0x63, 0x6f, 0x75, 0x6e, 0x74, 0x73, 0x18, 0x02, 0x20, 0x03, 0x28, 0x0b, 0x32, 0x4c, 0x2e,
	0x69, 0x62, 0x63, 0x2e, 0x61, 0x70, 0x70, 0x6c, 0x69, 0x63, 0x61, 0x74, 0x69, 0x6f, 0x6e, 0x73,
	0x2e, 0x69, 0x6e, 0x74, 0x65, 0x72, 0x63, 0x68, 0x61, 0x69, 0x6e, 0x5f, 0x61, 0x63, 0x63, 0x6f,
	0x75, 0x6e, 0x74, 0x73, 0x2e, 0x67, 0x65, 0x6e, 0x65, 0x73, 0x69, 0x73, 0x2e, 0x76, 0x31, 0x2e,
	0x52, 0x65, 0x67, 0x69, 0x73, 0x74, 0x65, 0x72, 0x65, 0x64, 0x49, 0x6e, 0x74, 0x65, 0x72, 0x63,
	0x68, 0x61, 0x69, 0x6e, 0x41, 0x63, 0x63, 0x6f, 0x75, 0x6e, 0x74, 0x42, 0x22, 0xc8, 0xde, 0x1f,
	0x00, 0xf2, 0xde, 0x1f, 0x1a, 0x79, 0x61, 0x6d, 0x6c, 0x3a, 0x22, 0x69, 0x6e, 0x74, 0x65, 0x72,
	0x63, 0x68, 0x61, 0x69, 0x6e, 0x5f, 0x61, 0x63, 0x63, 0x6f, 0x75, 0x6e, 0x74, 0x73, 0x22, 0x52,
	0x12, 0x69, 0x6e, 0x74, 0x65, 0x72, 0x63, 0x68, 0x61, 0x69, 0x6e, 0x41, 0x63, 0x63, 0x6f, 0x75,
	0x6e, 0x74, 0x73, 0x12, 0x12, 0x0a, 0x04, 0x70, 0x6f, 0x72, 0x74, 0x18, 0x03, 0x20, 0x01, 0x28,
	0x09, 0x52, 0x04, 0x70, 0x6f, 0x72, 0x74, 0x12, 0x52, 0x0a, 0x06, 0x70, 0x61, 0x72, 0x61, 0x6d,
	0x73, 0x18, 0x04, 0x20, 0x01, 0x28, 0x0b, 0x32, 0x34, 0x2e, 0x69, 0x62, 0x63, 0x2e, 0x61, 0x70,
	0x70, 0x6c, 0x69, 0x63, 0x61, 0x74, 0x69, 0x6f, 0x6e, 0x73, 0x2e, 0x69, 0x6e, 0x74, 0x65, 0x72,
	0x63, 0x68, 0x61, 0x69, 0x6e, 0x5f, 0x61, 0x63, 0x63, 0x6f, 0x75, 0x6e, 0x74, 0x73, 0x2e, 0x68,
	0x6f, 0x73, 0x74, 0x2e, 0x76, 0x31, 0x2e, 0x50, 0x61, 0x72, 0x61, 0x6d, 0x73, 0x42, 0x04, 0xc8,
	0xde, 0x1f, 0x00, 0x52, 0x06, 0x70, 0x61, 0x72, 0x61, 0x6d, 0x73, 0x22, 0x87, 0x02, 0x0a, 0x0d,
	0x41, 0x63, 0x74, 0x69, 0x76, 0x65, 0x43, 0x68, 0x61, 0x6e, 0x6e, 0x65, 0x6c, 0x12, 0x3d, 0x0a,
	0x0d, 0x63, 0x6f, 0x6e, 0x6e, 0x65, 0x63, 0x74, 0x69, 0x6f, 0x6e, 0x5f, 0x69, 0x64, 0x18, 0x01,
	0x20, 0x01, 0x28, 0x09, 0x42, 0x18, 0xf2, 0xde, 0x1f, 0x14, 0x79, 0x61, 0x6d, 0x6c, 0x3a, 0x22,
	0x63, 0x6f, 0x6e, 0x6e, 0x65, 0x63, 0x74, 0x69, 0x6f, 0x6e, 0x5f, 0x69, 0x64, 0x22, 0x52, 0x0c,
	0x63, 0x6f, 0x6e, 0x6e, 0x65, 0x63, 0x74, 0x69, 0x6f, 0x6e, 0x49, 0x64, 0x12, 0x2b, 0x0a, 0x07,
	0x70, 0x6f, 0x72, 0x74, 0x5f, 0x69, 0x64, 0x18, 0x02, 0x20, 0x01, 0x28, 0x09, 0x42, 0x12, 0xf2,
	0xde, 0x1f, 0x0e, 0x79, 0x61, 0x6d, 0x6c, 0x3a, 0x22, 0x70, 0x6f, 0x72, 0x74, 0x5f, 0x69, 0x64,
	0x22, 0x52, 0x06, 0x70, 0x6f, 0x72, 0x74, 0x49, 0x64, 0x12, 0x34, 0x0a, 0x0a, 0x63, 0x68, 0x61,
	0x6e, 0x6e, 0x65, 0x6c, 0x5f, 0x69, 0x64, 0x18, 0x03, 0x20, 0x01, 0x28, 0x09, 0x42, 0x15, 0xf2,
	0xde, 0x1f, 0x11, 0x79, 0x61, 0x6d, 0x6c, 0x3a, 0x22, 0x63, 0x68, 0x61, 0x6e, 0x6e, 0x65, 0x6c,
	0x5f, 0x69, 0x64, 0x22, 0x52, 0x09, 0x63, 0x68, 0x61, 0x6e, 0x6e, 0x65, 0x6c, 0x49, 0x64, 0x12,
	0x54, 0x0a, 0x15, 0x69, 0x73, 0x5f, 0x6d, 0x69, 0x64, 0x64, 0x6c, 0x65, 0x77, 0x61, 0x72, 0x65,
	0x5f, 0x65, 0x6e, 0x61, 0x62, 0x6c, 0x65, 0x64, 0x18, 0x04, 0x20, 0x01, 0x28, 0x08, 0x42, 0x20,
	0xf2, 0xde, 0x1f, 0x1c, 0x79, 0x61, 0x6d, 0x6c, 0x3a, 0x22, 0x69, 0x73, 0x5f, 0x6d, 0x69, 0x64,
	0x64, 0x6c, 0x65, 0x77, 0x61, 0x72, 0x65, 0x5f, 0x65, 0x6e, 0x61, 0x62, 0x6c, 0x65, 0x64, 0x22,
	0x52, 0x13, 0x69, 0x73, 0x4d, 0x69, 0x64, 0x64, 0x6c, 0x65, 0x77, 0x61, 0x72, 0x65, 0x45, 0x6e,
	0x61, 0x62, 0x6c, 0x65, 0x64, 0x22, 0xce, 0x01, 0x0a, 0x1b, 0x52, 0x65, 0x67, 0x69, 0x73, 0x74,
	0x65, 0x72, 0x65, 0x64, 0x49, 0x6e, 0x74, 0x65, 0x72, 0x63, 0x68, 0x61, 0x69, 0x6e, 0x41, 0x63,
	0x63, 0x6f, 0x75, 0x6e, 0x74, 0x12, 0x3d, 0x0a, 0x0d, 0x63, 0x6f, 0x6e, 0x6e, 0x65, 0x63, 0x74,
	0x69, 0x6f, 0x6e, 0x5f, 0x69, 0x64, 0x18, 0x01, 0x20, 0x01, 0x28, 0x09, 0x42, 0x18, 0xf2, 0xde,
	0x1f, 0x14, 0x79, 0x61, 0x6d, 0x6c, 0x3a, 0x22, 0x63, 0x6f, 0x6e, 0x6e, 0x65, 0x63, 0x74, 0x69,
	0x6f, 0x6e, 0x5f, 0x69, 0x64, 0x22, 0x52, 0x0c, 0x63, 0x6f, 0x6e, 0x6e, 0x65, 0x63, 0x74, 0x69,
	0x6f, 0x6e, 0x49, 0x64, 0x12, 0x2b, 0x0a, 0x07, 0x70, 0x6f, 0x72, 0x74, 0x5f, 0x69, 0x64, 0x18,
	0x02, 0x20, 0x01, 0x28, 0x09, 0x42, 0x12, 0xf2, 0xde, 0x1f, 0x0e, 0x79, 0x61, 0x6d, 0x6c, 0x3a,
	0x22, 0x70, 0x6f, 0x72, 0x74, 0x5f, 0x69, 0x64, 0x22, 0x52, 0x06, 0x70, 0x6f, 0x72, 0x74, 0x49,
	0x64, 0x12, 0x43, 0x0a, 0x0f, 0x61, 0x63, 0x63, 0x6f, 0x75, 0x6e, 0x74, 0x5f, 0x61, 0x64, 0x64,
	0x72, 0x65, 0x73, 0x73, 0x18, 0x03, 0x20, 0x01, 0x28, 0x09, 0x42, 0x1a, 0xf2, 0xde, 0x1f, 0x16,
	0x79, 0x61, 0x6d, 0x6c, 0x3a, 0x22, 0x61, 0x63, 0x63, 0x6f, 0x75, 0x6e, 0x74, 0x5f, 0x61, 0x64,
	0x64, 0x72, 0x65, 0x73, 0x73, 0x22, 0x52, 0x0e, 0x61, 0x63, 0x63, 0x6f, 0x75, 0x6e, 0x74, 0x41,
	0x64, 0x64, 0x72, 0x65, 0x73, 0x73, 0x42, 0x4f, 0x5a, 0x4d, 0x67, 0x69, 0x74, 0x68, 0x75, 0x62,
	0x2e, 0x63, 0x6f, 0x6d, 0x2f, 0x63, 0x6f, 0x73, 0x6d, 0x6f, 0x73, 0x2f, 0x69, 0x62, 0x63, 0x2d,
	0x67, 0x6f, 0x2f, 0x76, 0x37, 0x2f, 0x6d, 0x6f, 0x64, 0x75, 0x6c, 0x65, 0x73, 0x2f, 0x61, 0x70,
	0x70, 0x73, 0x2f, 0x32, 0x37, 0x2d, 0x69, 0x6e, 0x74, 0x65, 0x72, 0x63, 0x68, 0x61, 0x69, 0x6e,
	0x2d, 0x61, 0x63, 0x63, 0x6f, 0x75, 0x6e, 0x74, 0x73, 0x2f, 0x67, 0x65, 0x6e, 0x65, 0x73, 0x69,
	0x73, 0x2f, 0x74, 0x79, 0x70, 0x65, 0x73, 0x62, 0x06, 0x70, 0x72, 0x6f, 0x74, 0x6f, 0x33,
}

var (
	file_ibc_applications_interchain_accounts_genesis_v1_genesis_proto_rawDescOnce sync.Once
	file_ibc_applications_interchain_accounts_genesis_v1_genesis_proto_rawDescData = file_ibc_applications_interchain_accounts_genesis_v1_genesis_proto_rawDesc
)

func file_ibc_applications_interchain_accounts_genesis_v1_genesis_proto_rawDescGZIP() []byte {
	file_ibc_applications_interchain_accounts_genesis_v1_genesis_proto_rawDescOnce.Do(func() {
		file_ibc_applications_interchain_accounts_genesis_v1_genesis_proto_rawDescData = protoimpl.X.CompressGZIP(file_ibc_applications_interchain_accounts_genesis_v1_genesis_proto_rawDescData)
	})
	return file_ibc_applications_interchain_accounts_genesis_v1_genesis_proto_rawDescData
}

var file_ibc_applications_interchain_accounts_genesis_v1_genesis_proto_msgTypes = make([]protoimpl.MessageInfo, 5)
var file_ibc_applications_interchain_accounts_genesis_v1_genesis_proto_goTypes = []interface{}{
	(*GenesisState)(nil),                // 0: ibc.applications.interchain_accounts.genesis.v1.GenesisState
	(*ControllerGenesisState)(nil),      // 1: ibc.applications.interchain_accounts.genesis.v1.ControllerGenesisState
	(*HostGenesisState)(nil),            // 2: ibc.applications.interchain_accounts.genesis.v1.HostGenesisState
	(*ActiveChannel)(nil),               // 3: ibc.applications.interchain_accounts.genesis.v1.ActiveChannel
	(*RegisteredInterchainAccount)(nil), // 4: ibc.applications.interchain_accounts.genesis.v1.RegisteredInterchainAccount
	(*types.Params)(nil),                // 5: ibc.applications.interchain_accounts.controller.v1.Params
	(*types1.Params)(nil),               // 6: ibc.applications.interchain_accounts.host.v1.Params
}
var file_ibc_applications_interchain_accounts_genesis_v1_genesis_proto_depIdxs = []int32{
	1, // 0: ibc.applications.interchain_accounts.genesis.v1.GenesisState.controller_genesis_state:type_name -> ibc.applications.interchain_accounts.genesis.v1.ControllerGenesisState
	2, // 1: ibc.applications.interchain_accounts.genesis.v1.GenesisState.host_genesis_state:type_name -> ibc.applications.interchain_accounts.genesis.v1.HostGenesisState
	3, // 2: ibc.applications.interchain_accounts.genesis.v1.ControllerGenesisState.active_channels:type_name -> ibc.applications.interchain_accounts.genesis.v1.ActiveChannel
	4, // 3: ibc.applications.interchain_accounts.genesis.v1.ControllerGenesisState.interchain_accounts:type_name -> ibc.applications.interchain_accounts.genesis.v1.RegisteredInterchainAccount
	5, // 4: ibc.applications.interchain_accounts.genesis.v1.ControllerGenesisState.params:type_name -> ibc.applications.interchain_accounts.controller.v1.Params
	3, // 5: ibc.applications.interchain_accounts.genesis.v1.HostGenesisState.active_channels:type_name -> ibc.applications.interchain_accounts.genesis.v1.ActiveChannel
	4, // 6: ibc.applications.interchain_accounts.genesis.v1.HostGenesisState.interchain_accounts:type_name -> ibc.applications.interchain_accounts.genesis.v1.RegisteredInterchainAccount
	6, // 7: ibc.applications.interchain_accounts.genesis.v1.HostGenesisState.params:type_name -> ibc.applications.interchain_accounts.host.v1.Params
	8, // [8:8] is the sub-list for method output_type
	8, // [8:8] is the sub-list for method input_type
	8, // [8:8] is the sub-list for extension type_name
	8, // [8:8] is the sub-list for extension extendee
	0, // [0:8] is the sub-list for field type_name
}

func init() { file_ibc_applications_interchain_accounts_genesis_v1_genesis_proto_init() }
func file_ibc_applications_interchain_accounts_genesis_v1_genesis_proto_init() {
	if File_ibc_applications_interchain_accounts_genesis_v1_genesis_proto != nil {
		return
	}
	if !protoimpl.UnsafeEnabled {
		file_ibc_applications_interchain_accounts_genesis_v1_genesis_proto_msgTypes[0].Exporter = func(v interface{}, i int) interface{} {
			switch v := v.(*GenesisState); i {
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
		file_ibc_applications_interchain_accounts_genesis_v1_genesis_proto_msgTypes[1].Exporter = func(v interface{}, i int) interface{} {
			switch v := v.(*ControllerGenesisState); i {
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
		file_ibc_applications_interchain_accounts_genesis_v1_genesis_proto_msgTypes[2].Exporter = func(v interface{}, i int) interface{} {
			switch v := v.(*HostGenesisState); i {
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
		file_ibc_applications_interchain_accounts_genesis_v1_genesis_proto_msgTypes[3].Exporter = func(v interface{}, i int) interface{} {
			switch v := v.(*ActiveChannel); i {
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
		file_ibc_applications_interchain_accounts_genesis_v1_genesis_proto_msgTypes[4].Exporter = func(v interface{}, i int) interface{} {
			switch v := v.(*RegisteredInterchainAccount); i {
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
			RawDescriptor: file_ibc_applications_interchain_accounts_genesis_v1_genesis_proto_rawDesc,
			NumEnums:      0,
			NumMessages:   5,
			NumExtensions: 0,
			NumServices:   0,
		},
		GoTypes:           file_ibc_applications_interchain_accounts_genesis_v1_genesis_proto_goTypes,
		DependencyIndexes: file_ibc_applications_interchain_accounts_genesis_v1_genesis_proto_depIdxs,
		MessageInfos:      file_ibc_applications_interchain_accounts_genesis_v1_genesis_proto_msgTypes,
	}.Build()
	File_ibc_applications_interchain_accounts_genesis_v1_genesis_proto = out.File
	file_ibc_applications_interchain_accounts_genesis_v1_genesis_proto_rawDesc = nil
	file_ibc_applications_interchain_accounts_genesis_v1_genesis_proto_goTypes = nil
	file_ibc_applications_interchain_accounts_genesis_v1_genesis_proto_depIdxs = nil
}