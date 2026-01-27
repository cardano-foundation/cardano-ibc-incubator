package mithril

import (
	"sidechain/x/clients/mithril/common/entities"

	errorsmod "cosmossdk.io/errors"
)

type CardanoTransactionsProofsMessage struct {
	CertificateHash          string                                    `json:"certificate_hash"`
	CertifiedTransactions    []*CardanoTransactionsSetProofMessagePart `json:"certified_transactions"`
	NonCertifiedTransactions []entities.TransactionHash                `json:"non_certified_transactions"`
	LatestBlockNumber        entities.BlockNumber                      `json:"latest_block_number"`
}

type CardanoTransactionsSetProofMessagePart struct {
	TransactionsHashes []entities.TransactionHash `json:"transactions_hashes"`
	Proof              entities.HexEncodedKey     `json:"proof"`
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
	CertificateHash       string
	MerkleRoot            string
	CertifiedTransactions []entities.TransactionHash
	LatestBlockNumber     entities.BlockNumber
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
		CertificateHash:       pm.CertificateHash,
		MerkleRoot:            merkleRoot,
		CertifiedTransactions: certifiedTransactionHashes,
		LatestBlockNumber:     pm.LatestBlockNumber,
	}, nil
}
