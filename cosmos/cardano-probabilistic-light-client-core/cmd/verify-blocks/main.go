// verify-blocks checks raw Cardano blocks against caller-supplied epoch evidence.
// It emits metadata from the authenticated headers only if every block passes.
package main

import (
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"os"

	core "github.com/cardano-foundation/cardano-ibc-incubator/cosmos/cardano-probabilistic-light-client-core"
)

type blockEvidence struct {
	BlockCBOR        string `json:"block_cbor"`
	EpochNonce       string `json:"epoch_nonce"`
	StakeNumerator   uint64 `json:"stake_numerator"`
	StakeDenominator uint64 `json:"stake_denominator"`
}

type request struct {
	SlotsPerKESPeriod     uint64          `json:"slots_per_kes_period"`
	MaxKESEvolutions      uint64          `json:"max_kes_evolutions"`
	ActiveSlotNumerator   uint64          `json:"active_slot_numerator"`
	ActiveSlotDenominator uint64          `json:"active_slot_denominator"`
	Blocks                []blockEvidence `json:"blocks"`
}

type blockMetadata struct {
	BlockHash   string `json:"block_hash"`
	BlockNumber uint64 `json:"block_number"`
	Slot        uint64 `json:"slot"`
	PoolIDHex   string `json:"pool_id_hex"`
}

type response struct {
	VerifiedBlocks int             `json:"verified_blocks"`
	Blocks         []blockMetadata `json:"blocks"`
}

func run(input io.Reader, output io.Writer) error {
	var req request
	decoder := json.NewDecoder(input)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&req); err != nil {
		return fmt.Errorf("decode request: %w", err)
	}
	if err := decoder.Decode(new(any)); err != io.EOF {
		return fmt.Errorf("expected exactly one JSON request")
	}
	if len(req.Blocks) == 0 {
		return fmt.Errorf("at least one block is required")
	}
	metadata := make([]blockMetadata, 0, len(req.Blocks))
	for i, evidence := range req.Blocks {
		blockCBOR, err := hex.DecodeString(evidence.BlockCBOR)
		if err != nil {
			return fmt.Errorf("block %d: invalid CBOR hex: %w", i, err)
		}
		nonce, err := hex.DecodeString(evidence.EpochNonce)
		if err != nil || len(nonce) != 32 {
			return fmt.Errorf("block %d: epoch nonce must be 32 bytes of hex", i)
		}
		block, err := core.DecodeLedgerBlock(blockCBOR)
		if err != nil {
			return fmt.Errorf("block %d: decode block: %w", i, err)
		}
		valid, _, err := core.VerifyNativeBlock(block, nonce, req.SlotsPerKESPeriod, req.MaxKESEvolutions,
			core.PraosLeaderEligibilityParameters{
				StakeNumerator:        evidence.StakeNumerator,
				StakeDenominator:      evidence.StakeDenominator,
				ActiveSlotNumerator:   req.ActiveSlotNumerator,
				ActiveSlotDenominator: req.ActiveSlotDenominator,
			})
		if err != nil {
			return fmt.Errorf("block %d (height %d): %w", i, block.BlockNumber(), err)
		}
		if !valid {
			return fmt.Errorf("block %d (height %d): verification failed", i, block.BlockNumber())
		}
		metadata = append(metadata, blockMetadata{
			BlockHash:   block.Hash(),
			BlockNumber: block.BlockNumber(),
			Slot:        block.SlotNumber(),
			PoolIDHex:   block.IssuerVkey().Hash().String(),
		})
	}
	return json.NewEncoder(output).Encode(response{VerifiedBlocks: len(metadata), Blocks: metadata})
}

func main() {
	if err := run(os.Stdin, os.Stdout); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
