package state

import (
	"time"

	errorsmod "cosmossdk.io/errors"
)

// Settlement requires registration strictly before six calendar months prior to
// the authenticated anchor. Subtract months in UTC and clamp the day to the last
// day of the target month. Keep the time of day and nanoseconds unchanged.
// Using the anchor slot makes replay and historical challenges independent of
// host time, the latest checkpoint and temporary settlement descendants.
func (cs *ClientState) poolRegistrationCutoffSlotExclusive(anchorSlot uint64) (uint64, error) {
	if cs == nil {
		return 0, errorsmod.Wrap(ErrInvalidTimestamp, "client state missing")
	}
	anchorTimestamp, err := cs.DeriveTimestampFromSlot(anchorSlot)
	if err != nil {
		return 0, err
	}
	// Split seconds and nanoseconds rather than casting a uint64 Unix timestamp
	// to int64. Client timestamps also represent dates after UnixNano's range.
	anchor := time.Unix(int64(anchorTimestamp/1_000_000_000), int64(anchorTimestamp%1_000_000_000)).UTC()
	year, month, day := anchor.Date()
	month -= 6
	if month < time.January {
		year--
		month += 12
	}
	lastDay := time.Date(year, month+1, 0, 0, 0, 0, 0, time.UTC).Day()
	if day > lastDay {
		day = lastDay
	}
	cutoff := time.Date(year, month, day, anchor.Hour(), anchor.Minute(), anchor.Second(), anchor.Nanosecond(), time.UTC)
	if cutoff.Unix() < 0 {
		return 0, nil
	}
	cutoffTimestamp := uint64(cutoff.Unix())*1_000_000_000 + uint64(cutoff.Nanosecond())
	if cutoffTimestamp <= cs.SystemStartUnixNs {
		return 0, nil
	}
	delta := cutoffTimestamp - cs.SystemStartUnixNs
	// Round up without an overflowing delta + slot length intermediate. The
	// strict comparison excludes a registration exactly at the cutoff.
	cutoffSlot := delta / cs.SlotLengthNs
	if delta%cs.SlotLengthNs != 0 {
		cutoffSlot++
	}
	return cutoffSlot, nil
}
