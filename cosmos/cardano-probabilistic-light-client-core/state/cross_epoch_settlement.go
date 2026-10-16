package state

// Descendants can confirm an anchor across one boundary. Accounting snapshots
// and qualification still belong to the anchor, never the temporary tip.
func settlementEvidenceEpoch(header *authenticatedProbabilisticHeader) uint64 {
	epoch := header.anchorBlock.epoch
	for _, block := range header.descendantBlocks {
		if block != nil && block.epoch > epoch {
			epoch = block.epoch
		}
	}
	return epoch
}

func (cs ClientState) retainProposedEpochs(contexts []*EpochContext, keep map[uint64]struct{}) {
	for _, context := range contexts {
		if context != nil && context.Epoch > cs.CurrentEpoch && cs.epochChallenge(context.Epoch) != nil {
			keep[context.Epoch] = struct{}{}
		}
	}
}
