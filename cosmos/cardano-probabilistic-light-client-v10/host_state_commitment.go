package probabilistic

func (cs ClientState) ExtractIbcStateRootFromHostStateTx(header *ProbabilisticHeader) ([]byte, error) {
	return toCoreClientState(&cs).ExtractIbcStateRootFromHostStateTx(toCoreProbabilisticHeader(header))
}
