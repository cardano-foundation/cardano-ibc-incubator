package cryptohelpers

type MKMapProof struct {
	MasterProof *MKProof
	SubProofs   []*struct {
		*BlockRange
		*MKMapProof
	}
}
