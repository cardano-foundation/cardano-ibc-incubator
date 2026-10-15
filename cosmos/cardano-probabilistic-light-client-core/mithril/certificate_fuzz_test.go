package mithril

import (
	"strings"
	"testing"
)

// Certificate verification never panics on relayer input. VerifyCertificate
// recovers panics, so a recovered one is reported as a failure here.
func FuzzVerifyCertificate(f *testing.F) {
	t := &testing.T{}
	epoch660 := loadCertificate(t, "660")
	epoch661 := loadCertificate(t, "661")
	if t.Failed() {
		f.Fatal("mainnet certificates are unavailable")
	}
	anchor, _, err := VerifyCertificate(mainnetAnchor(t, epoch660), epoch660.raw)
	if err != nil {
		f.Fatal(err)
	}
	f.Add(epoch661.raw)
	f.Add([]byte(`{"protocol_message":{"message_parts":{"current_epoch":"661"}}}`))
	f.Fuzz(func(t *testing.T, data []byte) {
		_, _, err := VerifyCertificate(anchor, data)
		if err != nil && strings.Contains(err.Error(), "verifier panicked") {
			t.Fatal(err)
		}
	})
}
