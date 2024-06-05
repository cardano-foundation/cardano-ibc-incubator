package ibc_types

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

type MintChannelRedeemerSchemaChanOpenInit struct {
	_                struct{} `cbor:",toarray"`
	HandlerAuthToken AuthTokenSchema
}

type MintChannelRedeemerSchemaChanOpenTry[ProofInitType any] struct {
	_                   struct{} `cbor:",toarray"`
	HandlerAuthToken    AuthTokenSchema
	CounterpartyVersion []byte
	ProofInit           MerkleProofSchema[ProofInitType]
	ProofHeight         HeightSchema
}

type SpendChannelRedeemerChanOpenAck[ProofTryType any] struct {
	_                   struct{} `cbor:",toarray"`
	CounterpartyVersion []byte
	ProofTry            MerkleProofSchema[ProofTryType]
	ProofHeight         HeightSchema
}

type SpendChannelRedeemerChanOpenConfirm[ProofAckType any] struct {
	_           struct{} `cbor:",toarray"`
	ProofAck    MerkleProofSchema[ProofAckType]
	ProofHeight HeightSchema
}

type SpendChannelRedeemerRecvPacket[ProofCommitmentType any] struct {
	_               struct{} `cbor:",toarray"`
	Packet          PacketSchema
	ProofCommitment MerkleProofSchema[ProofCommitmentType]
	ProofHeight     HeightSchema
}
type SpendChannelRedeemerTimeoutPacket[ProofUnreceivedType any] struct {
	_                struct{} `cbor:",toarray"`
	Packet           PacketSchema
	ProofUnreceived  MerkleProofSchema[ProofUnreceivedType]
	ProofHeight      HeightSchema
	NextSequenceRecv uint64
}
type SpendChannelRedeemerAcknowledgePacket[ProofAckedType any] struct {
	_               struct{} `cbor:",toarray"`
	Packet          PacketSchema
	Acknowledgement []byte
	ProofAcked      MerkleProofSchema[ProofAckedType]
	ProofHeight     HeightSchema
}
type SpendChannelRedeemerSendPacket struct {
	_      struct{} `cbor:",toarray"`
	Packet PacketSchema
}

// Data.Literal('RefreshUtxo')

type SpendChannelRedeemerRefreshUtxo interface {
}
