package cryptohelpers

type Range struct {
	Start uint64
	End   uint64
}

type BlockRange struct {
	InnerRange *Range
}
