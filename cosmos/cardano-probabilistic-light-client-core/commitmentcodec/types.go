// Package commitmentcodec defines the frozen Cardano IBC commitment formats.
// Its wire types and comparisons do not depend on an ibc-go major version.
package commitmentcodec

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
	UpgradePath     [][]byte
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

type TokenDatum struct {
	_              struct{} `cbor:",toarray"`
	PolicyId, Name []byte
}

type ModuleRegistrationDatum struct {
	_                      struct{} `cbor:",toarray"`
	ModuleScriptHash       []byte
	PortToken, ModuleToken TokenDatum
}
