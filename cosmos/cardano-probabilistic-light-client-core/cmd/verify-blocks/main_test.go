package main

import (
	"bytes"
	"encoding/json"
	"os"
	"strings"
	"testing"
)

func realBlockRequest(t *testing.T) request {
	t.Helper()
	block, err := os.ReadFile("../../testdata/babbage_block.hex")
	if err != nil {
		t.Fatal(err)
	}
	return request{
		SlotsPerKESPeriod:     129600,
		MaxKESEvolutions:      62,
		ActiveSlotNumerator:   1,
		ActiveSlotDenominator: 20,
		Blocks: []blockEvidence{{
			BlockCBOR:        strings.Join(strings.Fields(string(block)), ""),
			EpochNonce:       "53606952e39eadd5eea559be517f9741c9538073e987ec1b7a6c7a05db6195d3",
			StakeNumerator:   4_178_103_721_131,
			StakeDenominator: 5_019_556_879_197_493,
		}},
	}
}

func TestRunAuthenticatesEveryBlock(t *testing.T) {
	for _, test := range []struct {
		name   string
		mutate func(*request)
		valid  bool
	}{
		{name: "real block", valid: true},
		{name: "unstripped transport envelope", mutate: func(req *request) {
			req.Blocks[0].BlockCBOR = "8206" + req.Blocks[0].BlockCBOR
		}},
		{name: "wrong nonce", mutate: func(req *request) {
			req.Blocks[0].EpochNonce = strings.Repeat("00", 32)
		}},
		{name: "insufficient issuer stake", mutate: func(req *request) {
			req.Blocks[0].StakeNumerator = 1
		}},
		{name: "invalid second block", mutate: func(req *request) {
			req.Blocks = append(req.Blocks, req.Blocks[0])
			req.Blocks[1].EpochNonce = strings.Repeat("00", 32)
		}},
		{name: "empty batch", mutate: func(req *request) { req.Blocks = nil }},
	} {
		t.Run(test.name, func(t *testing.T) {
			req := realBlockRequest(t)
			if test.mutate != nil {
				test.mutate(&req)
			}
			input, err := json.Marshal(req)
			if err != nil {
				t.Fatal(err)
			}
			var output bytes.Buffer
			err = run(bytes.NewReader(input), &output)
			if test.valid {
				if err != nil {
					t.Fatal(err)
				}
				var result response
				if err := json.Unmarshal(output.Bytes(), &result); err != nil {
					t.Fatal(err)
				}
				want := blockMetadata{
					BlockHash:   "db19fcfaba30607e363113b0a13616e6a9da5aa48b86ec2c033786f0a2e13f7d",
					BlockNumber: 7_981_223,
					Slot:        76_204_984,
					PoolIDHex:   "cf69a3eca039d537acd46d5864a54dd8953f0c14be957350905834aa",
					VRFKeyHash:  "a7af95217a8eb597af07c1bd5d622cbc765fe5d3ef8235382b84e9bcf8e3a3eb",
				}
				if result.VerifiedBlocks != 1 || len(result.Blocks) != 1 || result.Blocks[0] != want {
					t.Fatalf("unexpected authenticated metadata: %+v", result)
				}
			} else {
				if err == nil {
					t.Fatal("invalid evidence must fail")
				}
				if output.Len() != 0 {
					t.Fatalf("failed batch emitted success output: %s", output.String())
				}
			}
		})
	}
}
