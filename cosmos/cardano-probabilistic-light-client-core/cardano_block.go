package probabilisticcore

import (
	"bytes"
	"encoding/hex"
	"fmt"
	"strings"

	"github.com/blinklabs-io/gouroboros/cbor"
	"github.com/blinklabs-io/gouroboros/ledger"
	fxcbor "github.com/fxamacker/cbor/v2"
	"golang.org/x/crypto/blake2b"
)

type rawBlockBodyFields struct {
	transactionBodies      []byte
	transactionWitnessSets []byte
	transactionMetadataSet []byte
	invalidTransactions    []byte
}

type rawBodyBlock interface {
	rawBlockBodyFields() rawBlockBodyFields
}

type rawBabbageBlock struct {
	*ledger.BabbageBlock
	bodyFields rawBlockBodyFields
}

func (b *rawBabbageBlock) rawBlockBodyFields() rawBlockBodyFields {
	return b.bodyFields
}

type rawConwayBlock struct {
	*ledger.ConwayBlock
	bodyFields rawBlockBodyFields
}

func (b *rawConwayBlock) rawBlockBodyFields() rawBlockBodyFields {
	return b.bodyFields
}

func DecodeLedgerBlock(blockCbor []byte) (ledger.Block, error) {
	blockType, err := ledger.DetermineBlockType(blockCbor)
	if err == nil {
		decodedBlock, decodeErr := ledger.NewBlockFromCbor(blockType, blockCbor)
		if decodeErr != nil {
			return nil, decodeErr
		}
		if bodyFields, rawErr := extractRawBlockBodyFields(blockCbor); rawErr == nil {
			if wrappedBlock := wrapRawBodyFields(decodedBlock, bodyFields); wrappedBlock != nil {
				return wrappedBlock, nil
			}
		}
		return decodedBlock, nil
	}

	decodedBlock, fallbackErr := decodeRawBodyBlock(blockCbor)
	if fallbackErr == nil {
		return decodedBlock, nil
	}

	return nil, fmt.Errorf("%w; raw block fallback failed: %v", err, fallbackErr)
}

func wrapRawBodyFields(decodedBlock ledger.Block, bodyFields rawBlockBodyFields) ledger.Block {
	switch block := decodedBlock.(type) {
	case *ledger.BabbageBlock:
		return &rawBabbageBlock{
			BabbageBlock: block,
			bodyFields:   bodyFields,
		}
	case *ledger.ConwayBlock:
		return &rawConwayBlock{
			ConwayBlock: block,
			bodyFields:  bodyFields,
		}
	default:
		return nil
	}
}

func BlockPrevHash(decodedBlock ledger.Block) (string, error) {
	switch block := decodedBlock.(type) {
	case *ledger.BabbageBlock:
		return block.Header.Body.PrevHash.String(), nil
	case *ledger.ConwayBlock:
		return block.Header.Body.PrevHash.String(), nil
	case *rawBabbageBlock:
		return block.Header.Body.PrevHash.String(), nil
	case *rawConwayBlock:
		return block.Header.Body.PrevHash.String(), nil
	default:
		return "", fmt.Errorf("unsupported block era %T", decodedBlock)
	}
}

func BuildBlockVerificationArtifacts(decodedBlock ledger.Block) (string, string, []byte, error) {
	switch block := decodedBlock.(type) {
	case *ledger.BabbageBlock:
		bodyHex, err := EncodeNativeVerifiedBlockBodyHex(
			len(block.TransactionBodies),
			func(idx int) []byte {
				return block.TransactionBodies[idx].Cbor()
			},
			func(idx int) []byte {
				return block.TransactionWitnessSets[idx].Cbor()
			},
			block.TransactionMetadataSet,
		)
		if err != nil {
			return "", "", nil, err
		}
		return hex.EncodeToString(block.Header.Cbor()), bodyHex, append([]byte(nil), block.Header.Body.VrfKey...), nil
	case *ledger.ConwayBlock:
		bodyHex, err := EncodeNativeVerifiedBlockBodyHex(
			len(block.TransactionBodies),
			func(idx int) []byte {
				return block.TransactionBodies[idx].Cbor()
			},
			func(idx int) []byte {
				return block.TransactionWitnessSets[idx].Cbor()
			},
			block.TransactionMetadataSet,
		)
		if err != nil {
			return "", "", nil, err
		}
		return hex.EncodeToString(block.Header.Cbor()), bodyHex, append([]byte(nil), block.Header.Body.VrfKey...), nil
	case *rawBabbageBlock:
		return BuildBlockVerificationArtifacts(block.BabbageBlock)
	case *rawConwayBlock:
		return BuildBlockVerificationArtifacts(block.ConwayBlock)
	default:
		return "", "", nil, fmt.Errorf("unsupported block era %T", decodedBlock)
	}
}

func VerifyNativeBlock(decodedBlock ledger.Block, epochNonce []byte, slotsPerKesPeriod int) (bool, []byte, error) {
	header, err := nativeBabbageHeader(decodedBlock)
	if err != nil {
		return false, nil, err
	}

	isKesValid, err := ledger.VerifyKes(header, uint64(slotsPerKesPeriod))
	if err != nil {
		return false, nil, fmt.Errorf("KES invalid: %w", err)
	}

	vrfResult, ok := header.Body.VrfResult.([]interface{})
	if !ok || len(vrfResult) < 2 {
		return false, nil, fmt.Errorf("invalid VRF result shape")
	}
	vrfOutputBytes, ok := vrfResult[0].([]byte)
	if !ok {
		return false, nil, fmt.Errorf("invalid VRF output shape")
	}
	vrfProofBytes, ok := vrfResult[1].([]byte)
	if !ok {
		return false, nil, fmt.Errorf("invalid VRF proof shape")
	}

	vrfKeyBytes := append([]byte(nil), header.Body.VrfKey...)
	seed := ledger.MkInputVrf(int64(header.Body.Slot), epochNonce)
	output, err := ledger.VrfVerifyAndHash(vrfKeyBytes, vrfProofBytes, seed)
	if err != nil {
		return false, nil, fmt.Errorf("VRF invalid: %w", err)
	}
	isVrfValid := bytes.Equal(output, vrfOutputBytes)

	isBodyValid, err := verifyNativeBlockBody(decodedBlock, header.Body.BlockBodyHash.String())
	if err != nil {
		return false, nil, err
	}

	return isKesValid && isVrfValid && isBodyValid, vrfKeyBytes, nil
}

func nativeBabbageHeader(decodedBlock ledger.Block) (*ledger.BabbageBlockHeader, error) {
	switch block := decodedBlock.(type) {
	case *ledger.BabbageBlock:
		return block.Header, nil
	case *ledger.ConwayBlock:
		return &block.Header.BabbageBlockHeader, nil
	case *rawBabbageBlock:
		return block.Header, nil
	case *rawConwayBlock:
		return &block.Header.BabbageBlockHeader, nil
	default:
		return nil, fmt.Errorf("unsupported block era %T", decodedBlock)
	}
}

func verifyNativeBlockBody(decodedBlock ledger.Block, blockBodyHashHex string) (bool, error) {
	if rawBlock, ok := decodedBlock.(rawBodyBlock); ok {
		return verifyRawBlockBody(rawBlock.rawBlockBodyFields(), blockBodyHashHex)
	}

	_, bodyCborHex, _, err := BuildBlockVerificationArtifacts(decodedBlock)
	if err != nil {
		return false, fmt.Errorf("failed to build native verification payload: %w", err)
	}
	isBodyValid, err := ledger.VerifyBlockBody(bodyCborHex, blockBodyHashHex)
	if err != nil {
		return false, fmt.Errorf("VerifyBlockBody error: %w", err)
	}
	return isBodyValid, nil
}

func verifyRawBlockBody(fields rawBlockBodyFields, blockBodyHashHex string) (bool, error) {
	blockBodyHash, err := hex.DecodeString(blockBodyHashHex)
	if err != nil {
		return false, fmt.Errorf("block body hash decode error: %w", err)
	}

	transactionBodiesHash := blake2b.Sum256(fields.transactionBodies)
	transactionWitnessSetsHash := blake2b.Sum256(fields.transactionWitnessSets)
	transactionMetadataSetHash := blake2b.Sum256(fields.transactionMetadataSet)
	invalidTransactionsHash := blake2b.Sum256(fields.invalidTransactions)

	serialized := make([]byte, 0, 32*4)
	serialized = append(serialized, transactionBodiesHash[:]...)
	serialized = append(serialized, transactionWitnessSetsHash[:]...)
	serialized = append(serialized, transactionMetadataSetHash[:]...)
	serialized = append(serialized, invalidTransactionsHash[:]...)

	calculated := blake2b.Sum256(serialized)
	return bytes.Equal(calculated[:], blockBodyHash), nil
}

func EncodeNativeVerifiedBlockBodyHex(
	txCount int,
	bodyCborAt func(int) []byte,
	witnessCborAt func(int) []byte,
	transactionMetadataSet map[uint]*cbor.LazyValue,
) (string, error) {
	txsRaw := make([][]string, 0, txCount)
	for idx := 0; idx < txCount; idx++ {
		auxHex := ""
		if transactionMetadataSet != nil && transactionMetadataSet[uint(idx)] != nil {
			auxHex = hex.EncodeToString(untagNativeVerifiedMetadata(transactionMetadataSet[uint(idx)].Cbor()))
		}
		txsRaw = append(txsRaw, []string{
			hex.EncodeToString(bodyCborAt(idx)),
			hex.EncodeToString(witnessCborAt(idx)),
			auxHex,
		})
	}

	bodyCbor, err := cbor.Encode(txsRaw)
	if err != nil {
		return "", err
	}
	return hex.EncodeToString(bodyCbor), nil
}

func untagNativeVerifiedMetadata(metadataCbor []byte) []byte {
	// ledger.VerifyBlockBody wraps auxiliary data in CBOR tag 259 before hashing.
	// gouroboros stores block metadata with the tag already present, so pass only
	// the tag content to avoid double-tagging metadata-bearing blocks.
	const auxDataTag259Prefix = "\xd9\x01\x03"
	if bytes.HasPrefix(metadataCbor, []byte(auxDataTag259Prefix)) {
		return metadataCbor[len(auxDataTag259Prefix):]
	}
	return metadataCbor
}

func decodeRawBodyBlock(blockCbor []byte) (ledger.Block, error) {
	fields, bodyFields, err := rawBlockFields(blockCbor)
	if err != nil {
		return nil, err
	}

	if block, err := decodeRawConwayBlock(blockCbor, fields, bodyFields); err == nil {
		return block, nil
	}
	return decodeRawBabbageBlock(blockCbor, fields, bodyFields)
}

func extractRawBlockBodyFields(blockCbor []byte) (rawBlockBodyFields, error) {
	_, bodyFields, err := rawBlockFields(blockCbor)
	return bodyFields, err
}

func rawBlockFields(blockCbor []byte) ([]fxcbor.RawMessage, rawBlockBodyFields, error) {
	var fields []fxcbor.RawMessage
	if err := fxcbor.Unmarshal(blockCbor, &fields); err != nil {
		return nil, rawBlockBodyFields{}, err
	}
	if len(fields) != 5 {
		return nil, rawBlockBodyFields{}, fmt.Errorf("expected 5 block fields, got %d", len(fields))
	}

	bodyFields := rawBlockBodyFields{
		transactionBodies:      cloneRawMessage(fields[1]),
		transactionWitnessSets: cloneRawMessage(fields[2]),
		transactionMetadataSet: cloneRawMessage(fields[3]),
		invalidTransactions:    cloneRawMessage(fields[4]),
	}

	return fields, bodyFields, nil
}

func decodeRawBabbageBlock(
	blockCbor []byte,
	fields []fxcbor.RawMessage,
	bodyFields rawBlockBodyFields,
) (ledger.Block, error) {
	header, err := ledger.NewBabbageBlockHeaderFromCbor(fields[0])
	if err != nil {
		return nil, err
	}
	transactionBodies, err := decodeBabbageTransactionBodies(fields[1])
	if err != nil {
		return nil, fmt.Errorf("decode Babbage transaction bodies: %w", err)
	}
	transactionWitnessSets, err := decodeBabbageWitnessSets(fields[2], len(transactionBodies))
	if err != nil {
		return nil, fmt.Errorf("decode Babbage witness sets: %w", err)
	}
	transactionMetadataSet, err := decodeTransactionMetadataSet(fields[3])
	if err != nil {
		return nil, fmt.Errorf("decode Babbage metadata set: %w", err)
	}
	invalidTransactions, err := decodeInvalidTransactions(fields[4])
	if err != nil {
		return nil, fmt.Errorf("decode Babbage invalid transactions: %w", err)
	}

	block := &ledger.BabbageBlock{
		Header:                 header,
		TransactionBodies:      transactionBodies,
		TransactionWitnessSets: transactionWitnessSets,
		TransactionMetadataSet: transactionMetadataSet,
		InvalidTransactions:    invalidTransactions,
	}
	block.SetCbor(blockCbor)
	return &rawBabbageBlock{
		BabbageBlock: block,
		bodyFields:   bodyFields,
	}, nil
}

func decodeRawConwayBlock(
	blockCbor []byte,
	fields []fxcbor.RawMessage,
	bodyFields rawBlockBodyFields,
) (ledger.Block, error) {
	header, err := ledger.NewConwayBlockHeaderFromCbor(fields[0])
	if err != nil {
		return nil, err
	}
	transactionBodies, err := decodeConwayTransactionBodies(fields[1])
	if err != nil {
		return nil, fmt.Errorf("decode Conway transaction bodies: %w", err)
	}
	transactionWitnessSets, err := decodeBabbageWitnessSets(fields[2], len(transactionBodies))
	if err != nil {
		return nil, fmt.Errorf("decode Conway witness sets: %w", err)
	}
	transactionMetadataSet, err := decodeTransactionMetadataSet(fields[3])
	if err != nil {
		return nil, fmt.Errorf("decode Conway metadata set: %w", err)
	}
	invalidTransactions, err := decodeInvalidTransactions(fields[4])
	if err != nil {
		return nil, fmt.Errorf("decode Conway invalid transactions: %w", err)
	}

	block := &ledger.ConwayBlock{
		Header:                 header,
		TransactionBodies:      transactionBodies,
		TransactionWitnessSets: transactionWitnessSets,
		TransactionMetadataSet: transactionMetadataSet,
		InvalidTransactions:    invalidTransactions,
	}
	block.SetCbor(blockCbor)
	return &rawConwayBlock{
		ConwayBlock: block,
		bodyFields:  bodyFields,
	}, nil
}

func decodeBabbageTransactionBodies(rawBodies []byte) ([]ledger.BabbageTransactionBody, error) {
	var bodyMessages []fxcbor.RawMessage
	if err := fxcbor.Unmarshal(rawBodies, &bodyMessages); err != nil {
		return nil, err
	}

	transactionBodies := make([]ledger.BabbageTransactionBody, 0, len(bodyMessages))
	for idx, bodyMessage := range bodyMessages {
		body, err := ledger.NewBabbageTransactionBodyFromCbor(bodyMessage)
		if err != nil {
			return nil, fmt.Errorf("failed to decode Babbage tx body %d: %w", idx, err)
		}
		transactionBodies = append(transactionBodies, *body)
	}
	return transactionBodies, nil
}

func decodeConwayTransactionBodies(rawBodies []byte) ([]ledger.ConwayTransactionBody, error) {
	var bodyMessages []fxcbor.RawMessage
	if err := fxcbor.Unmarshal(rawBodies, &bodyMessages); err != nil {
		return nil, err
	}

	transactionBodies := make([]ledger.ConwayTransactionBody, 0, len(bodyMessages))
	for idx, bodyMessage := range bodyMessages {
		body, err := ledger.NewConwayTransactionBodyFromCbor(bodyMessage)
		if err != nil {
			return nil, fmt.Errorf("failed to decode Conway tx body %d: %w", idx, err)
		}
		transactionBodies = append(transactionBodies, *body)
	}
	return transactionBodies, nil
}

func decodeBabbageWitnessSets(rawWitnessSets []byte, txCount int) ([]ledger.BabbageTransactionWitnessSet, error) {
	if witnessSets, err := decodeBabbageWitnessSetArray(rawWitnessSets, txCount); err == nil {
		return witnessSets, nil
	} else {
		mapWitnessSets, mapErr := decodeBabbageWitnessSetMap(rawWitnessSets, txCount)
		if mapErr == nil {
			return mapWitnessSets, nil
		}
		return nil, fmt.Errorf("array form failed: %v; map form failed: %w", err, mapErr)
	}
}

func decodeBabbageWitnessSetArray(rawWitnessSets []byte, txCount int) ([]ledger.BabbageTransactionWitnessSet, error) {
	var witnessMessages []fxcbor.RawMessage
	if err := fxcbor.Unmarshal(rawWitnessSets, &witnessMessages); err != nil {
		return nil, err
	}
	if len(witnessMessages) != txCount {
		return nil, fmt.Errorf("witness array length %d does not match tx count %d", len(witnessMessages), txCount)
	}

	witnessSets := make([]ledger.BabbageTransactionWitnessSet, 0, len(witnessMessages))
	for idx, witnessMessage := range witnessMessages {
		witnessSet, err := decodeBabbageWitnessSet(idx, witnessMessage)
		if err != nil {
			return nil, err
		}
		witnessSets = append(witnessSets, witnessSet)
	}
	return witnessSets, nil
}

func decodeBabbageWitnessSetMap(rawWitnessSets []byte, txCount int) ([]ledger.BabbageTransactionWitnessSet, error) {
	var witnessMessages map[uint]fxcbor.RawMessage
	if err := fxcbor.Unmarshal(rawWitnessSets, &witnessMessages); err != nil {
		return nil, err
	}

	witnessSets := make([]ledger.BabbageTransactionWitnessSet, txCount)
	for idx := range witnessSets {
		witnessSets[idx].SetCbor([]byte{0xa0})
	}
	for txIndex, witnessMessage := range witnessMessages {
		if txIndex >= uint(txCount) {
			return nil, fmt.Errorf("witness map index %d out of range for tx count %d", txIndex, txCount)
		}
		witnessSet, err := decodeBabbageWitnessSet(int(txIndex), witnessMessage)
		if err != nil {
			return nil, err
		}
		witnessSets[txIndex] = witnessSet
	}
	return witnessSets, nil
}

func decodeBabbageWitnessSet(idx int, rawWitnessSet []byte) (ledger.BabbageTransactionWitnessSet, error) {
	var witnessSet ledger.BabbageTransactionWitnessSet
	witnessSet.SetCbor(rawWitnessSet)
	return witnessSet, nil
}

func decodeTransactionMetadataSet(rawMetadataSet []byte) (map[uint]*cbor.LazyValue, error) {
	var metadataMessages map[uint]fxcbor.RawMessage
	if err := fxcbor.Unmarshal(rawMetadataSet, &metadataMessages); err == nil {
		metadataSet := make(map[uint]*cbor.LazyValue, len(metadataMessages))
		for txIndex, metadataMessage := range metadataMessages {
			metadata, err := decodeMetadataValue(txIndex, metadataMessage)
			if err != nil {
				return nil, err
			}
			if metadata != nil {
				metadataSet[txIndex] = metadata
			}
		}
		return metadataSet, nil
	}

	var metadataArray []fxcbor.RawMessage
	if err := fxcbor.Unmarshal(rawMetadataSet, &metadataArray); err != nil {
		return nil, err
	}
	metadataSet := make(map[uint]*cbor.LazyValue, len(metadataArray))
	for txIndex, metadataMessage := range metadataArray {
		metadata, err := decodeMetadataValue(uint(txIndex), metadataMessage)
		if err != nil {
			return nil, err
		}
		if metadata != nil {
			metadataSet[uint(txIndex)] = metadata
		}
	}
	return metadataSet, nil
}

func decodeMetadataValue(txIndex uint, metadataMessage []byte) (*cbor.LazyValue, error) {
	if len(metadataMessage) == 0 || (len(metadataMessage) == 1 && metadataMessage[0] == 0xf6) {
		return nil, nil
	}
	metadata := cbor.LazyValue{}
	if err := metadata.UnmarshalCBOR(metadataMessage); err != nil {
		return nil, fmt.Errorf("failed to decode metadata for tx %d: %w", txIndex, err)
	}
	return &metadata, nil
}

func decodeInvalidTransactions(rawInvalidTransactions []byte) ([]uint, error) {
	var invalidTransactions []uint
	if err := fxcbor.Unmarshal(rawInvalidTransactions, &invalidTransactions); err != nil {
		return nil, err
	}
	return invalidTransactions, nil
}

func cloneRawMessage(raw fxcbor.RawMessage) []byte {
	return append([]byte(nil), raw...)
}

func ExtractHostStateTxBodyCborFromAnchorBlock(anchorBlockCbor []byte, hostStateTxHash string) ([]byte, error) {
	decodedBlock, err := DecodeLedgerBlock(anchorBlockCbor)
	if err != nil {
		return nil, fmt.Errorf("failed to decode anchor block: %w", err)
	}

	for _, tx := range decodedBlock.Transactions() {
		if strings.EqualFold(tx.Hash(), hostStateTxHash) {
			txBodyCbor, bodyErr := ExtractTransactionBodyCbor(tx)
			if bodyErr != nil {
				return nil, fmt.Errorf("failed to decode host state tx body: %w", bodyErr)
			}
			return txBodyCbor, nil
		}
	}

	return nil, fmt.Errorf("host state tx %s not found in authenticated anchor block", hostStateTxHash)
}

func ExtractTransactionBodyCbor(tx ledger.Transaction) ([]byte, error) {
	switch typedTx := tx.(type) {
	case *ledger.BabbageTransaction:
		return typedTx.Body.Cbor(), nil
	case *ledger.ConwayTransaction:
		return typedTx.Body.Cbor(), nil
	default:
		return nil, fmt.Errorf("unsupported anchor transaction type %T", tx)
	}
}
