// Generate signed Tendermint headers with the pinned CometBFT implementation.
// Run with -mod=readonly from the existing core module. No module is changed.
package main

import (
	"bytes"
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"time"

	"github.com/cometbft/cometbft/crypto/ed25519"
	tmmath "github.com/cometbft/cometbft/libs/math"
	tmproto "github.com/cometbft/cometbft/proto/tendermint/types"
	tmversion "github.com/cometbft/cometbft/proto/tendermint/version"
	"github.com/cometbft/cometbft/types"
	"github.com/cosmos/gogoproto/jsonpb"
	"github.com/cosmos/gogoproto/proto"
)

func mustJSON(message proto.Message) json.RawMessage {
	value, err := (&jsonpb.Marshaler{OrigName: true}).MarshalToString(message)
	if err != nil {
		panic(err)
	}
	return json.RawMessage(value)
}

func main() {
	base := flag.Int64("time-ns", 0, "fixture clock in nanoseconds")
	verify := flag.Bool("verify", false, "verify a recovered event header on stdin")
	flag.Parse()
	if *verify {
		var input struct {
			SignedHeader      json.RawMessage `json:"signed_header"`
			ValidatorSet      json.RawMessage `json:"validator_set"`
			TrustedValidators json.RawMessage `json:"trusted_validators"`
		}
		if err := json.NewDecoder(os.Stdin).Decode(&input); err != nil {
			panic(err)
		}
		var signed tmproto.SignedHeader
		var target, trusted tmproto.ValidatorSet
		for _, entry := range []struct {
			data    json.RawMessage
			message proto.Message
		}{{input.SignedHeader, &signed}, {input.ValidatorSet, &target}, {input.TrustedValidators, &trusted}} {
			if err := jsonpb.Unmarshal(bytes.NewReader(entry.data), entry.message); err != nil {
				panic(err)
			}
		}
		header, err := types.SignedHeaderFromProto(&signed)
		if err != nil {
			panic(err)
		}
		set, err := types.ValidatorSetFromProto(&target)
		if err != nil {
			panic(err)
		}
		old, err := types.ValidatorSetFromProto(&trusted)
		if err != nil {
			panic(err)
		}
		if err := header.ValidateBasic(header.ChainID); err != nil {
			panic(err)
		}
		if !bytes.Equal(header.Hash(), header.Commit.BlockID.Hash) || !bytes.Equal(set.Hash(), header.ValidatorsHash) {
			panic("recovered header or validator hash differs")
		}
		if err := set.VerifyCommitLight(header.ChainID, header.Commit.BlockID, header.Height, header.Commit); err != nil {
			panic(err)
		}
		if err := old.VerifyCommitLightTrusting(header.ChainID, header.Commit, tmmath.Fraction{Numerator: 1, Denominator: 3}); err != nil {
			panic(err)
		}
		fmt.Println("verified")
		return
	}
	if *base <= 0 {
		panic("a fixture clock is required")
	}
	output := make([]any, 0, 3)
	for _, count := range []int{1, 45, 65, 100, 256} {
		keys := make(map[string]ed25519.PrivKey)
		validators := make([]*types.Validator, count)
		for i := range validators {
			key := ed25519.GenPrivKeyFromSecret([]byte(fmt.Sprintf("public-cache-fixture/%d/%d", count, i)))
			keys[hex.EncodeToString(key.PubKey().Bytes())] = key
			power := int64(1000)
			if count == 45 {
				power = 1_000_000 / int64(i+1)
			}
			if count == 256 {
				power = 22
				if i < 44 {
					power = 212
				}
			}
			validators[i] = types.NewValidator(key.PubKey(), power)
		}
		old := types.NewValidatorSet(validators)
		next := old.Copy()
		if count == 45 {
			for _, index := range []int{0, 14, 26} {
				next.Validators[index].VotingPower++
			}
			next = types.NewValidatorSet(next.Validators)
		}
		oldProto, err := old.ToProto()
		if err != nil {
			panic(err)
		}
		headers := make([]any, 0, 3)
		for _, height := range []int64{10, 11, 13} {
			if count == 256 && height != 10 {
				continue
			}
			set := old
			if height == 13 {
				set = next
			}
			when := time.Unix(0, *base).Add(time.Duration(height-20) * time.Second).UTC()
			h := types.Header{
				Version: tmversion.Consensus{Block: 11}, ChainID: "cache-test-1", Height: height, Time: when,
				LastBlockID:    types.BlockID{Hash: make([]byte, 32), PartSetHeader: types.PartSetHeader{Total: 1, Hash: make([]byte, 32)}},
				LastCommitHash: make([]byte, 32), DataHash: make([]byte, 32), ValidatorsHash: set.Hash(),
				NextValidatorsHash: set.Hash(), ConsensusHash: make([]byte, 32), AppHash: make([]byte, 32),
				LastResultsHash: make([]byte, 32), EvidenceHash: make([]byte, 32), ProposerAddress: set.Proposer.Address,
			}
			id := types.BlockID{Hash: h.Hash(), PartSetHeader: types.PartSetHeader{Total: 1, Hash: make([]byte, 32)}}
			commit := &types.Commit{Height: height, BlockID: id, Signatures: make([]types.CommitSig, count)}
			for i, validator := range set.Validators {
				vote := &types.Vote{Type: tmproto.PrecommitType, Height: height, BlockID: id,
					Timestamp: when.Add(time.Millisecond), ValidatorAddress: validator.Address, ValidatorIndex: int32(i)}
				signature, err := keys[hex.EncodeToString(validator.PubKey.Bytes())].Sign(types.VoteSignBytes(h.ChainID, vote.ToProto()))
				if err != nil {
					panic(err)
				}
				commit.Signatures[i] = types.CommitSig{BlockIDFlag: types.BlockIDFlagCommit, ValidatorAddress: validator.Address, Timestamp: vote.Timestamp, Signature: signature}
			}
			setProto, err := set.ToProto()
			if err != nil {
				panic(err)
			}
			trustedHeight := int64(9)
			if height > 10 {
				trustedHeight = 10
			}
			if height == 13 {
				trustedHeight = 11
			}
			headers = append(headers, map[string]any{
				"signed_header": mustJSON((&types.SignedHeader{Header: &h, Commit: commit}).ToProto()),
				"validator_set": mustJSON(setProto), "trusted_validators": mustJSON(oldProto),
				"trusted_height": map[string]string{"revision_number": "1", "revision_height": fmt.Sprint(trustedHeight)},
			})
		}
		output = append(output, map[string]any{"count": count, "trusted_root": hex.EncodeToString(old.Hash()), "trusted_time": fmt.Sprint(*base - int64(120*time.Second)), "headers": headers})
	}
	if err := json.NewEncoder(os.Stdout).Encode(output); err != nil {
		panic(err)
	}
}
