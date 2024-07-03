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
