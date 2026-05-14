package types

import "encoding/binary"

var _ binary.ByteOrder

const (
	// ConsolidatedDataReportKeyPrefix is the prefix to retrieve all ConsolidatedDataReport
	ConsolidatedDataReportKeyPrefix = "ConsolidatedDataReport/value/"
)

// ConsolidatedDataReportKey returns the store key to retrieve a ConsolidatedDataReport from the index fields
func ConsolidatedDataReportKey(
	imo string,
	ts uint64,
) []byte {
	var key []byte

	imoBytes := []byte(imo)
	key = append(key, imoBytes...)
	key = append(key, []byte("/")...)

	tsBytes := make([]byte, 8)
	binary.BigEndian.PutUint64(tsBytes, ts)
	key = append(key, tsBytes...)
	key = append(key, []byte("/")...)

	return key
}
