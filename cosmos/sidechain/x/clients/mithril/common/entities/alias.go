package entities

import "sidechain/x/clients/mithril/crypto"

type ImmutableFileNumber = uint64

type ProtocolVersion = string

type PartyId = string

type Stake = uint64

type ProtocolMultiSignature struct {
	Key *crypto.StmAggrSig
}

type ProtocolStakeDistribution = []*struct {
	PartyId ProtocolPartyId
	Stake   ProtocolStake
}

type ProtocolPartyId = string

type ProtocolStake = Stake

type ProtocolSigner = crypto.StmSigner

type ProtocolInitializer = StmInitializerWrapper
