package cardano

import (
	"bytes"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"

	"github.com/blinklabs-io/gouroboros/cbor"
	"github.com/blinklabs-io/gouroboros/ledger"
	"github.com/cosmos/cosmos-sdk/types/bech32"
	"golang.org/x/crypto/blake2b"
)

const (
	LOVELACE_TOKEN              = "lovelace"
	BLOCK_BODY_HASH_ZERO_TX_HEX = "29571d16f081709b3c48651860077bebf9340abb3fc7133443c54f1f5a5edcf1"
)

type multiAssetJson struct {
	Name        string `json:"name"`
	NameHex     string `json:"nameHex"`
	PolicyId    string `json:"policyId"`
	Fingerprint string `json:"fingerprint"`
	Amount      uint64 `json:"amount"`
}

func VerifyBlockBody(data string, blockBodyHash string) (bool, error) {
	rawDataBytes, _ := hex.DecodeString(data)
	var txsRaw [][]string
	_, err := cbor.Decode(rawDataBytes, &txsRaw)
	if err != nil {
		return false, errors.New(fmt.Sprintf("VerifyBlockBody: txs decode error, %v", err.Error()))
	}

	blockBodyHashByte, decodeBBHError := hex.DecodeString(blockBodyHash)
	if decodeBBHError != nil {
		return false, errors.New(fmt.Sprintf("VerifyBlockBody: blockBodyHashByte decode error, %v", decodeBBHError.Error()))
	}

	var calculateBlockBodyHashByte [32]byte
	if len(txsRaw) == 0 {
		zeroTxHash, _ := hex.DecodeString(BLOCK_BODY_HASH_ZERO_TX_HEX)
		copy(calculateBlockBodyHashByte[:], zeroTxHash[:32])
	} else {
		calculateBlockBodyHash, calculateHashError := CalculateBlockBodyHash(txsRaw)
		if calculateHashError != nil {
			return false, errors.New(fmt.Sprintf("VerifyBlockBody: CalculateBlockBodyHash error, %v", calculateHashError.Error()))
		}
		calculateBlockBodyHashByte = blake2b.Sum256(calculateBlockBodyHash)
	}
	return bytes.Equal(calculateBlockBodyHashByte[:32], blockBodyHashByte), nil
}

func CalculateBlockBodyHash(txsRaw [][]string) ([]byte, error) {
	var txSeqBody []cbor.RawMessage
	var txSeqWit []cbor.RawMessage
	txSeqMetadata := map[uint64]cbor.RawTag{}
	txSeqNonValid := []uint{}
	for index, tx := range txsRaw {
		if len(tx) != 3 {
			return nil, errors.New(fmt.Sprintf("CalculateBlockBodyHash: tx len error, tx index %v length = %v", index, len(tx)))
		}
		bodyTmpHex := tx[0]
		bodyTmpBytes, bodyTmpBytesError := hex.DecodeString(bodyTmpHex)
		if bodyTmpBytesError != nil {
			return nil, errors.New(fmt.Sprintf("CalculateBlockBodyHash: decode body tx[%v] error, %v", index, bodyTmpBytesError.Error()))
		}
		txSeqBody = append(txSeqBody, bodyTmpBytes)

		witTmpHex := tx[1]
		witTmpBytes, witTmpBytesError := hex.DecodeString(witTmpHex)
		if witTmpBytesError != nil {
			return nil, errors.New(fmt.Sprintf("CalculateBlockBodyHash: decode wit tx[%v] error, %v", index, witTmpBytesError.Error()))
		}

		txSeqWit = append(txSeqWit, witTmpBytes)

		auxTmpHex := tx[2]
		if auxTmpHex != "" {
			auxBytes, auxBytesError := hex.DecodeString(auxTmpHex)
			if auxBytesError != nil {
				return nil, errors.New(fmt.Sprintf("CalculateBlockBodyHash: decode aux tx[%v] error, %v", index, auxBytesError.Error()))
			}
			// Cardano use Tag 259 for this when encCbor
			// Ref: https://github.com/IntersectMBO/cardano-ledger/blob/master/eras/alonzo/impl/src/Cardano/Ledger/Alonzo/TxAuxData.hs#L125
			txSeqMetadata[uint64(index)] = cbor.RawTag{
				Number: 259, Content: auxBytes,
			}
		}
		// TODO: should form nonValid TX here
	}
	txSeqBodyBytes, txSeqBodyBytesError := cbor.Encode(txSeqBody)
	if txSeqBodyBytesError != nil {
		return nil, errors.New(fmt.Sprintf("CalculateBlockBodyHash: encode txSeqBody error, %v", txSeqBodyBytesError.Error()))
	}

	txSeqBodySum32Bytes := blake2b.Sum256(txSeqBodyBytes)
	txSeqBodySumBytes := txSeqBodySum32Bytes[:]

	txSeqWitsBytes, txSeqWitsBytesError := cbor.Encode(txSeqWit)
	if txSeqWitsBytesError != nil {
		return nil, errors.New(fmt.Sprintf("CalculateBlockBodyHash: encode txSeqWit error, %v", txSeqWitsBytesError.Error()))
	}
	txSeqWitsSum32Bytes := blake2b.Sum256(txSeqWitsBytes)
	txSeqWitsSumBytes := txSeqWitsSum32Bytes[:]

	txSeqMetadataBytes, txSeqMetadataBytesError := cbor.Encode(txSeqMetadata)
	if txSeqMetadataBytesError != nil {
		return nil, errors.New(fmt.Sprintf("CalculateBlockBodyHash: encode txSeqMetadata error, %v", txSeqMetadataBytesError.Error()))
	}
	txSeqMetadataSum32Bytes := blake2b.Sum256(txSeqMetadataBytes)
	txSeqMetadataSumBytes := txSeqMetadataSum32Bytes[:]

	txSeqNonValidBytes, txSeqNonValidBytesError := cbor.Encode(txSeqNonValid)
	if txSeqNonValidBytesError != nil {
		return nil, errors.New(fmt.Sprintf("CalculateBlockBodyHash: encode txSeqNonValid error, %v", txSeqNonValidBytesError.Error()))
	}
	txSeqIsValidSum32Bytes := blake2b.Sum256(txSeqNonValidBytes)
	txSeqIsValidSumBytes := txSeqIsValidSum32Bytes[:]

	var serializeBytes []byte
	// Ref: https://github.com/IntersectMBO/cardano-ledger/blob/9cc766a31ad6fb31f88e25a770c902d24fa32499/eras/alonzo/impl/src/Cardano/Ledger/Alonzo/TxSeq.hs#L183
	serializeBytes = append(serializeBytes, txSeqBodySumBytes...)
	serializeBytes = append(serializeBytes, txSeqWitsSumBytes...)
	serializeBytes = append(serializeBytes, txSeqMetadataSumBytes...)
	serializeBytes = append(serializeBytes, txSeqIsValidSumBytes...)

	return serializeBytes, nil
}

func GetTxBodies(txsRaw [][]string) ([]ledger.BabbageTransactionBody, error) {
	var bodies []ledger.BabbageTransactionBody
	for index, tx := range txsRaw {
		var tmp ledger.BabbageTransactionBody
		bodyTmpHex := tx[0]
		bodyTmpBytes, bodyTmpBytesError := hex.DecodeString(bodyTmpHex)
		if bodyTmpBytesError != nil {
			return nil, errors.New(fmt.Sprintf("CalculateBlockBodyHash: decode bodyTmpBytesError, index %v, error, %v", index, bodyTmpBytesError.Error()))
		}
		_, err := cbor.Decode(bodyTmpBytes, &tmp)
		if err != nil {
			return nil, errors.New(fmt.Sprintf("CalculateBlockBodyHash: decode bodyTmpBytes, index %v, error, %v", index, err.Error()))
		}
		bodies = append(bodies, tmp)
	}
	return bodies, nil
}

func GetBlockOutput(txBodies []ledger.BabbageTransactionBody) ([]UTXOOutput, []RegisCert, []DeRegisCert, error) {
	var outputs []UTXOOutput
	var regisCerts []RegisCert
	var deRegisCerts []DeRegisCert
	for txIndex, tx := range txBodies {
		txHash := tx.Hash()
		txOutputs := tx.Outputs()
		for outputIndex, txOutput := range txOutputs {
			cborDatum := []byte{}
			if txOutput.Datum() != nil {
				cborDatum = txOutput.Datum().Cbor()
			}
			cborDatumHex := hex.EncodeToString(cborDatum)
			tokens, extractTokensError := ExtractTokens(txOutput)
			if extractTokensError != nil {
				return nil, nil, nil, errors.New(fmt.Sprintf("GetBlockOutput: ExtractTokens error, tx index %v, outputIndex %v, error, %v", txIndex, outputIndex, extractTokensError.Error()))
			}
			tmpOutput := UTXOOutput{
				TxHash:      txHash,
				OutputIndex: strconv.Itoa(outputIndex),
				Tokens:      tokens,
				DatumHex:    cborDatumHex,
			}
			outputs = append(outputs, tmpOutput)
		}

		// Ref: https://github.com/IntersectMBO/cardano-ledger/blob/master/eras/babbage/impl/cddl-files/babbage.cddl#L193
		// We will only focus on:
		// pool_registration = (3, pool_params)
		// pool_retirement = (4, pool_keyhash, epoch)
		txCertsBytes := tx.Certificates
		if txCertsBytes != nil {
			var certs []interface{}
			_, err := cbor.Decode(txCertsBytes, &certs)
			if err != nil {
				return nil, nil, nil, errors.New(fmt.Sprintf("GetBlockOutput: decode txCertsBytes, tx index %v, error, %v", txIndex, err.Error()))
			}
			for certIndex, cert := range certs {
				certBytes := cert.([]interface{})
				// For type like this, Haskell cbor will have an int flag at first byte, to detect which struct to be used
				flagByte := certBytes[0].(uint64)
				if flagByte == 3 {
					poolIdBytes := certBytes[1].([]byte)
					vrfKeyHashBytes := certBytes[2].([]byte)
					vrfKeyHashHex := hex.EncodeToString(vrfKeyHashBytes)
					poolId, poolIdError := PoolIdToBech32(poolIdBytes)
					if poolIdError != nil {
						return nil, nil, nil, errors.New(fmt.Sprintf("GetBlockOutput: RegisSPO => PoolIdToBech32 , tx index %v, cert index %v, error, %v", txIndex, certIndex, poolIdError.Error()))
					}
					regisCerts = append(regisCerts, RegisCert{
						RegisPoolId:  poolId,
						RegisPoolVrf: vrfKeyHashHex,
						TxIndex:      txIndex,
					})
				} else if flagByte == 4 {
					// pool_retirement
					poolIdBytes := certBytes[1].([]byte)
					poolId, poolIdError := PoolIdToBech32(poolIdBytes)
					if poolIdError != nil {
						return nil, nil, nil, errors.New(fmt.Sprintf("GetBlockOutput: RetireSPO => PoolIdToBech32, tx index %v, cert index %v, error, %v", txIndex, certIndex, poolIdError.Error()))
					}
					retireEpoch := certBytes[2].(uint64)
					deRegisCerts = append(deRegisCerts, DeRegisCert{
						DeRegisPoolId: poolId,
						DeRegisEpoch:  strconv.FormatUint(retireEpoch, 10),
						TxIndex:       txIndex,
					})
				}
			}
		}

	}

	return outputs, regisCerts, deRegisCerts, nil
}

func PoolIdToBech32(data []byte) (string, error) {
	pool, err := bech32.ConvertAndEncode("pool", data)
	if err != nil {
		return "", errors.New(fmt.Sprintf("PoolIdToBech32: ConvertAndEncode error, %v", err.Error()))
	}
	return pool, nil
}

func ExtractTokens(output ledger.TransactionOutput) ([]UTXOOutputToken, error) {
	var outputTokens []UTXOOutputToken
	// append lovelace first
	outputTokens = append(outputTokens, UTXOOutputToken{
		TokenAssetName: LOVELACE_TOKEN,
		TokenValue:     strconv.FormatUint(output.Amount(), 10),
	})
	if output.Assets() != nil {
		assetsBytes, assetsBytesError := output.Assets().MarshalJSON()
		if assetsBytesError != nil {
			return nil, errors.New(fmt.Sprintf("ExtractTokens: MarshalJSON assets error, %v", assetsBytesError.Error()))
		}
		var assets []multiAssetJson
		err := json.Unmarshal(assetsBytes, &assets)
		if err != nil {
			return nil, errors.New(fmt.Sprintf("ExtractTokens: json.Unmarshal error, %v", err.Error()))
		}
		for _, asset := range assets {
			outputTokens = append(outputTokens, UTXOOutputToken{
				TokenAssetName: asset.PolicyId + asset.NameHex,
				TokenValue:     strconv.FormatUint(asset.Amount, 10),
			})
		}
	}
	return outputTokens, nil
}
