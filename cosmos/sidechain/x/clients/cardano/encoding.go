package cardano

import (
	"encoding/json"
	"fmt"
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

// MustMarshalSPOState encode RegisCert data before store
func MustMarshalSPOState(certs []SPOState) []byte {
	bz, err := MarshalInterface(certs)
	if err != nil {
		panic(fmt.Errorf("failed to encode SPO state: %w", err))
	}

	return bz
}

// MustUnmarshalSPOState decode RegisCert data before process
func MustUnmarshalSPOState(bytesVal []byte) []SPOState {
	result := make([]SPOState, 0)
	if len(bytesVal) == 0 {
		return result
	}
	err := UnmarshalInterface(bytesVal, &result)
	if err != nil {
		panic(fmt.Errorf("failed to decode SPO state: %w", err))
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

// MustMarshalUTXO encode client UTXO data
func MustMarshalUTXO(UTXO UTXOOutput) []byte {
	bz, err := MarshalInterface(UTXO)
	if err != nil {
		panic(fmt.Errorf("failed to encode client UTXO: %w", err))
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
