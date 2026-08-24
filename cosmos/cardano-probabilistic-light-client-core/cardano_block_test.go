package probabilisticcore

import (
	"bytes"
	"crypto/ed25519"
	"encoding/hex"
	"os"
	"strconv"
	"strings"
	"testing"

	"github.com/blinklabs-io/gouroboros/cbor"
	"github.com/blinklabs-io/gouroboros/ledger"
	"golang.org/x/crypto/blake2b"
)

func TestOperationalCertificateSignableBytesUsesCardanoLayout(t *testing.T) {
	hotVkey := make([]byte, ed25519.PublicKeySize)
	for idx := range hotVkey {
		hotVkey[idx] = byte(idx)
	}

	got := operationalCertificateSignableBytes(hotVkey, 0x01020304, 0x05060708)
	want := "000102030405060708090a0b0c0d0e0f" +
		"101112131415161718191a1b1c1d1e1f" +
		"0000000001020304" +
		"0000000005060708"
	if gotHex := hex.EncodeToString(got); gotHex != want {
		t.Fatalf("operational certificate signable mismatch: got %s want %s", gotHex, want)
	}
}

func TestVerifyOperationalCertificateAcceptsCardanoCliKnownAnswer(t *testing.T) {
	hotVkey, err := hex.DecodeString("4cd49bb05e9885142fe7af1481107995298771fd1a24e72b506a4d600ee2b312")
	if err != nil {
		t.Fatalf("decode hot KES key: %v", err)
	}
	coldVkey, err := hex.DecodeString("5a3d778e76741a009e29d23093cfe046131808d34d7c864967b515e98dfc3583")
	if err != nil {
		t.Fatalf("decode cold verification key: %v", err)
	}
	signature, err := hex.DecodeString("89fc9e9f551b2ea873bf31643659d049152d5c8e8de86be4056370bccc5fa62dd12e3f152f1664e614763e46eaa7a17ed366b5cef19958773d1ab96941442e0b")
	if err != nil {
		t.Fatalf("decode operational certificate signature: %v", err)
	}

	header := &ledger.BabbageBlockHeader{}
	copy(header.Body.IssuerVkey[:], coldVkey)
	header.Body.OpCert.HotVkey = hotVkey
	header.Body.OpCert.SequenceNumber = 0
	header.Body.OpCert.KesPeriod = 0
	header.Body.OpCert.Signature = signature

	sequenceNumber, err := verifyOperationalCertificate(header, 129600, 62)
	if err != nil {
		t.Fatalf("verify known-answer operational certificate: %v", err)
	}
	if sequenceNumber != 0 {
		t.Fatalf("sequence number mismatch: got %d want 0", sequenceNumber)
	}
}

func TestVerifyOperationalCertificateAcceptsValidKesWindowBoundaries(t *testing.T) {
	const (
		slotsPerKesPeriod = uint64(100)
		startKesPeriod    = uint32(10)
		maxKesEvolutions  = uint64(4)
		sequenceNumber    = uint32(7)
	)

	for _, currentKesPeriod := range []uint64{
		uint64(startKesPeriod),
		uint64(startKesPeriod) + maxKesEvolutions - 1,
	} {
		t.Run("period_"+strconv.FormatUint(currentKesPeriod, 10), func(t *testing.T) {
			header, _ := signedOperationalCertificateHeader(
				t,
				sequenceNumber,
				startKesPeriod,
				currentKesPeriod*slotsPerKesPeriod,
			)

			got, err := verifyOperationalCertificate(header, slotsPerKesPeriod, maxKesEvolutions)
			if err != nil {
				t.Fatalf("verifyOperationalCertificate: %v", err)
			}
			if got != uint64(sequenceNumber) {
				t.Fatalf("sequence number mismatch: got %d want %d", got, sequenceNumber)
			}
		})
	}
}

func TestVerifyOperationalCertificateRejectsOutsideKesWindow(t *testing.T) {
	const (
		slotsPerKesPeriod = uint64(100)
		startKesPeriod    = uint32(10)
		maxKesEvolutions  = uint64(4)
	)

	testCases := []struct {
		name             string
		currentKesPeriod uint64
		want             string
	}{
		{
			name:             "before start",
			currentKesPeriod: uint64(startKesPeriod) - 1,
			want:             "after current KES period",
		},
		{
			name:             "at expiry",
			currentKesPeriod: uint64(startKesPeriod) + maxKesEvolutions,
			want:             "operational certificate expired",
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			header, _ := signedOperationalCertificateHeader(
				t,
				7,
				startKesPeriod,
				tc.currentKesPeriod*slotsPerKesPeriod,
			)

			_, err := verifyOperationalCertificate(header, slotsPerKesPeriod, maxKesEvolutions)
			if err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Fatalf("expected error containing %q, got %v", tc.want, err)
			}
		})
	}
}

func TestVerifyOperationalCertificateRejectsCertificateFieldForgery(t *testing.T) {
	const slotsPerKesPeriod = uint64(100)

	testCases := []struct {
		name   string
		mutate func(*ledger.BabbageBlockHeader)
	}{
		{
			name: "signature",
			mutate: func(header *ledger.BabbageBlockHeader) {
				header.Body.OpCert.Signature[0] ^= 0xff
			},
		},
		{
			name: "hot key",
			mutate: func(header *ledger.BabbageBlockHeader) {
				header.Body.OpCert.HotVkey[0] ^= 0xff
			},
		},
		{
			name: "sequence number",
			mutate: func(header *ledger.BabbageBlockHeader) {
				header.Body.OpCert.SequenceNumber++
			},
		},
		{
			name: "start period",
			mutate: func(header *ledger.BabbageBlockHeader) {
				header.Body.OpCert.KesPeriod--
			},
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			header, _ := signedOperationalCertificateHeader(t, 7, 10, 10*slotsPerKesPeriod)
			tc.mutate(header)

			_, err := verifyOperationalCertificate(header, slotsPerKesPeriod, 4)
			if err == nil || !strings.Contains(err.Error(), "cold-key signature is invalid") {
				t.Fatalf("expected invalid cold-key signature error, got %v", err)
			}
		})
	}
}

func TestVerifyOperationalCertificateRejectsInvalidParametersAndShapes(t *testing.T) {
	header, _ := signedOperationalCertificateHeader(t, 7, 10, 1_000)

	testCases := []struct {
		name   string
		mutate func(*ledger.BabbageBlockHeader)
		slots  uint64
		max    uint64
		want   string
	}{
		{
			name:   "zero slots per period",
			mutate: func(*ledger.BabbageBlockHeader) {},
			slots:  0,
			max:    4,
			want:   "slots per KES period",
		},
		{
			name:   "zero max evolutions",
			mutate: func(*ledger.BabbageBlockHeader) {},
			slots:  100,
			max:    0,
			want:   "max KES evolutions",
		},
		{
			name:   "unsupported max evolutions",
			mutate: func(*ledger.BabbageBlockHeader) {},
			slots:  100,
			max:    maxSupportedKesEvolutions + 1,
			want:   "max KES evolutions",
		},
		{
			name: "wrong hot key length",
			mutate: func(header *ledger.BabbageBlockHeader) {
				header.Body.OpCert.HotVkey = header.Body.OpCert.HotVkey[:31]
			},
			slots: 100,
			max:   4,
			want:  "hot KES key must be 32 bytes",
		},
		{
			name: "wrong signature length",
			mutate: func(header *ledger.BabbageBlockHeader) {
				header.Body.OpCert.Signature = header.Body.OpCert.Signature[:63]
			},
			slots: 100,
			max:   4,
			want:  "signature must be 64 bytes",
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			cloned := cloneOperationalCertificateHeader(header)
			tc.mutate(cloned)

			_, err := verifyOperationalCertificate(cloned, tc.slots, tc.max)
			if err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Fatalf("expected error containing %q, got %v", tc.want, err)
			}
		})
	}
}

func TestVerifyNativeBlockAndHeaderCheckOperationalCertificateBeforeKes(t *testing.T) {
	header, _ := signedOperationalCertificateHeader(t, 7, 10, 1_000)
	header.Body.OpCert.Signature[0] ^= 0xff
	block := &ledger.BabbageBlock{Header: header}

	_, _, err := VerifyNativeHeader(header, make([]byte, 32), 100, 4)
	if err == nil || !strings.Contains(err.Error(), "cold-key signature is invalid") {
		t.Fatalf("expected invalid header operational certificate error, got %v", err)
	}

	_, _, err = VerifyNativeBlock(block, make([]byte, 32), 100, 4)
	if err == nil || !strings.Contains(err.Error(), "cold-key signature is invalid") {
		t.Fatalf("expected invalid operational certificate error, got %v", err)
	}
}

func TestVerifyNativeBlockReturnsErrorForMalformedKesSignature(t *testing.T) {
	header, _ := signedOperationalCertificateHeader(t, 7, 10, 1_000)
	header.Signature = []byte{0x01}
	block := &ledger.BabbageBlock{Header: header}

	valid, result, err := VerifyNativeBlock(block, make([]byte, 32), 100, 4)
	if err == nil || !strings.Contains(err.Error(), "native block verification panicked") {
		t.Fatalf("expected recovered malformed KES signature error, got %v", err)
	}
	if valid {
		t.Fatal("malformed KES signature must not verify")
	}
	if len(result.VrfKey) != 0 || result.OperationalCertificateSequenceNumber != 0 {
		t.Fatalf("malformed KES signature returned verification result: %+v", result)
	}
}

func TestVerifyNativeBlockAndHeaderAcceptRealMainnetBabbageAndConwayBlocks(t *testing.T) {
	// These Apache-2.0 fixtures are real mainnet blocks from gouroboros testdata
	// at commit 11659ae4676150c105d83ca249e3c9de2d5669b2.
	testCases := []struct {
		name               string
		fixture            string
		epochNonce         string
		wantHeight         uint64
		wantSequenceNumber uint64
	}{
		{
			name:               "Babbage",
			fixture:            "testdata/babbage_block.hex",
			epochNonce:         "53606952e39eadd5eea559be517f9741c9538073e987ec1b7a6c7a05db6195d3",
			wantHeight:         7_981_223,
			wantSequenceNumber: 8,
		},
		{
			name:               "Conway",
			fixture:            "testdata/conway_block.hex",
			epochNonce:         "2479be89e3ed9eeb4f4e4e11f6851f3dfc460e68b67ae5f663676dbeb30d9831",
			wantHeight:         12_069_665,
			wantSequenceNumber: 24,
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			fixtureHex, err := os.ReadFile(tc.fixture)
			if err != nil {
				t.Fatalf("read block fixture: %v", err)
			}
			blockCbor, err := hex.DecodeString(strings.Join(strings.Fields(string(fixtureHex)), ""))
			if err != nil {
				t.Fatalf("decode block fixture: %v", err)
			}
			epochNonce, err := hex.DecodeString(tc.epochNonce)
			if err != nil {
				t.Fatalf("decode epoch nonce: %v", err)
			}
			block, err := DecodeLedgerBlock(blockCbor)
			if err != nil {
				t.Fatalf("decode ledger block: %v", err)
			}

			valid, result, err := VerifyNativeBlock(block, epochNonce, 129600, 62)
			if err != nil {
				t.Fatalf("verify native block: %v", err)
			}
			if !valid {
				t.Fatal("expected real mainnet block to pass native verification")
			}
			if block.BlockNumber() != tc.wantHeight {
				t.Fatalf("block height mismatch: got %d want %d", block.BlockNumber(), tc.wantHeight)
			}
			if result.OperationalCertificateSequenceNumber != tc.wantSequenceNumber {
				t.Fatalf(
					"operational certificate sequence mismatch: got %d want %d",
					result.OperationalCertificateSequenceNumber,
					tc.wantSequenceNumber,
				)
			}

			header, err := nativeBabbageHeader(block)
			if err != nil {
				t.Fatalf("get native header: %v", err)
			}
			headerValid, headerResult, err := VerifyNativeHeader(header, epochNonce, 129600, 62)
			if err != nil {
				t.Fatalf("verify native header: %v", err)
			}
			if !headerValid {
				t.Fatal("expected real mainnet header to pass native verification")
			}
			if headerResult.OperationalCertificateSequenceNumber != tc.wantSequenceNumber {
				t.Fatalf(
					"header operational certificate sequence mismatch: got %d want %d",
					headerResult.OperationalCertificateSequenceNumber,
					tc.wantSequenceNumber,
				)
			}
			if !bytes.Equal(headerResult.VrfKey, result.VrfKey) {
				t.Fatal("full block and compact header returned different VRF keys")
			}
		})
	}
}

func TestDecodeLedgerHeaderRequiresExactInput(t *testing.T) {
	original := &ledger.BabbageBlockHeader{}
	original.Body.BlockNumber = 42
	original.Body.Slot = 84

	headerCbor, err := cbor.Encode(original)
	if err != nil {
		t.Fatalf("encode header: %v", err)
	}
	decoded, err := DecodeLedgerHeader(headerCbor)
	if err != nil {
		t.Fatalf("decode exact header: %v", err)
	}
	if decoded.BlockNumber() != original.BlockNumber() || decoded.SlotNumber() != original.SlotNumber() {
		t.Fatalf(
			"decoded header fields mismatch: got height=%d slot=%d want height=%d slot=%d",
			decoded.BlockNumber(),
			decoded.SlotNumber(),
			original.BlockNumber(),
			original.SlotNumber(),
		)
	}
	if !bytes.Equal(decoded.Cbor(), headerCbor) {
		t.Fatal("decoded header did not preserve the exact signed CBOR bytes")
	}

	withTrailingByte := append(bytes.Clone(headerCbor), 0x00)
	if _, err := DecodeLedgerHeader(withTrailingByte); err == nil {
		t.Fatal("expected trailing header bytes to be rejected")
	}

	if len(headerCbor) < 2 {
		t.Fatal("encoded test header is unexpectedly short")
	}
	if _, err := DecodeLedgerHeader(headerCbor[:len(headerCbor)-1]); err == nil {
		t.Fatal("expected truncated header CBOR to be rejected")
	}
}

func TestEncodeNativeVerifiedBlockBodyHexStripsTaggedMetadata(t *testing.T) {
	bodyCbor := []byte{0xa0}
	witnessCbor := []byte{0xa0}
	taggedMetadataCbor := []byte{0xd9, 0x01, 0x03, 0xa1, 0x00, 0x01}

	var metadata cbor.LazyValue
	if err := metadata.UnmarshalCBOR(taggedMetadataCbor); err != nil {
		t.Fatalf("metadata unmarshal: %v", err)
	}

	bodyHex, err := EncodeNativeVerifiedBlockBodyHex(
		1,
		func(int) []byte { return bodyCbor },
		func(int) []byte { return witnessCbor },
		map[uint]*cbor.LazyValue{0: &metadata},
	)
	if err != nil {
		t.Fatalf("EncodeNativeVerifiedBlockBodyHex: %v", err)
	}

	bodyBytes, err := hex.DecodeString(bodyHex)
	if err != nil {
		t.Fatalf("decode body hex: %v", err)
	}
	var txsRaw [][]string
	if _, err := cbor.Decode(bodyBytes, &txsRaw); err != nil {
		t.Fatalf("decode native body wrapper: %v", err)
	}
	if len(txsRaw) != 1 {
		t.Fatalf("expected 1 tx, got %d", len(txsRaw))
	}
	if got, want := txsRaw[0][2], "a10001"; got != want {
		t.Fatalf("metadata mismatch: got %s want %s", got, want)
	}
}

func TestVerifyRawBlockBodyUsesEncodedWitnessShape(t *testing.T) {
	fields := rawBlockBodyFields{
		transactionBodies:      []byte{0x81, 0xa0},
		transactionWitnessSets: []byte{0xa1, 0x00, 0xa0},
		transactionMetadataSet: []byte{0xa0},
		invalidTransactions:    []byte{0x80},
	}

	expectedHash := rawBodyHash(fields)
	isValid, err := verifyRawBlockBody(fields, hex.EncodeToString(expectedHash[:]))
	if err != nil {
		t.Fatalf("verifyRawBlockBody: %v", err)
	}
	if !isValid {
		t.Fatal("expected raw body fields to verify")
	}

	arrayWitnessFields := fields
	arrayWitnessFields.transactionWitnessSets = []byte{0x81, 0xa0}
	isValid, err = verifyRawBlockBody(arrayWitnessFields, hex.EncodeToString(expectedHash[:]))
	if err != nil {
		t.Fatalf("verifyRawBlockBody with array witnesses: %v", err)
	}
	if isValid {
		t.Fatal("expected changed witness field encoding to produce a different body hash")
	}
}

func TestDecodeBabbageWitnessSetsPreservesRawRedeemerMap(t *testing.T) {
	rawWitnessSets := []byte{0x81, 0xa1, 0x05, 0xa0}

	witnessSets, err := decodeBabbageWitnessSets(rawWitnessSets, 1)
	if err != nil {
		t.Fatalf("decodeBabbageWitnessSets: %v", err)
	}
	if got, want := hex.EncodeToString(witnessSets[0].Cbor()), "a105a0"; got != want {
		t.Fatalf("witness set cbor mismatch: got %s want %s", got, want)
	}
}

func rawBodyHash(fields rawBlockBodyFields) [32]byte {
	transactionBodiesHash := blake2b.Sum256(fields.transactionBodies)
	transactionWitnessSetsHash := blake2b.Sum256(fields.transactionWitnessSets)
	transactionMetadataSetHash := blake2b.Sum256(fields.transactionMetadataSet)
	invalidTransactionsHash := blake2b.Sum256(fields.invalidTransactions)

	serialized := make([]byte, 0, 32*4)
	serialized = append(serialized, transactionBodiesHash[:]...)
	serialized = append(serialized, transactionWitnessSetsHash[:]...)
	serialized = append(serialized, transactionMetadataSetHash[:]...)
	serialized = append(serialized, invalidTransactionsHash[:]...)
	return blake2b.Sum256(serialized)
}

func signedOperationalCertificateHeader(
	t *testing.T,
	sequenceNumber uint32,
	startKesPeriod uint32,
	slot uint64,
) (*ledger.BabbageBlockHeader, ed25519.PrivateKey) {
	t.Helper()

	privateKey := ed25519.NewKeyFromSeed(bytes.Repeat([]byte{0x42}, ed25519.SeedSize))
	publicKey := privateKey.Public().(ed25519.PublicKey)
	header := &ledger.BabbageBlockHeader{}
	copy(header.Body.IssuerVkey[:], publicKey)
	header.Body.Slot = slot
	header.Body.OpCert.HotVkey = bytes.Repeat([]byte{0x24}, ed25519.PublicKeySize)
	header.Body.OpCert.SequenceNumber = sequenceNumber
	header.Body.OpCert.KesPeriod = startKesPeriod
	header.Body.OpCert.Signature = ed25519.Sign(
		privateKey,
		operationalCertificateSignableBytes(
			header.Body.OpCert.HotVkey,
			uint64(sequenceNumber),
			uint64(startKesPeriod),
		),
	)
	return header, privateKey
}

func cloneOperationalCertificateHeader(header *ledger.BabbageBlockHeader) *ledger.BabbageBlockHeader {
	clone := *header
	clone.Body.OpCert.HotVkey = bytes.Clone(header.Body.OpCert.HotVkey)
	clone.Body.OpCert.Signature = bytes.Clone(header.Body.OpCert.Signature)
	return &clone
}
