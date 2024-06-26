// Code generated by protoc-gen-go. DO NOT EDIT.
// versions:
// 	protoc-gen-go v1.32.0
// 	protoc        (unknown)
// source: ibc/core/types/v1/query.proto

package types

import (
	_ "github.com/cosmos/cosmos-sdk/types/query"
	_ "github.com/cosmos/gogoproto/gogoproto"
	_ "google.golang.org/genproto/googleapis/api/annotations"
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

// QueryBlockResultsRequest is the request type for the Query/BlockResults RPC method.
type QueryBlockResultsRequest struct {
	state         protoimpl.MessageState
	sizeCache     protoimpl.SizeCache
	unknownFields protoimpl.UnknownFields

	Height uint64 `protobuf:"varint,1,opt,name=height,proto3" json:"height,omitempty"`
}

func (x *QueryBlockResultsRequest) Reset() {
	*x = QueryBlockResultsRequest{}
	if protoimpl.UnsafeEnabled {
		mi := &file_ibc_core_types_v1_query_proto_msgTypes[0]
		ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
		ms.StoreMessageInfo(mi)
	}
}

func (x *QueryBlockResultsRequest) String() string {
	return protoimpl.X.MessageStringOf(x)
}

func (*QueryBlockResultsRequest) ProtoMessage() {}

func (x *QueryBlockResultsRequest) ProtoReflect() protoreflect.Message {
	mi := &file_ibc_core_types_v1_query_proto_msgTypes[0]
	if protoimpl.UnsafeEnabled && x != nil {
		ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
		if ms.LoadMessageInfo() == nil {
			ms.StoreMessageInfo(mi)
		}
		return ms
	}
	return mi.MessageOf(x)
}

// Deprecated: Use QueryBlockResultsRequest.ProtoReflect.Descriptor instead.
func (*QueryBlockResultsRequest) Descriptor() ([]byte, []int) {
	return file_ibc_core_types_v1_query_proto_rawDescGZIP(), []int{0}
}

func (x *QueryBlockResultsRequest) GetHeight() uint64 {
	if x != nil {
		return x.Height
	}
	return 0
}

// QueryBlockResultsResponse is the response type for the Query/BlockResults RPC method.
type QueryBlockResultsResponse struct {
	state         protoimpl.MessageState
	sizeCache     protoimpl.SizeCache
	unknownFields protoimpl.UnknownFields

	// params defines the parameters of the module.
	BlockResults *ResultBlockResults `protobuf:"bytes,1,opt,name=block_results,json=blockResults,proto3" json:"block_results,omitempty"`
}

func (x *QueryBlockResultsResponse) Reset() {
	*x = QueryBlockResultsResponse{}
	if protoimpl.UnsafeEnabled {
		mi := &file_ibc_core_types_v1_query_proto_msgTypes[1]
		ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
		ms.StoreMessageInfo(mi)
	}
}

func (x *QueryBlockResultsResponse) String() string {
	return protoimpl.X.MessageStringOf(x)
}

func (*QueryBlockResultsResponse) ProtoMessage() {}

func (x *QueryBlockResultsResponse) ProtoReflect() protoreflect.Message {
	mi := &file_ibc_core_types_v1_query_proto_msgTypes[1]
	if protoimpl.UnsafeEnabled && x != nil {
		ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
		if ms.LoadMessageInfo() == nil {
			ms.StoreMessageInfo(mi)
		}
		return ms
	}
	return mi.MessageOf(x)
}

// Deprecated: Use QueryBlockResultsResponse.ProtoReflect.Descriptor instead.
func (*QueryBlockResultsResponse) Descriptor() ([]byte, []int) {
	return file_ibc_core_types_v1_query_proto_rawDescGZIP(), []int{1}
}

func (x *QueryBlockResultsResponse) GetBlockResults() *ResultBlockResults {
	if x != nil {
		return x.BlockResults
	}
	return nil
}

// QueryBlockSearchRequest is the request type for the Query/BlockSearch RPC method.
type QueryBlockSearchRequest struct {
	state         protoimpl.MessageState
	sizeCache     protoimpl.SizeCache
	unknownFields protoimpl.UnknownFields

	PacketSrcChannel string `protobuf:"bytes,1,opt,name=packet_src_channel,json=packetSrcChannel,proto3" json:"packet_src_channel,omitempty"`
	PacketDstChannel string `protobuf:"bytes,2,opt,name=packet_dst_channel,json=packetDstChannel,proto3" json:"packet_dst_channel,omitempty"`
	PacketSequence   string `protobuf:"bytes,3,opt,name=packet_sequence,json=packetSequence,proto3" json:"packet_sequence,omitempty"`
	Limit            uint64 `protobuf:"varint,4,opt,name=limit,proto3" json:"limit,omitempty"`
	Page             uint64 `protobuf:"varint,5,opt,name=page,proto3" json:"page,omitempty"`
}

func (x *QueryBlockSearchRequest) Reset() {
	*x = QueryBlockSearchRequest{}
	if protoimpl.UnsafeEnabled {
		mi := &file_ibc_core_types_v1_query_proto_msgTypes[2]
		ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
		ms.StoreMessageInfo(mi)
	}
}

func (x *QueryBlockSearchRequest) String() string {
	return protoimpl.X.MessageStringOf(x)
}

func (*QueryBlockSearchRequest) ProtoMessage() {}

func (x *QueryBlockSearchRequest) ProtoReflect() protoreflect.Message {
	mi := &file_ibc_core_types_v1_query_proto_msgTypes[2]
	if protoimpl.UnsafeEnabled && x != nil {
		ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
		if ms.LoadMessageInfo() == nil {
			ms.StoreMessageInfo(mi)
		}
		return ms
	}
	return mi.MessageOf(x)
}

// Deprecated: Use QueryBlockSearchRequest.ProtoReflect.Descriptor instead.
func (*QueryBlockSearchRequest) Descriptor() ([]byte, []int) {
	return file_ibc_core_types_v1_query_proto_rawDescGZIP(), []int{2}
}

func (x *QueryBlockSearchRequest) GetPacketSrcChannel() string {
	if x != nil {
		return x.PacketSrcChannel
	}
	return ""
}

func (x *QueryBlockSearchRequest) GetPacketDstChannel() string {
	if x != nil {
		return x.PacketDstChannel
	}
	return ""
}

func (x *QueryBlockSearchRequest) GetPacketSequence() string {
	if x != nil {
		return x.PacketSequence
	}
	return ""
}

func (x *QueryBlockSearchRequest) GetLimit() uint64 {
	if x != nil {
		return x.Limit
	}
	return 0
}

func (x *QueryBlockSearchRequest) GetPage() uint64 {
	if x != nil {
		return x.Page
	}
	return 0
}

// QueryBlockSearchResponse is the response type for the Query/BlockSearch RPC method.
type QueryBlockSearchResponse struct {
	state         protoimpl.MessageState
	sizeCache     protoimpl.SizeCache
	unknownFields protoimpl.UnknownFields

	// params defines the parameters of the module.
	Blocks     []*ResultBlockSearch `protobuf:"bytes,1,rep,name=blocks,proto3" json:"blocks,omitempty"`
	TotalCount uint64               `protobuf:"varint,2,opt,name=total_count,json=totalCount,proto3" json:"total_count,omitempty"`
}

func (x *QueryBlockSearchResponse) Reset() {
	*x = QueryBlockSearchResponse{}
	if protoimpl.UnsafeEnabled {
		mi := &file_ibc_core_types_v1_query_proto_msgTypes[3]
		ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
		ms.StoreMessageInfo(mi)
	}
}

func (x *QueryBlockSearchResponse) String() string {
	return protoimpl.X.MessageStringOf(x)
}

func (*QueryBlockSearchResponse) ProtoMessage() {}

func (x *QueryBlockSearchResponse) ProtoReflect() protoreflect.Message {
	mi := &file_ibc_core_types_v1_query_proto_msgTypes[3]
	if protoimpl.UnsafeEnabled && x != nil {
		ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
		if ms.LoadMessageInfo() == nil {
			ms.StoreMessageInfo(mi)
		}
		return ms
	}
	return mi.MessageOf(x)
}

// Deprecated: Use QueryBlockSearchResponse.ProtoReflect.Descriptor instead.
func (*QueryBlockSearchResponse) Descriptor() ([]byte, []int) {
	return file_ibc_core_types_v1_query_proto_rawDescGZIP(), []int{3}
}

func (x *QueryBlockSearchResponse) GetBlocks() []*ResultBlockSearch {
	if x != nil {
		return x.Blocks
	}
	return nil
}

func (x *QueryBlockSearchResponse) GetTotalCount() uint64 {
	if x != nil {
		return x.TotalCount
	}
	return 0
}

// QueryTransactionByHashRequest is the response type for the Query/BlockSearch RPC method.
type QueryTransactionByHashRequest struct {
	state         protoimpl.MessageState
	sizeCache     protoimpl.SizeCache
	unknownFields protoimpl.UnknownFields

	Hash string `protobuf:"bytes,1,opt,name=hash,proto3" json:"hash,omitempty"` // Transaction hash in hex format
}

func (x *QueryTransactionByHashRequest) Reset() {
	*x = QueryTransactionByHashRequest{}
	if protoimpl.UnsafeEnabled {
		mi := &file_ibc_core_types_v1_query_proto_msgTypes[4]
		ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
		ms.StoreMessageInfo(mi)
	}
}

func (x *QueryTransactionByHashRequest) String() string {
	return protoimpl.X.MessageStringOf(x)
}

func (*QueryTransactionByHashRequest) ProtoMessage() {}

func (x *QueryTransactionByHashRequest) ProtoReflect() protoreflect.Message {
	mi := &file_ibc_core_types_v1_query_proto_msgTypes[4]
	if protoimpl.UnsafeEnabled && x != nil {
		ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
		if ms.LoadMessageInfo() == nil {
			ms.StoreMessageInfo(mi)
		}
		return ms
	}
	return mi.MessageOf(x)
}

// Deprecated: Use QueryTransactionByHashRequest.ProtoReflect.Descriptor instead.
func (*QueryTransactionByHashRequest) Descriptor() ([]byte, []int) {
	return file_ibc_core_types_v1_query_proto_rawDescGZIP(), []int{4}
}

func (x *QueryTransactionByHashRequest) GetHash() string {
	if x != nil {
		return x.Hash
	}
	return ""
}

type QueryTransactionByHashResponse struct {
	state         protoimpl.MessageState
	sizeCache     protoimpl.SizeCache
	unknownFields protoimpl.UnknownFields

	Hash   string   `protobuf:"bytes,1,opt,name=hash,proto3" json:"hash,omitempty"` // Whether the transaction existed on the blockchain
	Height uint64   `protobuf:"varint,2,opt,name=height,proto3" json:"height,omitempty"`
	GasFee uint64   `protobuf:"varint,3,opt,name=gas_fee,json=gasFee,proto3" json:"gas_fee,omitempty"`
	TxSize uint64   `protobuf:"varint,4,opt,name=tx_size,json=txSize,proto3" json:"tx_size,omitempty"`
	Events []*Event `protobuf:"bytes,5,rep,name=events,proto3" json:"events,omitempty"`
}

func (x *QueryTransactionByHashResponse) Reset() {
	*x = QueryTransactionByHashResponse{}
	if protoimpl.UnsafeEnabled {
		mi := &file_ibc_core_types_v1_query_proto_msgTypes[5]
		ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
		ms.StoreMessageInfo(mi)
	}
}

func (x *QueryTransactionByHashResponse) String() string {
	return protoimpl.X.MessageStringOf(x)
}

func (*QueryTransactionByHashResponse) ProtoMessage() {}

func (x *QueryTransactionByHashResponse) ProtoReflect() protoreflect.Message {
	mi := &file_ibc_core_types_v1_query_proto_msgTypes[5]
	if protoimpl.UnsafeEnabled && x != nil {
		ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
		if ms.LoadMessageInfo() == nil {
			ms.StoreMessageInfo(mi)
		}
		return ms
	}
	return mi.MessageOf(x)
}

// Deprecated: Use QueryTransactionByHashResponse.ProtoReflect.Descriptor instead.
func (*QueryTransactionByHashResponse) Descriptor() ([]byte, []int) {
	return file_ibc_core_types_v1_query_proto_rawDescGZIP(), []int{5}
}

func (x *QueryTransactionByHashResponse) GetHash() string {
	if x != nil {
		return x.Hash
	}
	return ""
}

func (x *QueryTransactionByHashResponse) GetHeight() uint64 {
	if x != nil {
		return x.Height
	}
	return 0
}

func (x *QueryTransactionByHashResponse) GetGasFee() uint64 {
	if x != nil {
		return x.GasFee
	}
	return 0
}

func (x *QueryTransactionByHashResponse) GetTxSize() uint64 {
	if x != nil {
		return x.TxSize
	}
	return 0
}

func (x *QueryTransactionByHashResponse) GetEvents() []*Event {
	if x != nil {
		return x.Events
	}
	return nil
}

type QueryIBCHeaderRequest struct {
	state         protoimpl.MessageState
	sizeCache     protoimpl.SizeCache
	unknownFields protoimpl.UnknownFields

	Height uint64 `protobuf:"varint,2,opt,name=height,proto3" json:"height,omitempty"`
}

func (x *QueryIBCHeaderRequest) Reset() {
	*x = QueryIBCHeaderRequest{}
	if protoimpl.UnsafeEnabled {
		mi := &file_ibc_core_types_v1_query_proto_msgTypes[6]
		ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
		ms.StoreMessageInfo(mi)
	}
}

func (x *QueryIBCHeaderRequest) String() string {
	return protoimpl.X.MessageStringOf(x)
}

func (*QueryIBCHeaderRequest) ProtoMessage() {}

func (x *QueryIBCHeaderRequest) ProtoReflect() protoreflect.Message {
	mi := &file_ibc_core_types_v1_query_proto_msgTypes[6]
	if protoimpl.UnsafeEnabled && x != nil {
		ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
		if ms.LoadMessageInfo() == nil {
			ms.StoreMessageInfo(mi)
		}
		return ms
	}
	return mi.MessageOf(x)
}

// Deprecated: Use QueryIBCHeaderRequest.ProtoReflect.Descriptor instead.
func (*QueryIBCHeaderRequest) Descriptor() ([]byte, []int) {
	return file_ibc_core_types_v1_query_proto_rawDescGZIP(), []int{6}
}

func (x *QueryIBCHeaderRequest) GetHeight() uint64 {
	if x != nil {
		return x.Height
	}
	return 0
}

type QueryIBCHeaderResponse struct {
	state         protoimpl.MessageState
	sizeCache     protoimpl.SizeCache
	unknownFields protoimpl.UnknownFields

	Header *anypb.Any `protobuf:"bytes,1,opt,name=header,proto3" json:"header,omitempty"`
}

func (x *QueryIBCHeaderResponse) Reset() {
	*x = QueryIBCHeaderResponse{}
	if protoimpl.UnsafeEnabled {
		mi := &file_ibc_core_types_v1_query_proto_msgTypes[7]
		ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
		ms.StoreMessageInfo(mi)
	}
}

func (x *QueryIBCHeaderResponse) String() string {
	return protoimpl.X.MessageStringOf(x)
}

func (*QueryIBCHeaderResponse) ProtoMessage() {}

func (x *QueryIBCHeaderResponse) ProtoReflect() protoreflect.Message {
	mi := &file_ibc_core_types_v1_query_proto_msgTypes[7]
	if protoimpl.UnsafeEnabled && x != nil {
		ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
		if ms.LoadMessageInfo() == nil {
			ms.StoreMessageInfo(mi)
		}
		return ms
	}
	return mi.MessageOf(x)
}

// Deprecated: Use QueryIBCHeaderResponse.ProtoReflect.Descriptor instead.
func (*QueryIBCHeaderResponse) Descriptor() ([]byte, []int) {
	return file_ibc_core_types_v1_query_proto_rawDescGZIP(), []int{7}
}

func (x *QueryIBCHeaderResponse) GetHeader() *anypb.Any {
	if x != nil {
		return x.Header
	}
	return nil
}

var File_ibc_core_types_v1_query_proto protoreflect.FileDescriptor

var file_ibc_core_types_v1_query_proto_rawDesc = []byte{
	0x0a, 0x1d, 0x69, 0x62, 0x63, 0x2f, 0x63, 0x6f, 0x72, 0x65, 0x2f, 0x74, 0x79, 0x70, 0x65, 0x73,
	0x2f, 0x76, 0x31, 0x2f, 0x71, 0x75, 0x65, 0x72, 0x79, 0x2e, 0x70, 0x72, 0x6f, 0x74, 0x6f, 0x12,
	0x11, 0x69, 0x62, 0x63, 0x2e, 0x63, 0x6f, 0x72, 0x65, 0x2e, 0x74, 0x79, 0x70, 0x65, 0x73, 0x2e,
	0x76, 0x31, 0x1a, 0x14, 0x67, 0x6f, 0x67, 0x6f, 0x70, 0x72, 0x6f, 0x74, 0x6f, 0x2f, 0x67, 0x6f,
	0x67, 0x6f, 0x2e, 0x70, 0x72, 0x6f, 0x74, 0x6f, 0x1a, 0x2a, 0x63, 0x6f, 0x73, 0x6d, 0x6f, 0x73,
	0x2f, 0x62, 0x61, 0x73, 0x65, 0x2f, 0x71, 0x75, 0x65, 0x72, 0x79, 0x2f, 0x76, 0x31, 0x62, 0x65,
	0x74, 0x61, 0x31, 0x2f, 0x70, 0x61, 0x67, 0x69, 0x6e, 0x61, 0x74, 0x69, 0x6f, 0x6e, 0x2e, 0x70,
	0x72, 0x6f, 0x74, 0x6f, 0x1a, 0x1c, 0x67, 0x6f, 0x6f, 0x67, 0x6c, 0x65, 0x2f, 0x61, 0x70, 0x69,
	0x2f, 0x61, 0x6e, 0x6e, 0x6f, 0x74, 0x61, 0x74, 0x69, 0x6f, 0x6e, 0x73, 0x2e, 0x70, 0x72, 0x6f,
	0x74, 0x6f, 0x1a, 0x19, 0x67, 0x6f, 0x6f, 0x67, 0x6c, 0x65, 0x2f, 0x70, 0x72, 0x6f, 0x74, 0x6f,
	0x62, 0x75, 0x66, 0x2f, 0x61, 0x6e, 0x79, 0x2e, 0x70, 0x72, 0x6f, 0x74, 0x6f, 0x1a, 0x1d, 0x69,
	0x62, 0x63, 0x2f, 0x63, 0x6f, 0x72, 0x65, 0x2f, 0x74, 0x79, 0x70, 0x65, 0x73, 0x2f, 0x76, 0x31,
	0x2f, 0x62, 0x6c, 0x6f, 0x63, 0x6b, 0x2e, 0x70, 0x72, 0x6f, 0x74, 0x6f, 0x22, 0x32, 0x0a, 0x18,
	0x51, 0x75, 0x65, 0x72, 0x79, 0x42, 0x6c, 0x6f, 0x63, 0x6b, 0x52, 0x65, 0x73, 0x75, 0x6c, 0x74,
	0x73, 0x52, 0x65, 0x71, 0x75, 0x65, 0x73, 0x74, 0x12, 0x16, 0x0a, 0x06, 0x68, 0x65, 0x69, 0x67,
	0x68, 0x74, 0x18, 0x01, 0x20, 0x01, 0x28, 0x04, 0x52, 0x06, 0x68, 0x65, 0x69, 0x67, 0x68, 0x74,
	0x22, 0x67, 0x0a, 0x19, 0x51, 0x75, 0x65, 0x72, 0x79, 0x42, 0x6c, 0x6f, 0x63, 0x6b, 0x52, 0x65,
	0x73, 0x75, 0x6c, 0x74, 0x73, 0x52, 0x65, 0x73, 0x70, 0x6f, 0x6e, 0x73, 0x65, 0x12, 0x4a, 0x0a,
	0x0d, 0x62, 0x6c, 0x6f, 0x63, 0x6b, 0x5f, 0x72, 0x65, 0x73, 0x75, 0x6c, 0x74, 0x73, 0x18, 0x01,
	0x20, 0x01, 0x28, 0x0b, 0x32, 0x25, 0x2e, 0x69, 0x62, 0x63, 0x2e, 0x63, 0x6f, 0x72, 0x65, 0x2e,
	0x74, 0x79, 0x70, 0x65, 0x73, 0x2e, 0x76, 0x31, 0x2e, 0x52, 0x65, 0x73, 0x75, 0x6c, 0x74, 0x42,
	0x6c, 0x6f, 0x63, 0x6b, 0x52, 0x65, 0x73, 0x75, 0x6c, 0x74, 0x73, 0x52, 0x0c, 0x62, 0x6c, 0x6f,
	0x63, 0x6b, 0x52, 0x65, 0x73, 0x75, 0x6c, 0x74, 0x73, 0x22, 0xd4, 0x01, 0x0a, 0x17, 0x51, 0x75,
	0x65, 0x72, 0x79, 0x42, 0x6c, 0x6f, 0x63, 0x6b, 0x53, 0x65, 0x61, 0x72, 0x63, 0x68, 0x52, 0x65,
	0x71, 0x75, 0x65, 0x73, 0x74, 0x12, 0x32, 0x0a, 0x12, 0x70, 0x61, 0x63, 0x6b, 0x65, 0x74, 0x5f,
	0x73, 0x72, 0x63, 0x5f, 0x63, 0x68, 0x61, 0x6e, 0x6e, 0x65, 0x6c, 0x18, 0x01, 0x20, 0x01, 0x28,
	0x09, 0x42, 0x04, 0xc8, 0xde, 0x1f, 0x01, 0x52, 0x10, 0x70, 0x61, 0x63, 0x6b, 0x65, 0x74, 0x53,
	0x72, 0x63, 0x43, 0x68, 0x61, 0x6e, 0x6e, 0x65, 0x6c, 0x12, 0x32, 0x0a, 0x12, 0x70, 0x61, 0x63,
	0x6b, 0x65, 0x74, 0x5f, 0x64, 0x73, 0x74, 0x5f, 0x63, 0x68, 0x61, 0x6e, 0x6e, 0x65, 0x6c, 0x18,
	0x02, 0x20, 0x01, 0x28, 0x09, 0x42, 0x04, 0xc8, 0xde, 0x1f, 0x01, 0x52, 0x10, 0x70, 0x61, 0x63,
	0x6b, 0x65, 0x74, 0x44, 0x73, 0x74, 0x43, 0x68, 0x61, 0x6e, 0x6e, 0x65, 0x6c, 0x12, 0x27, 0x0a,
	0x0f, 0x70, 0x61, 0x63, 0x6b, 0x65, 0x74, 0x5f, 0x73, 0x65, 0x71, 0x75, 0x65, 0x6e, 0x63, 0x65,
	0x18, 0x03, 0x20, 0x01, 0x28, 0x09, 0x52, 0x0e, 0x70, 0x61, 0x63, 0x6b, 0x65, 0x74, 0x53, 0x65,
	0x71, 0x75, 0x65, 0x6e, 0x63, 0x65, 0x12, 0x14, 0x0a, 0x05, 0x6c, 0x69, 0x6d, 0x69, 0x74, 0x18,
	0x04, 0x20, 0x01, 0x28, 0x04, 0x52, 0x05, 0x6c, 0x69, 0x6d, 0x69, 0x74, 0x12, 0x12, 0x0a, 0x04,
	0x70, 0x61, 0x67, 0x65, 0x18, 0x05, 0x20, 0x01, 0x28, 0x04, 0x52, 0x04, 0x70, 0x61, 0x67, 0x65,
	0x22, 0x79, 0x0a, 0x18, 0x51, 0x75, 0x65, 0x72, 0x79, 0x42, 0x6c, 0x6f, 0x63, 0x6b, 0x53, 0x65,
	0x61, 0x72, 0x63, 0x68, 0x52, 0x65, 0x73, 0x70, 0x6f, 0x6e, 0x73, 0x65, 0x12, 0x3c, 0x0a, 0x06,
	0x62, 0x6c, 0x6f, 0x63, 0x6b, 0x73, 0x18, 0x01, 0x20, 0x03, 0x28, 0x0b, 0x32, 0x24, 0x2e, 0x69,
	0x62, 0x63, 0x2e, 0x63, 0x6f, 0x72, 0x65, 0x2e, 0x74, 0x79, 0x70, 0x65, 0x73, 0x2e, 0x76, 0x31,
	0x2e, 0x52, 0x65, 0x73, 0x75, 0x6c, 0x74, 0x42, 0x6c, 0x6f, 0x63, 0x6b, 0x53, 0x65, 0x61, 0x72,
	0x63, 0x68, 0x52, 0x06, 0x62, 0x6c, 0x6f, 0x63, 0x6b, 0x73, 0x12, 0x1f, 0x0a, 0x0b, 0x74, 0x6f,
	0x74, 0x61, 0x6c, 0x5f, 0x63, 0x6f, 0x75, 0x6e, 0x74, 0x18, 0x02, 0x20, 0x01, 0x28, 0x04, 0x52,
	0x0a, 0x74, 0x6f, 0x74, 0x61, 0x6c, 0x43, 0x6f, 0x75, 0x6e, 0x74, 0x22, 0x33, 0x0a, 0x1d, 0x51,
	0x75, 0x65, 0x72, 0x79, 0x54, 0x72, 0x61, 0x6e, 0x73, 0x61, 0x63, 0x74, 0x69, 0x6f, 0x6e, 0x42,
	0x79, 0x48, 0x61, 0x73, 0x68, 0x52, 0x65, 0x71, 0x75, 0x65, 0x73, 0x74, 0x12, 0x12, 0x0a, 0x04,
	0x68, 0x61, 0x73, 0x68, 0x18, 0x01, 0x20, 0x01, 0x28, 0x09, 0x52, 0x04, 0x68, 0x61, 0x73, 0x68,
	0x22, 0xb0, 0x01, 0x0a, 0x1e, 0x51, 0x75, 0x65, 0x72, 0x79, 0x54, 0x72, 0x61, 0x6e, 0x73, 0x61,
	0x63, 0x74, 0x69, 0x6f, 0x6e, 0x42, 0x79, 0x48, 0x61, 0x73, 0x68, 0x52, 0x65, 0x73, 0x70, 0x6f,
	0x6e, 0x73, 0x65, 0x12, 0x12, 0x0a, 0x04, 0x68, 0x61, 0x73, 0x68, 0x18, 0x01, 0x20, 0x01, 0x28,
	0x09, 0x52, 0x04, 0x68, 0x61, 0x73, 0x68, 0x12, 0x16, 0x0a, 0x06, 0x68, 0x65, 0x69, 0x67, 0x68,
	0x74, 0x18, 0x02, 0x20, 0x01, 0x28, 0x04, 0x52, 0x06, 0x68, 0x65, 0x69, 0x67, 0x68, 0x74, 0x12,
	0x17, 0x0a, 0x07, 0x67, 0x61, 0x73, 0x5f, 0x66, 0x65, 0x65, 0x18, 0x03, 0x20, 0x01, 0x28, 0x04,
	0x52, 0x06, 0x67, 0x61, 0x73, 0x46, 0x65, 0x65, 0x12, 0x17, 0x0a, 0x07, 0x74, 0x78, 0x5f, 0x73,
	0x69, 0x7a, 0x65, 0x18, 0x04, 0x20, 0x01, 0x28, 0x04, 0x52, 0x06, 0x74, 0x78, 0x53, 0x69, 0x7a,
	0x65, 0x12, 0x30, 0x0a, 0x06, 0x65, 0x76, 0x65, 0x6e, 0x74, 0x73, 0x18, 0x05, 0x20, 0x03, 0x28,
	0x0b, 0x32, 0x18, 0x2e, 0x69, 0x62, 0x63, 0x2e, 0x63, 0x6f, 0x72, 0x65, 0x2e, 0x74, 0x79, 0x70,
	0x65, 0x73, 0x2e, 0x76, 0x31, 0x2e, 0x45, 0x76, 0x65, 0x6e, 0x74, 0x52, 0x06, 0x65, 0x76, 0x65,
	0x6e, 0x74, 0x73, 0x22, 0x2f, 0x0a, 0x15, 0x51, 0x75, 0x65, 0x72, 0x79, 0x49, 0x42, 0x43, 0x48,
	0x65, 0x61, 0x64, 0x65, 0x72, 0x52, 0x65, 0x71, 0x75, 0x65, 0x73, 0x74, 0x12, 0x16, 0x0a, 0x06,
	0x68, 0x65, 0x69, 0x67, 0x68, 0x74, 0x18, 0x02, 0x20, 0x01, 0x28, 0x04, 0x52, 0x06, 0x68, 0x65,
	0x69, 0x67, 0x68, 0x74, 0x22, 0x46, 0x0a, 0x16, 0x51, 0x75, 0x65, 0x72, 0x79, 0x49, 0x42, 0x43,
	0x48, 0x65, 0x61, 0x64, 0x65, 0x72, 0x52, 0x65, 0x73, 0x70, 0x6f, 0x6e, 0x73, 0x65, 0x12, 0x2c,
	0x0a, 0x06, 0x68, 0x65, 0x61, 0x64, 0x65, 0x72, 0x18, 0x01, 0x20, 0x01, 0x28, 0x0b, 0x32, 0x14,
	0x2e, 0x67, 0x6f, 0x6f, 0x67, 0x6c, 0x65, 0x2e, 0x70, 0x72, 0x6f, 0x74, 0x6f, 0x62, 0x75, 0x66,
	0x2e, 0x41, 0x6e, 0x79, 0x52, 0x06, 0x68, 0x65, 0x61, 0x64, 0x65, 0x72, 0x32, 0xe5, 0x04, 0x0a,
	0x05, 0x51, 0x75, 0x65, 0x72, 0x79, 0x12, 0x93, 0x01, 0x0a, 0x0c, 0x42, 0x6c, 0x6f, 0x63, 0x6b,
	0x52, 0x65, 0x73, 0x75, 0x6c, 0x74, 0x73, 0x12, 0x2b, 0x2e, 0x69, 0x62, 0x63, 0x2e, 0x63, 0x6f,
	0x72, 0x65, 0x2e, 0x74, 0x79, 0x70, 0x65, 0x73, 0x2e, 0x76, 0x31, 0x2e, 0x51, 0x75, 0x65, 0x72,
	0x79, 0x42, 0x6c, 0x6f, 0x63, 0x6b, 0x52, 0x65, 0x73, 0x75, 0x6c, 0x74, 0x73, 0x52, 0x65, 0x71,
	0x75, 0x65, 0x73, 0x74, 0x1a, 0x2c, 0x2e, 0x69, 0x62, 0x63, 0x2e, 0x63, 0x6f, 0x72, 0x65, 0x2e,
	0x74, 0x79, 0x70, 0x65, 0x73, 0x2e, 0x76, 0x31, 0x2e, 0x51, 0x75, 0x65, 0x72, 0x79, 0x42, 0x6c,
	0x6f, 0x63, 0x6b, 0x52, 0x65, 0x73, 0x75, 0x6c, 0x74, 0x73, 0x52, 0x65, 0x73, 0x70, 0x6f, 0x6e,
	0x73, 0x65, 0x22, 0x28, 0x82, 0xd3, 0xe4, 0x93, 0x02, 0x22, 0x12, 0x20, 0x2f, 0x69, 0x62, 0x63,
	0x2f, 0x63, 0x6f, 0x72, 0x65, 0x2f, 0x74, 0x79, 0x70, 0x65, 0x73, 0x2f, 0x76, 0x31, 0x2f, 0x62,
	0x6c, 0x6f, 0x63, 0x6b, 0x5f, 0x72, 0x65, 0x73, 0x75, 0x6c, 0x74, 0x73, 0x12, 0x90, 0x01, 0x0a,
	0x0b, 0x42, 0x6c, 0x6f, 0x63, 0x6b, 0x53, 0x65, 0x61, 0x72, 0x63, 0x68, 0x12, 0x2a, 0x2e, 0x69,
	0x62, 0x63, 0x2e, 0x63, 0x6f, 0x72, 0x65, 0x2e, 0x74, 0x79, 0x70, 0x65, 0x73, 0x2e, 0x76, 0x31,
	0x2e, 0x51, 0x75, 0x65, 0x72, 0x79, 0x42, 0x6c, 0x6f, 0x63, 0x6b, 0x53, 0x65, 0x61, 0x72, 0x63,
	0x68, 0x52, 0x65, 0x71, 0x75, 0x65, 0x73, 0x74, 0x1a, 0x2b, 0x2e, 0x69, 0x62, 0x63, 0x2e, 0x63,
	0x6f, 0x72, 0x65, 0x2e, 0x74, 0x79, 0x70, 0x65, 0x73, 0x2e, 0x76, 0x31, 0x2e, 0x51, 0x75, 0x65,
	0x72, 0x79, 0x42, 0x6c, 0x6f, 0x63, 0x6b, 0x53, 0x65, 0x61, 0x72, 0x63, 0x68, 0x52, 0x65, 0x73,
	0x70, 0x6f, 0x6e, 0x73, 0x65, 0x22, 0x28, 0x82, 0xd3, 0xe4, 0x93, 0x02, 0x22, 0x12, 0x20, 0x2f,
	0x69, 0x62, 0x63, 0x2f, 0x63, 0x6f, 0x72, 0x65, 0x2f, 0x74, 0x79, 0x70, 0x65, 0x73, 0x2f, 0x76,
	0x31, 0x2f, 0x62, 0x6c, 0x6f, 0x63, 0x6b, 0x5f, 0x72, 0x65, 0x73, 0x75, 0x6c, 0x74, 0x73, 0x12,
	0xa8, 0x01, 0x0a, 0x11, 0x54, 0x72, 0x61, 0x6e, 0x73, 0x61, 0x63, 0x74, 0x69, 0x6f, 0x6e, 0x42,
	0x79, 0x48, 0x61, 0x73, 0x68, 0x12, 0x30, 0x2e, 0x69, 0x62, 0x63, 0x2e, 0x63, 0x6f, 0x72, 0x65,
	0x2e, 0x74, 0x79, 0x70, 0x65, 0x73, 0x2e, 0x76, 0x31, 0x2e, 0x51, 0x75, 0x65, 0x72, 0x79, 0x54,
	0x72, 0x61, 0x6e, 0x73, 0x61, 0x63, 0x74, 0x69, 0x6f, 0x6e, 0x42, 0x79, 0x48, 0x61, 0x73, 0x68,
	0x52, 0x65, 0x71, 0x75, 0x65, 0x73, 0x74, 0x1a, 0x31, 0x2e, 0x69, 0x62, 0x63, 0x2e, 0x63, 0x6f,
	0x72, 0x65, 0x2e, 0x74, 0x79, 0x70, 0x65, 0x73, 0x2e, 0x76, 0x31, 0x2e, 0x51, 0x75, 0x65, 0x72,
	0x79, 0x54, 0x72, 0x61, 0x6e, 0x73, 0x61, 0x63, 0x74, 0x69, 0x6f, 0x6e, 0x42, 0x79, 0x48, 0x61,
	0x73, 0x68, 0x52, 0x65, 0x73, 0x70, 0x6f, 0x6e, 0x73, 0x65, 0x22, 0x2e, 0x82, 0xd3, 0xe4, 0x93,
	0x02, 0x28, 0x12, 0x26, 0x2f, 0x69, 0x62, 0x63, 0x2f, 0x63, 0x6f, 0x72, 0x65, 0x2f, 0x74, 0x79,
	0x70, 0x65, 0x73, 0x2f, 0x76, 0x31, 0x2f, 0x74, 0x72, 0x61, 0x6e, 0x73, 0x61, 0x63, 0x74, 0x69,
	0x6f, 0x6e, 0x5f, 0x62, 0x79, 0x5f, 0x68, 0x61, 0x73, 0x68, 0x12, 0x87, 0x01, 0x0a, 0x09, 0x49,
	0x42, 0x43, 0x48, 0x65, 0x61, 0x64, 0x65, 0x72, 0x12, 0x28, 0x2e, 0x69, 0x62, 0x63, 0x2e, 0x63,
	0x6f, 0x72, 0x65, 0x2e, 0x74, 0x79, 0x70, 0x65, 0x73, 0x2e, 0x76, 0x31, 0x2e, 0x51, 0x75, 0x65,
	0x72, 0x79, 0x49, 0x42, 0x43, 0x48, 0x65, 0x61, 0x64, 0x65, 0x72, 0x52, 0x65, 0x71, 0x75, 0x65,
	0x73, 0x74, 0x1a, 0x29, 0x2e, 0x69, 0x62, 0x63, 0x2e, 0x63, 0x6f, 0x72, 0x65, 0x2e, 0x74, 0x79,
	0x70, 0x65, 0x73, 0x2e, 0x76, 0x31, 0x2e, 0x51, 0x75, 0x65, 0x72, 0x79, 0x49, 0x42, 0x43, 0x48,
	0x65, 0x61, 0x64, 0x65, 0x72, 0x52, 0x65, 0x73, 0x70, 0x6f, 0x6e, 0x73, 0x65, 0x22, 0x25, 0x82,
	0xd3, 0xe4, 0x93, 0x02, 0x1f, 0x12, 0x1d, 0x2f, 0x69, 0x62, 0x63, 0x2f, 0x63, 0x6f, 0x72, 0x65,
	0x2f, 0x74, 0x79, 0x70, 0x65, 0x73, 0x2f, 0x76, 0x31, 0x2f, 0x69, 0x62, 0x63, 0x5f, 0x68, 0x65,
	0x61, 0x64, 0x65, 0x72, 0x42, 0x30, 0x5a, 0x2e, 0x67, 0x69, 0x74, 0x68, 0x75, 0x62, 0x2e, 0x63,
	0x6f, 0x6d, 0x2f, 0x63, 0x6f, 0x73, 0x6d, 0x6f, 0x73, 0x2f, 0x69, 0x62, 0x63, 0x2d, 0x67, 0x6f,
	0x2f, 0x76, 0x37, 0x2f, 0x6d, 0x6f, 0x64, 0x75, 0x6c, 0x65, 0x73, 0x2f, 0x63, 0x6f, 0x72, 0x65,
	0x2f, 0x74, 0x79, 0x70, 0x65, 0x73, 0x62, 0x06, 0x70, 0x72, 0x6f, 0x74, 0x6f, 0x33,
}

var (
	file_ibc_core_types_v1_query_proto_rawDescOnce sync.Once
	file_ibc_core_types_v1_query_proto_rawDescData = file_ibc_core_types_v1_query_proto_rawDesc
)

func file_ibc_core_types_v1_query_proto_rawDescGZIP() []byte {
	file_ibc_core_types_v1_query_proto_rawDescOnce.Do(func() {
		file_ibc_core_types_v1_query_proto_rawDescData = protoimpl.X.CompressGZIP(file_ibc_core_types_v1_query_proto_rawDescData)
	})
	return file_ibc_core_types_v1_query_proto_rawDescData
}

var file_ibc_core_types_v1_query_proto_msgTypes = make([]protoimpl.MessageInfo, 8)
var file_ibc_core_types_v1_query_proto_goTypes = []interface{}{
	(*QueryBlockResultsRequest)(nil),       // 0: ibc.core.types.v1.QueryBlockResultsRequest
	(*QueryBlockResultsResponse)(nil),      // 1: ibc.core.types.v1.QueryBlockResultsResponse
	(*QueryBlockSearchRequest)(nil),        // 2: ibc.core.types.v1.QueryBlockSearchRequest
	(*QueryBlockSearchResponse)(nil),       // 3: ibc.core.types.v1.QueryBlockSearchResponse
	(*QueryTransactionByHashRequest)(nil),  // 4: ibc.core.types.v1.QueryTransactionByHashRequest
	(*QueryTransactionByHashResponse)(nil), // 5: ibc.core.types.v1.QueryTransactionByHashResponse
	(*QueryIBCHeaderRequest)(nil),          // 6: ibc.core.types.v1.QueryIBCHeaderRequest
	(*QueryIBCHeaderResponse)(nil),         // 7: ibc.core.types.v1.QueryIBCHeaderResponse
	(*ResultBlockResults)(nil),             // 8: ibc.core.types.v1.ResultBlockResults
	(*ResultBlockSearch)(nil),              // 9: ibc.core.types.v1.ResultBlockSearch
	(*Event)(nil),                          // 10: ibc.core.types.v1.Event
	(*anypb.Any)(nil),                      // 11: google.protobuf.Any
}
var file_ibc_core_types_v1_query_proto_depIdxs = []int32{
	8,  // 0: ibc.core.types.v1.QueryBlockResultsResponse.block_results:type_name -> ibc.core.types.v1.ResultBlockResults
	9,  // 1: ibc.core.types.v1.QueryBlockSearchResponse.blocks:type_name -> ibc.core.types.v1.ResultBlockSearch
	10, // 2: ibc.core.types.v1.QueryTransactionByHashResponse.events:type_name -> ibc.core.types.v1.Event
	11, // 3: ibc.core.types.v1.QueryIBCHeaderResponse.header:type_name -> google.protobuf.Any
	0,  // 4: ibc.core.types.v1.Query.BlockResults:input_type -> ibc.core.types.v1.QueryBlockResultsRequest
	2,  // 5: ibc.core.types.v1.Query.BlockSearch:input_type -> ibc.core.types.v1.QueryBlockSearchRequest
	4,  // 6: ibc.core.types.v1.Query.TransactionByHash:input_type -> ibc.core.types.v1.QueryTransactionByHashRequest
	6,  // 7: ibc.core.types.v1.Query.IBCHeader:input_type -> ibc.core.types.v1.QueryIBCHeaderRequest
	1,  // 8: ibc.core.types.v1.Query.BlockResults:output_type -> ibc.core.types.v1.QueryBlockResultsResponse
	3,  // 9: ibc.core.types.v1.Query.BlockSearch:output_type -> ibc.core.types.v1.QueryBlockSearchResponse
	5,  // 10: ibc.core.types.v1.Query.TransactionByHash:output_type -> ibc.core.types.v1.QueryTransactionByHashResponse
	7,  // 11: ibc.core.types.v1.Query.IBCHeader:output_type -> ibc.core.types.v1.QueryIBCHeaderResponse
	8,  // [8:12] is the sub-list for method output_type
	4,  // [4:8] is the sub-list for method input_type
	4,  // [4:4] is the sub-list for extension type_name
	4,  // [4:4] is the sub-list for extension extendee
	0,  // [0:4] is the sub-list for field type_name
}

func init() { file_ibc_core_types_v1_query_proto_init() }
func file_ibc_core_types_v1_query_proto_init() {
	if File_ibc_core_types_v1_query_proto != nil {
		return
	}
	file_ibc_core_types_v1_block_proto_init()
	if !protoimpl.UnsafeEnabled {
		file_ibc_core_types_v1_query_proto_msgTypes[0].Exporter = func(v interface{}, i int) interface{} {
			switch v := v.(*QueryBlockResultsRequest); i {
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
		file_ibc_core_types_v1_query_proto_msgTypes[1].Exporter = func(v interface{}, i int) interface{} {
			switch v := v.(*QueryBlockResultsResponse); i {
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
		file_ibc_core_types_v1_query_proto_msgTypes[2].Exporter = func(v interface{}, i int) interface{} {
			switch v := v.(*QueryBlockSearchRequest); i {
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
		file_ibc_core_types_v1_query_proto_msgTypes[3].Exporter = func(v interface{}, i int) interface{} {
			switch v := v.(*QueryBlockSearchResponse); i {
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
		file_ibc_core_types_v1_query_proto_msgTypes[4].Exporter = func(v interface{}, i int) interface{} {
			switch v := v.(*QueryTransactionByHashRequest); i {
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
		file_ibc_core_types_v1_query_proto_msgTypes[5].Exporter = func(v interface{}, i int) interface{} {
			switch v := v.(*QueryTransactionByHashResponse); i {
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
		file_ibc_core_types_v1_query_proto_msgTypes[6].Exporter = func(v interface{}, i int) interface{} {
			switch v := v.(*QueryIBCHeaderRequest); i {
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
		file_ibc_core_types_v1_query_proto_msgTypes[7].Exporter = func(v interface{}, i int) interface{} {
			switch v := v.(*QueryIBCHeaderResponse); i {
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
			RawDescriptor: file_ibc_core_types_v1_query_proto_rawDesc,
			NumEnums:      0,
			NumMessages:   8,
			NumExtensions: 0,
			NumServices:   1,
		},
		GoTypes:           file_ibc_core_types_v1_query_proto_goTypes,
		DependencyIndexes: file_ibc_core_types_v1_query_proto_depIdxs,
		MessageInfos:      file_ibc_core_types_v1_query_proto_msgTypes,
	}.Build()
	File_ibc_core_types_v1_query_proto = out.File
	file_ibc_core_types_v1_query_proto_rawDesc = nil
	file_ibc_core_types_v1_query_proto_goTypes = nil
	file_ibc_core_types_v1_query_proto_depIdxs = nil
}
