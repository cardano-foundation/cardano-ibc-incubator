package mithril

import (
	"sidechain/x/clients/mithril/common/entities"

	errorsmod "cosmossdk.io/errors"
)

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

func (part *CardanoTransactionsSetProofMessagePart) ToCardanoTransactionsSetProof() (*entities.CardanoTransactionsSetProof, error) {
	proof, err := new(entities.ProtocolMkProof).FromJSONHex(part.Proof)
	if err != nil {
		return nil, err
	}
	return &entities.CardanoTransactionsSetProof{
		TransactionsHashes: part.TransactionsHashes,
		TransactionsProof:  proof,
	}, nil
}

type VerifiedCardanoTransactions struct {
	CertificateHash           string
	MerkleRoot                string
	CertifiedTransactions     []entities.TransactionHash
	LatestImmutableFileNumber uint64
}

func (pm *CardanoTransactionsProofsMessage) Verify() (*VerifiedCardanoTransactions, error) {
	var merkleRoot string

	for _, certifiedTransaction := range pm.CertifiedTransactions {
		// Assuming CardanoTransactionsSetProofMessagePart has a method to convert it to CardanoTransactionsSetProof
		certifiedTransactionProof, err := certifiedTransaction.ToCardanoTransactionsSetProof()
		if err != nil {
			return nil, errorsmod.Wrapf(ErrInvalidCardanoTransactionsProofs, "MalformedData %v", err)
		}

		err = certifiedTransactionProof.Verify()
		if err != nil {
			return nil, errorsmod.Wrapf(ErrInvalidCardanoTransactionsProofs, "InvalidSetProof, Transaction Hashes: %v, Source: %v", certifiedTransactionProof.TransactionsHashes, err)
		}

		txMerkleRoot := certifiedTransactionProof.MerkleRoot()

		if merkleRoot == "" {
			merkleRoot = txMerkleRoot
		} else if merkleRoot != txMerkleRoot {
			return nil, errorsmod.Wrapf(ErrInvalidCardanoTransactionsProofs, "NonMatchingMerkleRoot")
		}
	}

	if merkleRoot == "" {
		return nil, errorsmod.Wrapf(ErrInvalidCardanoTransactionsProofs, "NoCertifiedTransaction")
	}

	var certifiedTransactionHashes []entities.TransactionHash
	for _, c := range pm.CertifiedTransactions {
		certifiedTransactionHashes = append(certifiedTransactionHashes, c.TransactionsHashes...)
	}

	return &VerifiedCardanoTransactions{
		CertificateHash:           pm.CertificateHash,
		MerkleRoot:                merkleRoot,
		CertifiedTransactions:     certifiedTransactionHashes,
		LatestImmutableFileNumber: pm.LatestImmutableFileNumber,
	}, nil
}
