package dbservice

import (
	"encoding/hex"
	"fmt"
	"strings"

	"github.com/cardano/relayer/v1/constant"
	"github.com/cardano/relayer/v1/package/dbservice/dto"
	ibc_types "github.com/cardano/relayer/v1/package/services/ibc-types"
	channeltypes "github.com/cosmos/ibc-go/v7/modules/core/04-channel/types"
	"gorm.io/gorm"
)

type DBService struct {
	DB *gorm.DB
}

func NewDBService() *DBService {
	return &DBService{
		DB: Connections[constant.CardanoDB],
	}
}

func (s *DBService) FindUtxosByPolicyIdAndPrefixTokenName(policyId string, prefixTokenName string) ([]dto.UtxoDto, error) {
	var result []dto.UtxoDto
	query := ` SELECT 
        tx_out.address AS address, 
        cast(generating_tx.hash as TEXT) AS tx_hash, 
        generating_tx.id AS tx_id,
        tx_out.index AS output_index, 
        datum.hash AS datum_hash, 
        CAST(datum.bytes as TEXT)  AS datum,
        ma.policy AS assets_policy, 
        CAST(ma.name AS TEXT) AS assets_name,
        generating_block.block_no AS block_no,
        generating_block.id AS block_id
      FROM tx_out
      INNER JOIN ma_tx_out mto on mto.tx_out_id = tx_out.id
      INNER JOIN multi_asset ma on mto.ident = ma.id 
      INNER JOIN datum AS datum on datum.id = tx_out.inline_datum_id
      INNER JOIN tx AS generating_tx on generating_tx.id = tx_out.tx_id
      INNER JOIN block AS generating_block on generating_block.id = generating_tx.block_id
      WHERE ma.policy = ? AND position(?::bytea in ma.name) > 0
      ORDER BY block_no DESC;`
	err := s.DB.Raw(query, fmt.Sprintf("\\x%s", policyId), fmt.Sprintf("\\x%s", prefixTokenName)).Scan(&result).Error
	if err != nil {
		return nil, err
	}
	return result, nil

}

func (s *DBService) FindUtxoByPolicyAndTokenNameAndState(policyId string, tokenName string, state string, mintConnScriptHash string, minChannelScriptHash string) (*dto.UtxoDto, error) {
	var result []dto.UtxoDto
	query := ` SELECT 
      tx_out.address AS address, 
      CAST(generating_tx.hash as TEXT) AS tx_hash, 
      tx_out.index AS output_index, 
      datum.hash AS datum_hash, 
      CAST(datum.bytes as TEXT) AS datum,
      CAST(ma.policy AS TEXT) AS assets_policy, 
      ma.name AS assets_name,
      generating_block.block_no AS block_no,
      tx_out.index AS index
    FROM tx_out
    INNER JOIN ma_tx_out mto on mto.tx_out_id = tx_out.id
    INNER JOIN multi_asset ma on mto.ident = ma.id 
    INNER JOIN datum AS datum on datum.id = tx_out.inline_datum_id
    INNER JOIN tx AS generating_tx on generating_tx.id = tx_out.tx_id
    INNER JOIN block AS generating_block on generating_block.id = generating_tx.block_id
    WHERE ma.policy = ? AND position(?::bytea in ma.name) > 0
    ORDER BY block_no DESC;`
	err := s.DB.Raw(query, fmt.Sprintf("\\x%s", policyId), fmt.Sprintf("\\x%s", tokenName)).Scan(&result).Error
	if err != nil {
		return nil, err
	}
	proofs := []dto.UtxoDto{}
	for _, utxo := range result {
		dataString := *utxo.Datum
		switch utxo.AssetsPolicy[2:] {
		case mintConnScriptHash:
			datumDecoded, err := ibc_types.DecodeConnectionDatumSchema(dataString[2:])
			if err != nil {
				return nil, err
			}
			stateNum := int32(datumDecoded.State.State)
			if channeltypes.State_name[stateNum] == state {
				proofs = append(proofs, utxo)
			}
			break
		case minChannelScriptHash:
			datumDecoded, err := ibc_types.DecodeChannelDatumSchema(dataString[2:])
			if err != nil {
				return nil, err
			}
			stateNum := int32(datumDecoded.State.Channel.State)
			if channeltypes.State_name[stateNum] == state {
				proofs = append(proofs, utxo)
			}
			break
		}
	}
	if len(proofs) == 0 {
		return nil, nil
	}
	return &proofs[0], nil
}

func (s *DBService) QueryConnectionAndChannelUTxOs(cardanoHeights []uint64, mintConnScriptHash string, mintChannelScriptHash string) ([]dto.UtxoDto, error) {
	utxos := make([]dto.UtxoDto, 0)
	var utxostest []dto.UtxoRawDto
	rawQuery := `SELECT
        tx_out.address AS address, 
        generating_tx.hash AS tx_hash,
        generating_tx.id AS tx_id,
        tx_out.index AS output_index, 
        datum.hash AS datum_hash, 
        datum.bytes AS datum,
        ma.policy AS assets_policy, 
        ma.name AS assets_name
      FROM tx_out
      INNER JOIN ma_tx_out mto on mto.tx_out_id = tx_out.id
      INNER JOIN multi_asset ma on mto.ident = ma.id 
      INNER JOIN datum AS datum on datum.id = tx_out.inline_datum_id
      INNER JOIN tx AS generating_tx on generating_tx.id = tx_out.tx_id
      INNER JOIN block AS generating_block on generating_block.id = generating_tx.block_id
      WHERE generating_block.block_no in (?) AND (position(?::bytea in ma.policy) > 0 or position(?::bytea in ma.policy) > 0 );`
	err := s.DB.Raw(rawQuery, cardanoHeights, fmt.Sprintf("\\x%s", mintConnScriptHash), fmt.Sprintf("\\x%s", mintChannelScriptHash)).Scan(&utxostest).Error
	if err != nil {
		return nil, err
	}

	for _, utxo := range utxostest {
		datumHash := hex.EncodeToString(utxo.DatumHash)
		datum := hex.EncodeToString(utxo.Datum)
		utxos = append(utxos, dto.UtxoDto{
			TxHash:       hex.EncodeToString(utxo.TxHash),
			TxId:         utxo.TxId,
			OutputIndex:  utxo.OutputIndex,
			Address:      utxo.Address,
			AssetsPolicy: hex.EncodeToString(utxo.AssetsPolicy),
			AssetsName:   hex.EncodeToString(utxo.AssetsName),
			DatumHash:    &datumHash,
			Datum:        &datum,
			BlockNo:      utxo.BlockNo,
			BlockId:      utxo.BlockId,
			Index:        utxo.Index,
		})
	}

	return utxos, nil
}

func (s *DBService) QueryRedeemersByTransactionId(txId uint64, mintScriptHash string, spendAddress string) ([]dto.RedeemerDto, error) {
	rawQuery := `
    SELECT distinct rd_data.bytes as data, rd.purpose as type
    FROM redeemer rd
    INNER JOIN redeemer_data as rd_data on rd.redeemer_data_id = rd_data.id
    LEFT JOIN tx_in generating_tx_in on generating_tx_in.redeemer_id = rd.id
    LEFT JOIN tx_out generating_tx_out on generating_tx_in.tx_out_id = generating_tx_out.tx_id and generating_tx_out."index" = generating_tx_in.tx_out_index
    WHERE rd.tx_id = ? AND (rd.script_hash = ? OR generating_tx_out.address = ?)`

	var redeemers []dto.RedeemerDto
	err := s.DB.Raw(rawQuery, txId, fmt.Sprintf("\\x%s", mintScriptHash), spendAddress).Scan(&redeemers).Error
	if err != nil {
		return nil, err
	}

	return redeemers, nil
}

func (s *DBService) QueryClientOrAuthHandlerUTxOsByHeight(policyId string, scHash string, clientTokenName string, height uint64) ([]dto.UtxoRawDto, error) {
	var data []dto.UtxoRawDto
	query := `SELECT 
        tx_out.address AS address, 
        generating_tx.hash AS tx_hash, 
        generating_tx.id AS tx_id, 
        tx_out.index AS output_index, 
        datum.hash AS datum_hash, 
       	datum.bytes AS datum,
        ma.policy  AS assets_policy, 
        ma.name AS assets_name,
        generating_block.block_no AS block_no,
        tx_out.index AS index
      FROM tx_out
      INNER JOIN ma_tx_out mto on mto.tx_out_id = tx_out.id
      INNER JOIN multi_asset ma on mto.ident = ma.id 
      INNER JOIN datum AS datum on datum.id = tx_out.inline_datum_id
      INNER JOIN tx AS generating_tx on generating_tx.id = tx_out.tx_id
      INNER JOIN block AS generating_block on generating_block.id = generating_tx.block_id
      WHERE generating_block.block_no = ? AND (ma.policy = ? OR ma.policy = ?);`
	err := s.DB.Raw(query, height, fmt.Sprintf("\\x%s", policyId), fmt.Sprintf("\\x%s", scHash)).Scan(&data).Error
	if err != nil {
		return nil, err
	}
	var result []dto.UtxoRawDto
	for _, utxo := range data {
		if strings.ToLower(policyId) == strings.ToLower(hex.EncodeToString(utxo.AssetsPolicy)) {
			result = append(result, utxo)
		} else if strings.ToLower(scHash) == strings.ToLower(hex.EncodeToString(utxo.AssetsPolicy)) && strings.HasPrefix(strings.ToLower(hex.EncodeToString(utxo.AssetsName)), strings.ToLower(clientTokenName)) {
			result = append(result, utxo)
		}
	}
	return result, nil
}

func (s *DBService) QueryClientOrAuthHandlerUTxOs(policyId string, scHash string, clientTokenName string) ([]dto.UtxoRawDto, error) {
	var data []dto.UtxoRawDto
	query := `SELECT 
        tx_out.address AS address, 
        generating_tx.hash AS tx_hash, 
        generating_tx.id AS tx_id, 
        tx_out.index AS output_index, 
        datum.hash AS datum_hash, 
       	datum.bytes AS datum,
        ma.policy  AS assets_policy, 
        ma.name AS assets_name,
        generating_block.block_no AS block_no,
        tx_out.index AS index
      FROM tx_out
      INNER JOIN ma_tx_out mto on mto.tx_out_id = tx_out.id
      INNER JOIN multi_asset ma on mto.ident = ma.id 
      INNER JOIN datum AS datum on datum.id = tx_out.inline_datum_id
      INNER JOIN tx AS generating_tx on generating_tx.id = tx_out.tx_id
      INNER JOIN block AS generating_block on generating_block.id = generating_tx.block_id
      WHERE  (ma.policy = ? OR ma.policy = ?);`
	err := s.DB.Raw(query, fmt.Sprintf("\\x%s", policyId), fmt.Sprintf("\\x%s", scHash)).Scan(&data).Error
	if err != nil {
		return nil, err
	}
	var result []dto.UtxoRawDto
	for _, utxo := range data {
		if strings.ToLower(policyId) == strings.ToLower(hex.EncodeToString(utxo.AssetsPolicy)) {
			result = append(result, utxo)
		} else if strings.ToLower(scHash) == strings.ToLower(hex.EncodeToString(utxo.AssetsPolicy)) && strings.HasPrefix(strings.ToLower(hex.EncodeToString(utxo.AssetsName)), strings.ToLower(clientTokenName)) {
			result = append(result, utxo)
		}
	}
	return result, nil
}

func (s *DBService) FindHeightByTxHash(txHash string) (uint64, error) {
	var height uint64
	query := ` SELECT
        generating_block.block_no AS height
      FROM tx AS generating_tx
      INNER JOIN block AS generating_block on generating_block.id = generating_tx.block_id
      WHERE generating_tx.hash = ?;`
	err := s.DB.Raw(query, txHash).Scan(&height).Error
	if err != nil {
		return 0, err
	}
	return height, nil
}
