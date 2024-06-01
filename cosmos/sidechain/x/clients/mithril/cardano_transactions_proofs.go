package mithril

import "sidechain/x/clients/mithril/common/entities"

type CardanoTransactionsProofsMessage struct {
	CertificateHash           string
	CertifiedTransactions     []*CardanoTransactionsSetProofMessagePart
	NonCertifiedTransactions  []entities.TransactionHash
	LatestImmutableFileNumber uint64
}

type CardanoTransactionsSetProofMessagePart struct {
	TransactionsHashes []entities.TransactionHash
	Proof              entities.HexEncodedKey
}

type VerifiedCardanoTransaction struct {
	CertificateHash           string
	MerkleRoot                string
	CertifiedTransactions     []entities.TransactionHash
	LatestImmutableFileNumber uint64
}

func (pm *CardanoTransactionsProofsMessage) Verify() (*VerifiedCardanoTransaction, error) {
	return nil, nil
}
