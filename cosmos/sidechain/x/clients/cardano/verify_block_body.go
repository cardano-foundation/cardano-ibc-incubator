package cardano

import (
	"bytes"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strconv"

	"github.com/blinklabs-io/gouroboros/cbor"
	"github.com/blinklabs-io/gouroboros/ledger"
	"github.com/cosmos/cosmos-sdk/types/bech32"
	"golang.org/x/crypto/blake2b"
)

const LOVELACE_TOKEN = "lovelace"

type multiAssetJson struct {
	Name        string `json:"name"`
	NameHex     string `json:"nameHex"`
	PolicyId    string `json:"policyId"`
	Fingerprint string `json:"fingerprint"`
	Amount      uint64 `json:"amount"`
}

func VerifyBlockBody(data string, blockBodyHash string) bool {
	rawDataBytes, _ := hex.DecodeString(data)
	var txsRaw [][]string
	_, err := cbor.Decode(rawDataBytes, &txsRaw)
	if err != nil {
		return false
	}

	blockBodyHashByte, _ := hex.DecodeString(blockBodyHash)

	var calculateBlockBodyHashByte [32]byte
	if len(txsRaw) == 0 {
		zeroTxHashHex := "29571d16f081709b3c48651860077bebf9340abb3fc7133443c54f1f5a5edcf1"
		zeroTxHash, _ := hex.DecodeString(zeroTxHashHex)
		copy(calculateBlockBodyHashByte[:], zeroTxHash[:32])
	} else {
		calculateBlockBodyHash := CalculateBlockBodyHash(txsRaw)
		calculateBlockBodyHashByte = blake2b.Sum256(calculateBlockBodyHash)
	}

	return bytes.Equal(calculateBlockBodyHashByte[:32], blockBodyHashByte)
}

func CalculateBlockBodyHash(txsRaw [][]string) []byte {
	var txSeqBody []cbor.RawMessage
	var txSeqWit []cbor.RawMessage
	txSeqMetadata := map[uint64]cbor.RawTag{}
	txSeqNonValid := []uint{}
	for index, tx := range txsRaw {
		bodyTmpHex := tx[0]
		bodyTmpBytes, _ := hex.DecodeString(bodyTmpHex)
		txSeqBody = append(txSeqBody, bodyTmpBytes)

		witTmpHex := tx[1]
		witTmpBytes, _ := hex.DecodeString(witTmpHex)
		txSeqWit = append(txSeqWit, witTmpBytes)

		auxTmpHex := tx[2]
		if auxTmpHex != "" {
			auxBytes, _ := hex.DecodeString(auxTmpHex)
			// Cardano use Tag 259 for this when encCbor
			// Ref: https://github.com/IntersectMBO/cardano-ledger/blob/master/eras/alonzo/impl/src/Cardano/Ledger/Alonzo/TxAuxData.hs#L125
			txSeqMetadata[uint64(index)] = cbor.RawTag{
				Number: 259, Content: auxBytes,
			}
		}
		// TODO: should form nonValid TX here
	}
	txSeqBodyBytes, _ := cbor.Encode(txSeqBody)

	txSeqBodySum32Bytes := blake2b.Sum256(txSeqBodyBytes)
	txSeqBodySumBytes := txSeqBodySum32Bytes[:]

	txSeqWitsBytes, _ := cbor.Encode(txSeqWit)
	txSeqWitsSum32Bytes := blake2b.Sum256(txSeqWitsBytes)
	txSeqWitsSumBytes := txSeqWitsSum32Bytes[:]

	txSeqMetadataBytes, _ := cbor.Encode(txSeqMetadata)
	txSeqMetadataSum32Bytes := blake2b.Sum256(txSeqMetadataBytes)
	txSeqMetadataSumBytes := txSeqMetadataSum32Bytes[:]

	txSeqNonValidBytes, _ := cbor.Encode(txSeqNonValid)
	txSeqIsValidSum32Bytes := blake2b.Sum256(txSeqNonValidBytes)
	txSeqIsValidSumBytes := txSeqIsValidSum32Bytes[:]

	var serializeBytes []byte
	// Ref: https://github.com/IntersectMBO/cardano-ledger/blob/9cc766a31ad6fb31f88e25a770c902d24fa32499/eras/alonzo/impl/src/Cardano/Ledger/Alonzo/TxSeq.hs#L183
	serializeBytes = append(serializeBytes, txSeqBodySumBytes...)
	serializeBytes = append(serializeBytes, txSeqWitsSumBytes...)
	serializeBytes = append(serializeBytes, txSeqMetadataSumBytes...)
	serializeBytes = append(serializeBytes, txSeqIsValidSumBytes...)

	return serializeBytes
}

func GetTxBodies(txsRaw [][]string) []ledger.BabbageTransactionBody {
	var bodies []ledger.BabbageTransactionBody
	for _, tx := range txsRaw {
		var tmp ledger.BabbageTransactionBody
		bodyTmpHex := tx[0]
		bodyTmpBytes, _ := hex.DecodeString(bodyTmpHex)
		_, err := cbor.Decode(bodyTmpBytes, &tmp)
		if err != nil {
			return nil
		}
		bodies = append(bodies, tmp)
	}
	return bodies
}

func GetBlockOutput(txBodies []ledger.BabbageTransactionBody) ([]UTXOOutput, []RegisCert, []DeRegisCert) {
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
			tmpOutput := UTXOOutput{
				TxHash:      txHash,
				OutputIndex: strconv.Itoa(outputIndex),
				Tokens:      ExtractTokens(txOutput),
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
				fmt.Println(err)
			}
			for _, cert := range certs {
				certBytes := cert.([]interface{})
				// For type like this, Haskell cbor will have an int flag at first byte, to detect which struct to be used
				flagByte := certBytes[0].(uint64)
				if flagByte == 3 {
					poolIdBytes := certBytes[1].([]byte)
					vrfKeyHashBytes := certBytes[2].([]byte)
					vrfKeyHashHex := hex.EncodeToString(vrfKeyHashBytes)
					poolId := PoolIdToBech32(poolIdBytes)
					regisCerts = append(regisCerts, RegisCert{
						RegisPoolId:  poolId,
						RegisPoolVrf: vrfKeyHashHex,
						TxIndex:      txIndex,
					})
				} else if flagByte == 4 {
					// pool_retirement
					poolIdBytes := certBytes[1].([]byte)
					poolId := PoolIdToBech32(poolIdBytes)
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

	return outputs, regisCerts, deRegisCerts
}

func PoolIdToBech32(data []byte) string {
	pool, _ := bech32.ConvertAndEncode("pool", data)
	return pool
}

func ExtractTokens(output ledger.TransactionOutput) []UTXOOutputToken {
	var outputTokens []UTXOOutputToken
	// append lovelace first
	outputTokens = append(outputTokens, UTXOOutputToken{
		TokenAssetName: LOVELACE_TOKEN,
		TokenValue:     strconv.FormatUint(output.Amount(), 10),
	})
	if output.Assets() != nil {
		assetsBytes, _ := output.Assets().MarshalJSON()
		var assets []multiAssetJson
		err := json.Unmarshal(assetsBytes, &assets)
		if err != nil {
			fmt.Println(err)
		}
		for _, asset := range assets {
			outputTokens = append(outputTokens, UTXOOutputToken{
				TokenAssetName: asset.PolicyId + asset.NameHex,
				TokenValue:     strconv.FormatUint(asset.Amount, 10),
			})
		}
	}
	return outputTokens
}
