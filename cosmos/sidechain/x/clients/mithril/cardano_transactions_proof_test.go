package mithril

import "testing"

func TestCardanoTransactionsProofsMessageVerify(t *testing.T) {
	ctpm := &CardanoTransactionsProofsMessage{
		CertificateHash:           "",
		CertifiedTransactions:     nil,
		NonCertifiedTransactions:  nil,
		LatestImmutableFileNumber: 0,
	}
	_ = ctpm
}
