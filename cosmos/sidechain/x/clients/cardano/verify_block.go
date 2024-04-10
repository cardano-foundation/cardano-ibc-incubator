package cardano

import (
	"bytes"
	"encoding/hex"
	"fmt"

	"github.com/blinklabs-io/gouroboros/cbor"
	"github.com/blinklabs-io/gouroboros/ledger"
)

func VerifyBlock(block BlockHexCbor) (bool, string, uint64, uint64) {
	headerCborHex := block.HeaderCbor
	epochNonceHex := block.Eta0
	bodyHex := block.BlockBodyCbor
	slotPerKesPeriod := uint64(block.Spk)

	isValid := false
	vrfHex := ""

	// check is KES valid
	headerCborByte, _ := hex.DecodeString(headerCborHex)
	header, _ := ledger.NewBabbageBlockHeaderFromCbor(headerCborByte)
	isKesValid, errKes := VerifyKes(header, slotPerKesPeriod)
	if errKes != nil {
		return false, "", 0, 0
	}

	// check is VRF valid
	// Ref: https://github.com/IntersectMBO/ouroboros-consensus/blob/de74882102236fdc4dd25aaa2552e8b3e208448c/ouroboros-consensus-protocol/src/ouroboros-consensus-protocol/Ouroboros/Consensus/Protocol/Praos.hs#L541
	epochNonceByte, _ := hex.DecodeString(epochNonceHex)
	vrfBytes := header.Body.VrfKey[:]
	vrfResult := header.Body.VrfResult.([]interface{})
	vrfProofBytes := vrfResult[1].([]byte)
	vrfOutputBytes := vrfResult[0].([]byte)
	seed := MkInputVrf(int64(header.Body.Slot), epochNonceByte)
	output, errVrf := VrfVerifyAndHash(vrfBytes, vrfProofBytes, seed)
	if errVrf != nil {
		return false, "", 0, 0
	}
	isVrfValid := bytes.Equal(output, vrfOutputBytes)

	// check if block data valid
	blockBodyHash := header.Body.BlockBodyHash
	blockBodyHashHex := hex.EncodeToString(blockBodyHash[:])
	isBodyValid := VerifyBlockBody(bodyHex, blockBodyHashHex)

	isValid = isKesValid && isVrfValid && isBodyValid
	vrfHex = hex.EncodeToString(vrfBytes)
	blockNo := header.Body.BlockNumber
	slotNo := header.Body.Slot
	return isValid, vrfHex, blockNo, slotNo
}

func ExtractBlockData(bodyHex string) ([]UTXOOutput, []RegisCert, []DeRegisCert) {
	rawDataBytes, _ := hex.DecodeString(bodyHex)
	var txsRaw [][]string
	_, err := cbor.Decode(rawDataBytes, &txsRaw)
	if err != nil {
		fmt.Println(err)
	}
	txBodies := GetTxBodies(txsRaw)
	return GetBlockOutput(txBodies)
}
