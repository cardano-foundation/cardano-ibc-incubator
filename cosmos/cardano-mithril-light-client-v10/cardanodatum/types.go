package cardanodatum

import (
	"github.com/blinklabs-io/gouroboros/ledger"
	codec "github.com/cardano-foundation/cardano-ibc-incubator/cosmos/cardano-probabilistic-light-client-core/commitmentcodec"
)

// This package contains CBOR/Plutus datum shapes used by the Cardano chain.
//
// The Mithril IBC light client needs these types to semantically compare values committed by
// Cardano (which are CBOR-serialized datums) with the protobuf-encoded values used by ibc-go.
//
// It is intentionally *not* an IBC light client implementation: it is a small set of decoding
// helpers that support the Mithril client's membership/non-membership verification logic.

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
	RegisCerts   []ledger.PoolRegistrationCertificate
	DeRegisCerts []ledger.PoolRetirementCertificate
}

//////////////////////////////////////////////////////
// Struct types saved on the Cardano side (CBOR / PlutusData)

// Client and consensus state
type RootHashInDatum = codec.RootHashInDatum

type ConsensusStateDatum codec.ConsensusStateDatum

type TrustLevelDatum = codec.TrustLevelDatum

type HeightDatum = codec.HeightDatum

type LeafSpecDatum = codec.LeafSpecDatum

type InnerSpecDatum = codec.InnerSpecDatum

type ProofSpecsDatum = codec.ProofSpecsDatum

type ClientStateDatum codec.ClientStateDatum

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

type ConnectionEndDatum codec.ConnectionEndDatum

type VersionDatum = codec.VersionDatum

type CounterpartyDatum = codec.CounterpartyDatum

type MerklePrefixDatum = codec.MerklePrefixDatum

type ChannelCounterpartyDatum = codec.ChannelCounterpartyDatum

type ChannelDatum codec.ChannelDatum

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
