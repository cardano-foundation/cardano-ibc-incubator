package ibc_types

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
