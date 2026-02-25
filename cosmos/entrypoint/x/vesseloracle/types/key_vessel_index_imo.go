package types

import "encoding/binary"

var _ binary.ByteOrder

const (
	// VesselIndexImoKeyPrefix is the prefix to retrieve all VesselIndexImo
	VesselIndexImoKeyPrefix = "VesselIndexImo/value/"
)

// VesselKey returns the store key to retrieve a Vessel from the index fields
func VesselIndexImoKey(
	imo string,
) []byte {
	var key []byte

	imoBytes := []byte(imo)
	key = append(key, imoBytes...)
	key = append(key, []byte("/")...)

	return key
}
