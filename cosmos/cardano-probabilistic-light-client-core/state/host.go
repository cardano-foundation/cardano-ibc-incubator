package state

import (
	"encoding/binary"
	"fmt"
	"strconv"
	"strings"
	"time"
)

// Context contains only the host values used by the state machine. SelfHeight
// retains the host chain revision for processed metadata.
type Context struct {
	Time       time.Time
	Height     int64
	SelfHeight HostHeight
}

func (c Context) BlockTime() time.Time              { return c.Time }
func (c Context) BlockHeight() int64                { return c.Height }
func (c Context) WithBlockTime(t time.Time) Context { c.Time = t; return c }
func (c Context) WithBlockHeight(h int64) Context {
	c.Height = h
	c.SelfHeight.RevisionHeight = uint64(h)
	return c
}

// StateCodec keeps version-specific protobuf Any registration out of the engine.
// Encoders and DecodeClient follow the host's MustMarshal/MustUnmarshal contract.
type StateCodec interface {
	EncodeClient(*ClientState) []byte
	DecodeClient([]byte) *ClientState
	EncodeConsensus(*ConsensusState) []byte
	DecodeConsensus([]byte) (*ConsensusState, error)
}

func mustDecodeConsensus(cdc StateCodec, data []byte) *ConsensusState {
	state, err := cdc.DecodeConsensus(data)
	if err != nil {
		panic(err)
	}
	return state
}

type Status string

const (
	Active  Status = "Active"
	Frozen  Status = "Frozen"
	Expired Status = "Expired"
)

// HeightValue accepts both Cardano heights and host revision heights.
type HeightValue interface {
	GetRevisionNumber() uint64
	GetRevisionHeight() uint64
	String() string
}

type HostHeight struct{ RevisionNumber, RevisionHeight uint64 }

func NewHostHeight(revision, height uint64) HostHeight { return HostHeight{revision, height} }
func (h HostHeight) GetRevisionNumber() uint64         { return h.RevisionNumber }
func (h HostHeight) GetRevisionHeight() uint64         { return h.RevisionHeight }
func (h HostHeight) String() string                    { return fmt.Sprintf("%d-%d", h.RevisionNumber, h.RevisionHeight) }
func parseHostHeight(s string) (HostHeight, error) {
	parts := strings.Split(s, "-")
	if len(parts) != 2 {
		return HostHeight{}, fmt.Errorf("invalid height: %s", s)
	}
	revision, err := strconv.ParseUint(parts[0], 10, 64)
	if err != nil {
		return HostHeight{}, err
	}
	height, err := strconv.ParseUint(parts[1], 10, 64)
	return NewHostHeight(revision, height), err
}

type Metadata struct{ Key, Value []byte }

func newMetadata(key, value []byte) Metadata { return Metadata{key, value} }
func (m Metadata) GetKey() []byte            { return m.Key }
func (m Metadata) GetValue() []byte          { return m.Value }
func uint64ToBigEndian(value uint64) []byte {
	data := make([]byte, 8)
	binary.BigEndian.PutUint64(data, value)
	return data
}
