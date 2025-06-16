// Go Substrate RPC Client (GSRPC) provides APIs and types around Polkadot and any Substrate-based chain RPC calls
//
// Copyright 2019 Centrifuge GmbH
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

package types

import "github.com/misko9/go-substrate-rpc-client/v4/scale"

type OptionExecutionResult struct {
	option
	value ExecutionResult
}

func NewOptionExecutionResult(value ExecutionResult) OptionExecutionResult {
	return OptionExecutionResult{option{HasValue: true}, value}
}

func NewOptionExecutionResultEmpty() OptionExecutionResult {
	return OptionExecutionResult{option: option{HasValue: false}}
}

func (o *OptionExecutionResult) Decode(decoder scale.Decoder) error {
	return decoder.DecodeOption(&o.HasValue, &o.value)
}

func (o OptionExecutionResult) Encode(encoder scale.Encoder) error {
	return encoder.EncodeOption(o.HasValue, o.value)
}

// SetSome sets a value
func (o *OptionExecutionResult) SetSome(value ExecutionResult) {
	o.HasValue = true
	o.value = value
}

// SetNone removes a value and marks it as missing
func (o *OptionExecutionResult) SetNone() {
	o.HasValue = false
	o.value = ExecutionResult{}
}

// Unwrap returns a flag that indicates whether a value is present and the stored value
func (o *OptionExecutionResult) Unwrap() (ok bool, value ExecutionResult) {
	return o.HasValue, o.value
}

type ExecutionResult struct {
	Outcome U32
	Error   XCMError
}

func (e *ExecutionResult) Decode(decoder scale.Decoder) error {
	if err := decoder.Decode(&e.Outcome); err != nil {
		return err
	}

	return decoder.Decode(&e.Error)
}

func (e ExecutionResult) Encode(encoder scale.Encoder) error {
	if err := encoder.Encode(e.Outcome); err != nil {
		return err
	}

	return encoder.Encode(e.Error)
}
