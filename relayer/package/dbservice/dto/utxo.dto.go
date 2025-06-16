package dto

type UtxoDto struct {
	TxHash       string  `json:"tx_hash"`
	TxId         uint64  `json:"tx_id"`
	OutputIndex  uint64  `json:"output_index"`
	Address      string  `json:"address"`
	AssetsPolicy string  `json:"assets_policy"`
	AssetsName   string  `json:"assets_name"`
	DatumHash    *string `json:"datum_hash"`
	Datum        *string `json:"datum"`
	BlockNo      uint64  `json:"block_no"`
	BlockId      uint64  `json:"block_id"`
	Index        uint64  `json:"index"`
}

type UtxoRawDto struct {
	TxHash       []byte `json:"tx_hash"`
	TxId         uint64 `json:"tx_id"`
	OutputIndex  uint64 `json:"output_index"`
	Address      string `json:"address"`
	AssetsPolicy []byte `json:"assets_policy"`
	AssetsName   []byte `json:"assets_name"`
	DatumHash    []byte `json:"datum_hash"`
	Datum        []byte `json:"datum"`
	BlockNo      uint64 `json:"block_no"`
	BlockId      uint64 `json:"block_id"`
	Index        uint64 `json:"index"`
}
