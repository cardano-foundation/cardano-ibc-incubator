package entities

import (
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
)

type ProtocolParameters struct {
	K    uint64
	M    uint64
	PhiF float64
}

type U8F24 uint32

func fromFloat64(f float64) U8F24 {
	return U8F24(f * (1 << 24))
}

func (u U8F24) toBytes() []byte {
	b := make([]byte, 4)
	binary.BigEndian.PutUint32(b, uint32(u))
	return b
}

func (p *ProtocolParameters) PhiFFixed() U8F24 {
	return fromFloat64(p.PhiF)
}

func (p *ProtocolParameters) ComputeHash() string {
	hasher := sha256.New()
	kBytes := make([]byte, 8)
	mBytes := make([]byte, 8)
	binary.BigEndian.PutUint64(kBytes, p.K)
	binary.BigEndian.PutUint64(mBytes, p.M)
	hasher.Write(kBytes)
	hasher.Write(mBytes)
	hasher.Write(p.PhiFFixed().toBytes())
	return hex.EncodeToString(hasher.Sum(nil))
}
