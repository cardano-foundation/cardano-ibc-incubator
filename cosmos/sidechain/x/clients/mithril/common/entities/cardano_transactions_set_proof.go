package entities

type CardanoTransactionsSetProof struct {
	TransactionsHashes []TransactionHash
	TransactionsProof  *ProtocolMkProof
}
