package dbservice

import (
	"fmt"
	"github.com/cardano/relayer/v1/constant"
	"github.com/cardano/relayer/v1/package/dbservice/dto"
	ibc_types "github.com/cardano/relayer/v1/package/services/ibc-types"
	channeltypes "github.com/cosmos/ibc-go/v7/modules/core/04-channel/types"
	"github.com/fxamacker/cbor/v2"
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
        generating_tx.hash AS tx_hash, 
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
    WHERE ma.policy = ? AND ma.name = ?
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
			stateNum, ok := datumDecoded.State.State.(cbor.Tag)
			if !ok {
				return nil, fmt.Errorf("state is not cbor tag")
			}
			if channeltypes.State_name[int32(stateNum.Number-constant.CBOR_TAG_MAGIC_NUMBER)] == state {
				proofs = append(proofs, utxo)
			}
			break
		case minChannelScriptHash:
			datumDecoded, err := ibc_types.DecodeChannelDatumWithPort(dataString[2:])
			if err != nil {
				return nil, err
			}
			stateNum, ok := datumDecoded.State.Channel.State.(cbor.Tag)
			if !ok {
				return nil, fmt.Errorf("state is not cbor tag")
			}
			if channeltypes.State_name[int32(stateNum.Number-constant.CBOR_TAG_MAGIC_NUMBER)] == state {
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
