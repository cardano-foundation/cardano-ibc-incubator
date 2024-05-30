package mithril

import (
	"fmt"
)

// MustMarshalMithrilCertificate encode the Mithril Certificate data before store
func MustMarshalMithrilCertificate(certificate MithrilCertificate) []byte {
	bz, err := certificate.Marshal()
	if err != nil {
		panic(fmt.Errorf("failed to encode mithril certificate: %w", err))
	}

	return bz
}

// MustUnmarshalMithrilCertificate decode the Mithril Certificate data
func MustUnmarshalMithrilCertificate(bytesCertificate []byte) MithrilCertificate {
	result := MithrilCertificate{}
	err := result.Unmarshal(bytesCertificate)
	if err != nil {
		panic(fmt.Errorf("failed to decode mithril certificate: %w, invalid bytes: %x", err, bytesCertificate))
	}

	return result
}
