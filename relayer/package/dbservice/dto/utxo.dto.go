package dto

type UtxoDto struct {
	TxHash       string  `json:"tx_hash"`
	TxId         int     `json:"tx_id"`
	OutputIndex  int     `json:"output_index"`
	Address      string  `json:"address"`
	AssetsPolicy string  `json:"assets_policy"`
	AssetsName   string  `json:"assets_name"`
	DatumHash    *string `json:"datum_hash"`
	Datum        *string `json:"datum"`
	BlockNo      int     `json:"block_no"`
	BlockId      int     `json:"block_id"`
	Index        int     `json:"index"`
}
