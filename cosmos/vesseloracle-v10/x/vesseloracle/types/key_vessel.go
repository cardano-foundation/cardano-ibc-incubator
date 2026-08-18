package types

import "encoding/binary"

var _ binary.ByteOrder

const (
	// VesselKeyPrefix is the prefix to retrieve all Vessel
	VesselKeyPrefix = "Vessel/value/"
)

// VesselKey returns the store key to retrieve a Vessel from the index fields
func VesselKey(
	imo string,
	ts uint64,
	source string,
) []byte {
	var key []byte

	imoBytes := []byte(imo)
	key = append(key, imoBytes...)
	key = append(key, []byte("/")...)

	tsBytes := make([]byte, 8)
	binary.BigEndian.PutUint64(tsBytes, ts)
	key = append(key, tsBytes...)
	key = append(key, []byte("/")...)

	sourceBytes := []byte(source)
	key = append(key, sourceBytes...)
	key = append(key, []byte("/")...)

	return key
}
