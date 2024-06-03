package helpers

type TokenDatum struct {
	_        struct{} `cbor:",toarray"`
	PolicyId []byte
	Name     []byte
}

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
