package probabilisticcore

import (
	"encoding/hex"
	"fmt"
	"strings"

	"github.com/blinklabs-io/gouroboros/cbor"
	"github.com/blinklabs-io/gouroboros/ledger"
)

func DecodeLedgerBlock(blockCbor []byte) (ledger.Block, error) {
	blockType, err := ledger.DetermineBlockType(blockCbor)
	if err != nil {
		return nil, err
	}
	return ledger.NewBlockFromCbor(blockType, blockCbor)
}

func BlockPrevHash(decodedBlock ledger.Block) (string, error) {
	switch block := decodedBlock.(type) {
	case *ledger.BabbageBlock:
		return block.Header.Body.PrevHash.String(), nil
	case *ledger.ConwayBlock:
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
	default:
		return "", "", nil, fmt.Errorf("unsupported block era %T", decodedBlock)
	}
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
			auxHex = hex.EncodeToString(transactionMetadataSet[uint(idx)].Cbor())
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
