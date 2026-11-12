package probabilisticcore

import "github.com/blinklabs-io/gouroboros/ledger"

// fixtureHeader supplies wire-valid lengths, not valid signatures. Tests that
// authenticate a block must replace these placeholders with signed values.
func fixtureHeader() *ledger.BabbageBlockHeader {
	h := &ledger.BabbageBlockHeader{}
	h.Signature = make([]byte, 448)
	h.Body.VrfKey = make([]byte, 32)
	h.Body.VrfResult.Output = make([]byte, 64)
	h.Body.VrfResult.Proof = make([]byte, 80)
	h.Body.OpCert.HotVkey = make([]byte, 32)
	h.Body.OpCert.Signature = make([]byte, 64)
	return h
}
