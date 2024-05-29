package entities

import (
	"encoding/binary"
	"hash"
)

type SignedEntityType struct {
	MithrilStakeDistribution  *MithrilStakeDistribution
	CardanoStakeDistribution  *CardanoStakeDistribution
	CardanoImmutableFilesFull *CardanoImmutableFilesFull
	CardanoTransactions       *CardanoTransactions
}

type MithrilStakeDistribution struct {
	Epoch
}

type CardanoStakeDistribution struct {
	Epoch
}

type CardanoImmutableFilesFull struct {
	*CardanoDbBeacon
}

type CardanoTransactions struct {
	*CardanoDbBeacon
}

func (s *SignedEntityType) FeedHash(hasher hash.Hash) {
	if s.MithrilStakeDistribution != nil {
		s.MithrilStakeDistribution.FeedHash(hasher)
		return
	}
	if s.CardanoStakeDistribution != nil {
		s.CardanoStakeDistribution.FeedHash(hasher)
		return
	}
	if s.CardanoImmutableFilesFull != nil {
		s.CardanoImmutableFilesFull.FeedHash(hasher)
		return
	}
	if s.CardanoTransactions != nil {
		s.CardanoTransactions.FeedHash(hasher)
		return
	}
}

func (msd *MithrilStakeDistribution) FeedHash(hasher hash.Hash) {
	epochBytes := make([]byte, 8)
	binary.BigEndian.PutUint64(epochBytes, uint64(msd.Epoch))
	hasher.Write(epochBytes)
}

func (csd *CardanoStakeDistribution) FeedHash(hasher hash.Hash) {
	epochBytes := make([]byte, 8)
	binary.BigEndian.PutUint64(epochBytes, uint64(csd.Epoch))
	hasher.Write(epochBytes)
}

func (ciff *CardanoImmutableFilesFull) FeedHash(hasher hash.Hash) {
	hasher.Write([]byte(ciff.CardanoDbBeacon.Network))
	epochBytes := make([]byte, 8)
	binary.BigEndian.PutUint64(epochBytes, uint64(ciff.CardanoDbBeacon.Epoch))
	hasher.Write(epochBytes)
	fileNumberBytes := make([]byte, 8)
	binary.BigEndian.PutUint64(fileNumberBytes, ciff.CardanoDbBeacon.ImmutableFileNumber)
	hasher.Write(fileNumberBytes)
}

func (ct *CardanoTransactions) FeedHash(hasher hash.Hash) {
	hasher.Write([]byte(ct.CardanoDbBeacon.Network))
	epochBytes := make([]byte, 8)
	binary.BigEndian.PutUint64(epochBytes, uint64(ct.CardanoDbBeacon.Epoch))
	hasher.Write(epochBytes)
	fileNumberBytes := make([]byte, 8)
	binary.BigEndian.PutUint64(fileNumberBytes, uint64(ct.CardanoDbBeacon.ImmutableFileNumber))
	hasher.Write(fileNumberBytes)
}
