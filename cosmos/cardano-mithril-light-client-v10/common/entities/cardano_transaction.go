package entities

type TransactionHash = string

type CardanoTransaction struct {
	TransactionHash     TransactionHash
	BlockNumber         BlockNumber
	SlotNumber          SlotNumber
	BlockHash           BlockHash
	ImmutableFileNumber ImmutableFileNumber
}
