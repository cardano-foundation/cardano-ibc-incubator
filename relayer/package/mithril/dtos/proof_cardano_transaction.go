package dtos

type ProofTransaction struct {
	CertificateHash       string `json:"certificate_hash"`
	CertifiedTransactions []struct {
		TransactionsHashes []string `json:"transactions_hashes"`
		Proof              string   `json:"proof"`
	} `json:"certified_transactions"`
	NonCertifiedTransactions  []string `json:"non_certified_transactions"`
	LatestImmutableFileNumber int      `json:"latest_immutable_file_number"`
}
