package mithril

import (
	"fmt"
)

const (
	// ModuleName is the IBC client type for the Cosmos-side Cardano light client.
	//
	// We intentionally use the conventional `{two-digit-ics}-{name}` form used by
	// ibc-go (e.g. `07-tendermint`, `06-solomachine`) so client identifiers look
	// like `08-cardano-0`.
	//
	// Note: this string is independent from the protobuf type URLs for the client
	// state / header, which remain under `ibc.clients.mithril.v1.*`.
	ModuleName                           = "08-cardano"
	KeyFirstCertificateInEpochPrefix     = "fcInEpoch"
	KeyFirstCertificateMsdInEpochPrefix  = "fcMsdInEpoch"
	KeyFirstCertificateTsInEpochPrefix   = "fcTsInEpoch"
	KeyLatestCertificateMsdInEpochPrefix = "LcMsdInEpoch"
	KeyLatestCertificateTsInEpochPrefix  = "LcTsInEpoch"
	KeyMSDCertificateHashPrefix          = "MSDCertificateHash"
)

func FcInEpochKey(epoch uint64) []byte {
	return []byte(FcInEpochPath(epoch))
}

func FcInEpochPath(epoch uint64) string {
	return fmt.Sprintf("%s/%v", KeyFirstCertificateInEpochPrefix, epoch)
}

func MSDCertificateHashKey(hash string) []byte {
	return []byte(MSDCertificateHashPath(hash))
}

func MSDCertificateHashPath(hash string) string {
	return fmt.Sprintf("%s/%s", KeyMSDCertificateHashPrefix, hash)
}

func FcMsdInEpochKey(epoch uint64) []byte {
	return []byte(FcMsdInEpochPath(epoch))
}

func FcMsdInEpochPath(epoch uint64) string {
	return fmt.Sprintf("%s/%v", KeyFirstCertificateMsdInEpochPrefix, epoch)
}

func FcTsInEpochKey(epoch uint64) []byte {
	return []byte(FcTsInEpochPath(epoch))
}

func FcTsInEpochPath(epoch uint64) string {
	return fmt.Sprintf("%s/%v", KeyFirstCertificateTsInEpochPrefix, epoch)
}

func LcMsdInEpochKey(epoch uint64) []byte {
	return []byte(LcMsdInEpochPath(epoch))
}

func LcMsdInEpochPath(epoch uint64) string {
	return fmt.Sprintf("%s/%v", KeyLatestCertificateMsdInEpochPrefix, epoch)
}

func LcTsInEpochKey(epoch uint64) []byte {
	return []byte(LcTsInEpochPath(epoch))
}

func LcTsInEpochPath(epoch uint64) string {
	return fmt.Sprintf("%s/%v", KeyLatestCertificateTsInEpochPrefix, epoch)
}
