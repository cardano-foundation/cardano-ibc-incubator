package cardano

import (
	"bytes"
	"encoding/hex"
	"errors"
	"fmt"
	"github.com/blinklabs-io/gouroboros/cbor"
	"github.com/blinklabs-io/gouroboros/ledger"
)

func VerifyBlock(block BlockHexCbor) (error, bool, string, uint64, uint64) {
	headerCborHex := block.HeaderCbor
	epochNonceHex := block.Eta0
	bodyHex := block.BlockBodyCbor
	slotPerKesPeriod := uint64(block.Spk)

	isValid := false
	vrfHex := ""

	// check is KES valid
	headerCborByte, headerDecodeError := hex.DecodeString(headerCborHex)
	if headerDecodeError != nil {
		return errors.New(fmt.Sprintf("VerifyBlock: headerCborByte decode error, %v", headerDecodeError.Error())), false, "", 0, 0
	}
	header, headerUnmarshalError := ledger.NewBabbageBlockHeaderFromCbor(headerCborByte)
	if headerUnmarshalError != nil {
		return errors.New(fmt.Sprintf("VerifyBlock: header unmarshall error, %v", headerUnmarshalError.Error())), false, "", 0, 0
	}
	isKesValid, errKes := VerifyKes(header, slotPerKesPeriod)
	if errKes != nil {
		return errors.New(fmt.Sprintf("VerifyBlock: kes invalid, %v", errKes.Error())), false, "", 0, 0
	}

	// check is VRF valid
	// Ref: https://github.com/IntersectMBO/ouroboros-consensus/blob/de74882102236fdc4dd25aaa2552e8b3e208448c/ouroboros-consensus-protocol/src/ouroboros-consensus-protocol/Ouroboros/Consensus/Protocol/Praos.hs#L541
	epochNonceByte, epochNonceDecodeError := hex.DecodeString(epochNonceHex)
	if epochNonceDecodeError != nil {
		return errors.New(fmt.Sprintf("VerifyBlock: epochNonceByte decode error, %v", epochNonceDecodeError.Error())), false, "", 0, 0
	}
	vrfBytes := header.Body.VrfKey[:]
	vrfResult := header.Body.VrfResult.([]interface{})
	vrfProofBytes := vrfResult[1].([]byte)
	vrfOutputBytes := vrfResult[0].([]byte)
	seed := MkInputVrf(int64(header.Body.Slot), epochNonceByte)
	output, errVrf := VrfVerifyAndHash(vrfBytes, vrfProofBytes, seed)
	if errVrf != nil {
		return errors.New(fmt.Sprintf("VerifyBlock: vrf invalid, %v", errVrf.Error())), false, "", 0, 0
	}
	isVrfValid := bytes.Equal(output, vrfOutputBytes)

	// check if block data valid
	blockBodyHash := header.Body.BlockBodyHash
	blockBodyHashHex := hex.EncodeToString(blockBodyHash[:])
	isBodyValid, isBodyValidError := VerifyBlockBody(bodyHex, blockBodyHashHex)
	if isBodyValidError != nil {
		return errors.New(fmt.Sprintf("VerifyBlock: VerifyBlockBody error, %v", isBodyValidError.Error())), false, "", 0, 0
	}
	isValid = isKesValid && isVrfValid && isBodyValid
	vrfHex = hex.EncodeToString(vrfBytes)
	blockNo := header.Body.BlockNumber
	slotNo := header.Body.Slot
	return nil, isValid, vrfHex, blockNo, slotNo
}

func ExtractBlockData(bodyHex string) ([]UTXOOutput, []RegisCert, []DeRegisCert, error) {
	rawDataBytes, rawDataBytesError := hex.DecodeString(bodyHex)
	if rawDataBytesError != nil {
		return nil, nil, nil, errors.New(fmt.Sprintf("ExtractBlockData: bodyHex decode error, %v", rawDataBytesError.Error()))
	}
	var txsRaw [][]string
	_, err := cbor.Decode(rawDataBytes, &txsRaw)
	if err != nil {
		return nil, nil, nil, errors.New(fmt.Sprintf("ExtractBlockData: txsRaw decode error, %v", err.Error()))
	}
	txBodies, txBodiesError := GetTxBodies(txsRaw)
	if err != nil {
		return nil, nil, nil, errors.New(fmt.Sprintf("ExtractBlockData: GetTxBodies error, %v", txBodiesError.Error()))
	}
	uTXOOutput, regisCerts, deRegisCerts, getBlockOutputError := GetBlockOutput(txBodies)
	if getBlockOutputError != nil {
		return nil, nil, nil, errors.New(fmt.Sprintf("ExtractBlockData: GetBlockOutput error, %v", getBlockOutputError.Error()))
	}
	return uTXOOutput, regisCerts, deRegisCerts, nil
}
