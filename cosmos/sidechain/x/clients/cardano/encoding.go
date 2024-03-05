package cardano

import (
	"encoding/json"
	"fmt"
	"reflect"
)

// MustMarshalClientSPOs encode client SPOs data before store
func MustMarshalClientSPOs(validatorSet []*Validator) []byte {
	bz, err := MarshalInterface(validatorSet)
	if err != nil {
		panic(fmt.Errorf("failed to encode client SPOs: %w", err))
	}

	return bz
}

// MustUnmarshalClientSPOs encode client SPOs data before store
func MustUnmarshalClientSPOs(bytesVal []byte) []*Validator {
	result := make([]*Validator, 0)
	err := UnmarshalInterface(bytesVal, &result)
	if err != nil {
		panic(fmt.Errorf("failed to decode client SPOs: %w", err))
	}

	return result
}

// MustMarshalRegisterCert encode RegisCert data before store
func MustMarshalRegisterCert(registerCert []RegisCert) []byte {
	bz, err := MarshalInterface(registerCert)
	if err != nil {
		panic(fmt.Errorf("failed to encode client SPOs: %w", err))
	}

	return bz
}

// MustUnmarshalRegisterCert decode RegisCert data before process
func MustUnmarshalRegisterCert(bytesVal []byte) []RegisCert {
	result := make([]RegisCert, 0)
	err := UnmarshalInterface(bytesVal, &result)
	if err != nil {
		panic(fmt.Errorf("failed to encode client SPOs: %w", err))
	}

	return result
}

// MustUnmarshalUnregisterCert decode DeRegisCert data before process
func MustUnmarshalUnregisterCert(bytesVal []byte) []DeRegisCert {
	result := make([]DeRegisCert, 0)
	err := UnmarshalInterface(bytesVal, &result)
	if err != nil {
		panic(fmt.Errorf("failed to encode client SPOs: %w", err))
	}

	return result
}

// MustMarshalUnregisterCert encode DeRegisCert data before store
func MustMarshalUnregisterCert(unregisterCert []DeRegisCert) []byte {
	bz, err := MarshalInterface(unregisterCert)
	if err != nil {
		panic(fmt.Errorf("failed to encode client SPOs: %w", err))
	}

	return bz
}

// MarshalInterface encode interface{} data to bytes
func MarshalInterface(i interface{}) ([]byte, error) {
	return json.Marshal(i)
}

// UnmarshalInterface decode bytes to interface{}
func UnmarshalInterface(v []byte, result interface{}) error {
	return json.Unmarshal(v, result)
}

// RemoveDuplicateRegisterCert remove duplicate element
func RemoveDuplicateRegisterCert(registerCert []RegisCert) []RegisCert {
	result := make([]RegisCert, 0)
	if len(registerCert) > 0 {
		for _, cert := range registerCert {
			if !InSliceRegisCert(result, cert) {
				result = append(result, cert)
			}
		}
	}
	return result
}

// InSliceRegisCert check a value is exist or not
func InSliceRegisCert(s []RegisCert, e RegisCert) bool {
	if len(s) > 0 {
		for _, v := range s {
			if reflect.DeepEqual(v, e) {
				return true
			}
		}
	}
	return false
}

// RemoveDuplicateUnregisterCert remove duplicate element
func RemoveDuplicateUnregisterCert(registerCert []DeRegisCert) []DeRegisCert {
	result := make([]DeRegisCert, 0)
	if len(registerCert) > 0 {
		for _, cert := range registerCert {
			if !InSliceDeRegisCert(result, cert) {
				result = append(result, cert)
			}
		}
	}
	return result
}

// InSliceDeRegisCert check a value is exist or not
func InSliceDeRegisCert(s []DeRegisCert, e DeRegisCert) bool {
	if len(s) > 0 {
		for _, v := range s {
			if reflect.DeepEqual(v, e) {
				return true
			}
		}
	}
	return false
}

// MustMarshalUTXOs encode client UTXOs data
func MustMarshalUTXOs(UTXOs []UTXOOutput) []byte {
	bz, err := MarshalInterface(UTXOs)
	if err != nil {
		panic(fmt.Errorf("failed to encode client UTXOs: %w", err))
	}

	return bz
}

// MustUnmarshalUTXO decode client UTXOs data
func MustUnmarshalUTXO(bytesVal []byte) UTXOOutput {
	result := UTXOOutput{}
	err := UnmarshalInterface(bytesVal, &result)
	if err != nil {
		panic(fmt.Errorf("failed to decode client UTXOs: %w", err))
	}

	return result
}
