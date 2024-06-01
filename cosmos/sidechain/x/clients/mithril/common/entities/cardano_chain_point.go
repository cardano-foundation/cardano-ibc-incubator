package entities

type SlotNumber = uint64

type BlockNumber = uint64

type BlockHash = string

type ChainPoint struct {
	SlotNumber  SlotNumber
	BlockNumber BlockNumber
	BlockHash   BlockHash
}
