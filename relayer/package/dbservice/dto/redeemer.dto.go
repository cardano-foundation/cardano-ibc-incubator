package dto

type RedeemerDto struct {
	RedeemerType string `json:"tx_hash"`
	Data         string `json:"data"`
}
