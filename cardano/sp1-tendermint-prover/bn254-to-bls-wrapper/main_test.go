package main

import (
	"bytes"
	"encoding/hex"
	"encoding/json"
	"errors"
	"math/big"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/consensys/gnark-crypto/ecc"
	"github.com/consensys/gnark-crypto/ecc/bls12-381"
)

func TestCardanoCommitmentHasherAcceptsSplitWrites(t *testing.T) {
	_, _, generator, _ := bls12381.Generators()
	raw := generator.RawBytes()

	oneWrite := newCardanoCommitmentHasher()
	_, _ = oneWrite.Write(raw[:])
	want := oneWrite.Sum(nil)

	splitWrites := newCardanoCommitmentHasher()
	_, _ = splitWrites.Write(raw[:31])
	_, _ = splitWrites.Write(raw[31:])
	got := splitWrites.Sum(nil)
	if !bytes.Equal(got, want) {
		t.Fatalf("split transcript hash %x does not match one-write hash %x", got, want)
	}
	if new(big.Int).SetBytes(got).Cmp(ecc.BLS12_381.ScalarField()) >= 0 {
		t.Fatalf("masked digest is outside the BLS12-381 scalar field: %x", got)
	}
}

func TestCardanoCommitmentDigestMatchesAikenFixture(t *testing.T) {
	compressed, err := hex.DecodeString("a751fcd6a58236d2744926eeb8bca2d23713bd32201496aae9c501636cbeb39ca4612ee8a5c0c2a8007d849ecfec8585")
	if err != nil {
		t.Fatal(err)
	}
	var commitment bls12381.G1Affine
	read, err := commitment.SetBytes(compressed)
	if err != nil {
		t.Fatal(err)
	}
	if read != len(compressed) {
		t.Fatalf("decoded %d of %d commitment bytes", read, len(compressed))
	}
	digest, err := cardanoCommitmentDigest(commitment.Marshal())
	if err != nil {
		t.Fatal(err)
	}
	const want = "1589d10f2d7b601456fe122e5a84cecdd1a5ff7aee0f80ee55e3e7494106dc81"
	if hex.EncodeToString(digest[:]) != want {
		t.Fatalf("commitment digest %x does not match %s", digest, want)
	}
}

func TestServeWorkerReturnsOneResponsePerRequestAndContinuesAfterError(t *testing.T) {
	input := strings.NewReader(strings.Join([]string{
		`{"requestId":"first","fixturePath":"first.json"}`,
		`{"requestId":"rejected","fixturePath":"rejected.json"}`,
		`{"requestId":"last","fixture":{"updateClientVkey":"0x01","updateMsg":"0x02"}}`,
		"",
	}, "\n"))
	var output bytes.Buffer
	calls := 0
	err := serveWorker(input, &output, func(request workerRequest) (workerProofResult, error) {
		calls++
		if request.RequestID == "rejected" {
			return workerProofResult{}, errors.New("proof rejected")
		}
		return workerProofResult{
			proofBytes: []byte{0xaa, 0xbb},
			fixture: &fixtureData{
				publicValues:     []byte{0x01, 0x02},
				programVKeyLabel: "0x03",
			},
			elapsed: 1500 * time.Millisecond,
		}, nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if calls != 3 {
		t.Fatalf("handler called %d times, expected 3", calls)
	}

	decoder := json.NewDecoder(&output)
	var responses []workerResponse
	for decoder.More() {
		var response workerResponse
		if err := decoder.Decode(&response); err != nil {
			t.Fatal(err)
		}
		responses = append(responses, response)
	}
	if len(responses) != 3 {
		t.Fatalf("got %d responses, expected 3: %s", len(responses), output.String())
	}
	if responses[0].RequestID != "first" || !responses[0].OK {
		t.Fatalf("unexpected first response: %+v", responses[0])
	}
	if responses[0].WrappedProof != "0xaabb" || responses[0].PublicValues != "0x0102" {
		t.Fatalf("unexpected first proof result: %+v", responses[0])
	}
	if responses[0].ProgramVKey != "0x03" || responses[0].ElapsedSeconds != 1.5 {
		t.Fatalf("unexpected first proof metadata: %+v", responses[0])
	}
	if responses[1].RequestID != "rejected" || responses[1].OK || responses[1].Error != "proof rejected" {
		t.Fatalf("unexpected rejected response: %+v", responses[1])
	}
	if responses[2].RequestID != "last" || !responses[2].OK {
		t.Fatalf("worker did not continue after request error: %+v", responses[2])
	}
}

func TestWorkerReadyProtocolIsStable(t *testing.T) {
	ready := workerReady{
		Ready:                 true,
		Protocol:              workerProtocol,
		VerificationKeySHA256: strings.Repeat("a", 64),
	}
	raw, err := json.Marshal(ready)
	if err != nil {
		t.Fatal(err)
	}
	if string(raw) != `{"ready":true,"protocol":"cardano-ibc-bn254-to-bls-wrapper/v1","verificationKeySha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}` {
		t.Fatalf("unexpected readiness message: %s", raw)
	}
}

func TestServeWorkerRejectsMalformedAndUnknownFields(t *testing.T) {
	input := strings.NewReader(strings.Join([]string{
		`{"requestId":"unknown","fixturePath":"fixture.json","extra":true}`,
		`not-json`,
		"",
	}, "\n"))
	var output bytes.Buffer
	err := serveWorker(input, &output, func(workerRequest) (workerProofResult, error) {
		t.Fatal("handler must not run for invalid requests")
		return workerProofResult{}, nil
	})
	if err != nil {
		t.Fatal(err)
	}

	lines := strings.Split(strings.TrimSpace(output.String()), "\n")
	if len(lines) != 2 {
		t.Fatalf("got %d responses, expected 2: %s", len(lines), output.String())
	}
	var unknown workerResponse
	if err := json.Unmarshal([]byte(lines[0]), &unknown); err != nil {
		t.Fatal(err)
	}
	if unknown.RequestID != "unknown" || unknown.OK || !strings.Contains(unknown.Error, "unknown field") {
		t.Fatalf("unexpected unknown-field response: %+v", unknown)
	}
	var malformed workerResponse
	if err := json.Unmarshal([]byte(lines[1]), &malformed); err != nil {
		t.Fatal(err)
	}
	if malformed.OK || !strings.Contains(malformed.Error, "decode worker request") {
		t.Fatalf("unexpected malformed response: %+v", malformed)
	}
}

func TestValidateOuterKeyMetadataDetectsChangedArtifact(t *testing.T) {
	keyDir := t.TempDir()
	paths := map[string]string{
		"outer.r1cs": filepath.Join(keyDir, "outer.r1cs"),
		"outer.pk":   filepath.Join(keyDir, "outer.pk"),
		"outer.vk":   filepath.Join(keyDir, "outer.vk"),
	}
	for name, path := range paths {
		if err := os.WriteFile(path, []byte(name), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	if err := writeOuterKeyMetadata(filepath.Join(keyDir, "manifest.json"), 123, paths); err != nil {
		t.Fatal(err)
	}
	var log bytes.Buffer
	if err := validateAndReportOuterKeyMetadata(&log, "load", keyDir, 123, paths); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(log.String(), "outer_key_manifest_validated: true") {
		t.Fatalf("missing validation log: %s", log.String())
	}
	if err := os.WriteFile(paths["outer.pk"], []byte("changed"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := validateAndReportOuterKeyMetadata(&log, "load", keyDir, 123, paths); err == nil || !strings.Contains(err.Error(), "manifest expects") {
		t.Fatalf("expected changed artifact error, got %v", err)
	}
}
