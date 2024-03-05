package cardano

type BlockHexCbor struct {
	_             struct{} `cbor:",toarray"`
	Flag          int
	HeaderCbor    string
	Eta0          string
	Spk           int
	BlockBodyCbor string
}

type UTXOOutputToken struct {
	_              struct{} `cbor:",toarray"`
	Flag           int
	TokenAssetName string
	TokenValue     string
}
type UTXOOutput struct {
	_           struct{} `cbor:",toarray"`
	Flag        int
	TxHash      string
	OutputIndex string
	Tokens      []UTXOOutputToken
	DatumHex    string
}

type RegisCert struct {
	_            struct{} `cbor:",toarray"`
	Flag         int
	RegisPoolId  string
	RegisPoolVrf string
}

type DeRegisCert struct {
	_             struct{} `cbor:",toarray"`
	Flag          int
	DeRegisPoolId string
	DeRegisEpoch  string
}

type VerifyBlockOutput struct {
	_             struct{} `cbor:",toarray"`
	Flag          int
	IsValid       bool
	VrfKHexString string
}

type ExtractBlockOutput struct {
	_            struct{} `cbor:",toarray"`
	Flag         int
	Outputs      []UTXOOutput
	RegisCerts   []RegisCert
	DeRegisCerts []DeRegisCert
}
