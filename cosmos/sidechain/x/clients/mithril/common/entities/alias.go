package entities

import "sidechain/x/clients/mithril/crypto"

type ImmutableFileNumber = uint64

type ProtocolVersion = string

type PartyId = string

type Stake = uint64

type ProtocolMultiSignature struct {
	Key crypto.StmAggrSig
}
