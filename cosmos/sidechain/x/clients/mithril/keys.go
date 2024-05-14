package mithril

import (
	"fmt"
)

const (
	ModuleName                           = "2000-cardano-mithril"
	KeyFirstCertificateMsdInEpochPrefix  = "fcMsdInEpoch"
	KeyFirstCertificateTsInEpochPrefix   = "fcTsInEpoch"
	KeyLatestCertificateMsdInEpochPrefix = "LcMsdInEpoch"
	KeyLatestCertificateTsInEpochPrefix  = "LcTsInEpoch"
)

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
