package cardano

import "github.com/blinklabs-io/gouroboros/ledger"

type SPOState struct {
	IsRegisCert bool
	PoolId      string
	PoolVrf     string
	BlockNo     uint64
	TxIndex     uint64
}

type VerifyBlockOutput struct {
	_             struct{} `cbor:",toarray"`
	Flag          int
	IsValid       bool
	VrfKHexString string
	BlockNo       string
	SlotNo        string
}

type ExtractBlockOutput struct {
	_            struct{} `cbor:",toarray"`
	Flag         int
	Outputs      []ledger.UTXOOutput
	RegisCerts   []ledger.RegisCert
	DeRegisCerts []ledger.DeRegisCert
}

//////////////////////////////////////////////////////
// Struct type saved at Cardano side

// Client and consensus state
type RootHashInDatum struct {
	_    struct{} `cbor:",toarray"`
	Hash []byte
}

type ConsensusStateDatum struct {
	_                  struct{} `cbor:",toarray"`
	Timestamp          uint64
	NextValidatorsHash []byte
	Root               RootHashInDatum
}

type TrustLevelDatum struct {
	_           struct{} `cbor:",toarray"`
	Numerator   uint64
	Denominator uint64
}

type HeightDatum struct {
	_              struct{} `cbor:",toarray"`
	RevisionNumber uint64
	RevisionHeight uint64
}

type LeafSpecDatum struct {
	_            struct{} `cbor:",toarray"`
	Hash         int32
	PrehashKey   int32
	PrehashValue int32
	Length       int32
	Prefix       []byte
}

type InnerSpecDatum struct {
	_               struct{} `cbor:",toarray"`
	ChildOrder      []int32
	ChildSize       int32
	MinPrefixLength int32
	MaxPrefixLength int32
	EmptyChild      []byte
	Hash            int32
}

type ProofSpecsDatum struct {
	_         struct{} `cbor:",toarray"`
	LeafSpec  LeafSpecDatum
	InnerSpec InnerSpecDatum
	MaxDepth  int32
	MinDepth  int32
	// (PrehashKeyBeforeComparison.(cbor.Tag)).Number => False: 121, True: 122
	PrehashKeyBeforeComparison interface{}
}

type ClientStateDatum struct {
	_               struct{} `cbor:",toarray"`
	ChainId         []byte
	TrustLevel      TrustLevelDatum
	TrustingPeriod  uint64
	UnbondingPeriod uint64
	MaxClockDrift   uint64
	FrozenHeight    HeightDatum
	LatestHeight    HeightDatum
	ProofSpecs      []ProofSpecsDatum
}

type TokenDatum struct {
	_        struct{} `cbor:",toarray"`
	PolicyId []byte
	Name     []byte
}

type ClientDatumState struct {
	_               struct{} `cbor:",toarray"`
	ClientState     ClientStateDatum
	ConsensusStates map[HeightDatum]ConsensusStateDatum
}

type ClientDatum struct {
	_     struct{} `cbor:",toarray"`
	State ClientDatumState
	Token TokenDatum
}

// Connection State
type ConnectionDatum struct {
	_     struct{} `cbor:",toarray"`
	State ConnectionEndDatum
	Token TokenDatum
}

type ConnectionEndDatum struct {
	_        struct{} `cbor:",toarray"`
	ClientId []byte
	Versions []VersionDatum
	// Little hack with this kind of Enum
	// (State.(cbor.Tag)).Number => UNINITIALIZED: 121, INIT: 122, TRYOPEN: 123, OPEN: 124
	State        interface{}
	Counterparty CounterpartyDatum
	DelayPeriod  uint64
}

type VersionDatum struct {
	_          struct{} `cbor:",toarray"`
	Identifier []byte
	Features   [][]byte
}

type CounterpartyDatum struct {
	_            struct{} `cbor:",toarray"`
	ClientId     []byte
	ConnectionId []byte
	Prefix       MerklePrefixDatum
}

type MerklePrefixDatum struct {
	_         struct{} `cbor:",toarray"`
	KeyPrefix []byte
}

type ChannelCounterpartyDatum struct {
	_         struct{} `cbor:",toarray"`
	PortId    []byte
	ChannelId []byte
}

type ChannelDatum struct {
	_ struct{} `cbor:",toarray"`
	// Little hack with this kind of Enum
	// (State.(cbor.Tag)).Number => UNINITIALIZED: 121, INIT: 122, TRYOPEN: 123, OPEN: 124, CLOSED: 125
	State interface{}
	// Little hack with this kind of Enum
	// (Ordering.(cbor.Tag)).Number => None: 121, Unordered: 122, Ordered: 123
	Ordering       interface{}
	Counterparty   ChannelCounterpartyDatum
	ConnectionHops [][]byte
	Version        []byte
}

type ChannelDatumState struct {
	_                     struct{} `cbor:",toarray"`
	Channel               ChannelDatum
	NextSequenceSend      uint64
	NextSequenceRecv      uint64
	NextSequenceAck       uint64
	PacketCommitment      map[uint64][]byte
	PacketReceipt         map[uint64][]byte
	PacketAcknowledgement map[uint64][]byte
}

type ChannelDatumWithPort struct {
	_      struct{} `cbor:",toarray"`
	State  ChannelDatumState
	PortId []byte
	Token  TokenDatum
}

//
//////////////////////////////////////////////////////
