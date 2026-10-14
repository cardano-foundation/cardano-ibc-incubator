package cardanodatum

import (
	"github.com/blinklabs-io/gouroboros/ledger"
	commitmentcodec "github.com/cardano-foundation/cardano-ibc-incubator/cosmos/cardano-probabilistic-light-client-core/commitmentcodec"
)

// This package contains CBOR/Plutus datum shapes used by the Cardano chain.
//
// The Cardano probabilistic IBC light client needs these types to semantically
// compare values committed by Cardano with protobuf-encoded values used by
// ibc-go.

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

type RootHashInDatum = commitmentcodec.RootHashInDatum

type ConsensusStateDatum = commitmentcodec.ConsensusStateDatum

type TrustLevelDatum = commitmentcodec.TrustLevelDatum

type HeightDatum = commitmentcodec.HeightDatum

type LeafSpecDatum = commitmentcodec.LeafSpecDatum

type InnerSpecDatum = commitmentcodec.InnerSpecDatum

type ProofSpecsDatum = commitmentcodec.ProofSpecsDatum

type ClientStateDatum = commitmentcodec.ClientStateDatum

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

type ConnectionDatum struct {
	_     struct{} `cbor:",toarray"`
	State ConnectionEndDatum
	Token TokenDatum
}

type ConnectionEndDatum = commitmentcodec.ConnectionEndDatum

type VersionDatum = commitmentcodec.VersionDatum

type CounterpartyDatum = commitmentcodec.CounterpartyDatum

type MerklePrefixDatum = commitmentcodec.MerklePrefixDatum

type ChannelCounterpartyDatum = commitmentcodec.ChannelCounterpartyDatum

type ChannelDatum = commitmentcodec.ChannelDatum

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
