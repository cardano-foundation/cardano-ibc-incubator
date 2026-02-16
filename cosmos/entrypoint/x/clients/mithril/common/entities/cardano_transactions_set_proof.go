package entities

import (
	"encoding/hex"
	"entrypoint/x/clients/mithril/common/cryptohelpers"
)

type CardanoTransactionsSetProof struct {
	TransactionsHashes []TransactionHash
	TransactionsProof  *ProtocolMkProof
}

func (proof *CardanoTransactionsSetProof) MerkleRoot() string {
	return hex.EncodeToString(proof.TransactionsProof.Key.ComputeRoot().Hash)
}

func (proof *CardanoTransactionsSetProof) Verify() error {
	// Verify the transactions proof
	if err := proof.TransactionsProof.Key.Verify(); err != nil {
		return err
	}

	// Verify each transaction hash
	for _, hash := range proof.TransactionsHashes {
		if err := proof.TransactionsProof.Key.Contains(&cryptohelpers.MKTreeNode{Hash: []byte(hash)}); err != nil {
			return err
		}
	}

	return nil
}
