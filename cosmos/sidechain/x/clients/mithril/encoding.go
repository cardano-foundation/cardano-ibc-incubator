package mithril

import (
	"encoding/json"
	"fmt"
)

// MustMarshalMithrilCertificate encode the Mithril Certificate data before store
func MustMarshalMithrilCertificate(certificate MithrilCertificate) []byte {
	bz, err := MarshalInterface(certificate)
	if err != nil {
		panic(fmt.Errorf("failed to encode mithril certificate: %w", err))
	}

	return bz
}

// MustUnmarshalMithrilCertificate decode the Mithril Certificate data
func MustUnmarshalMithrilCertificate(bytesCertificate []byte) MithrilCertificate {
	result := MithrilCertificate{}
	err := UnmarshalInterface(bytesCertificate, &result)
	if err != nil {
		panic(fmt.Errorf("failed to decode mithril certificate: %w", err))
	}

	return result
}

// MarshalInterface encode interface{} data to bytes
func MarshalInterface(i interface{}) ([]byte, error) {
	return json.Marshal(i)
}

// UnmarshalInterface decode bytes to interface{}
func UnmarshalInterface(v []byte, result interface{}) error {
	return json.Unmarshal(v, result)
}
