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

import (
	"fmt"

	"github.com/misko9/go-substrate-rpc-client/v4/scale"
)

// VersionedFinalityProof is a wrapper around the CompactSignedCommitment to indicate versioning
type VersionedFinalityProof struct {
	IsCompactSignedCommitment bool // 1
	AsCompactSignedCommitment CompactSignedCommitment
}

func (v *VersionedFinalityProof) Decode(decoder scale.Decoder) error {
	b, err := decoder.ReadOneByte()

	if err != nil {
		return err
	}

	switch b {
	case 1:
		v.IsCompactSignedCommitment = true
		err = decoder.Decode(&v.AsCompactSignedCommitment)
	default:
		return fmt.Errorf("unrecognized variant")
	}

	if err != nil {
		return err
	}

	return nil
}

func (v *VersionedFinalityProof) Encode(encoder scale.Encoder) error {
	if v.IsCompactSignedCommitment {
		err := encoder.PushByte(1)
		if err != nil {
			return err
		}

		err = encoder.Encode(v.AsCompactSignedCommitment)
		if err != nil {
			return err
		}
	}

	return nil
}
