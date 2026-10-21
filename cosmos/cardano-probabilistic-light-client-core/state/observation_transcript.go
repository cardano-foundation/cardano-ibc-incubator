package state

import (
	"crypto/sha256"
	"fmt"
)

func observationTranscriptEnd(base []byte) [32]byte {
	return sha256.Sum256(append([]byte("cardano-ibc.observation-segments/v2\x00"), base...))
}

// A suffix commitment authenticates every row or block before any of this
// segment's state is saved. Any account may relay the committed segment.
func observationSegmentCommitment(chunk *ObservationChunk, anchor uint64) ([32]byte, error) {
	if len(chunk.EvidenceDigest) != 32 {
		return [32]byte{}, fmt.Errorf("appended evidence requires its committed transcript suffix")
	}
	digest := [32]byte(chunk.EvidenceDigest)
	switch chunk.Operation {
	case ObservationAppendStake:
		if len(chunk.StakeRows) == 0 || len(chunk.StakeRows)%36 != 0 {
			return [32]byte{}, fmt.Errorf("invalid stake row segment")
		}
		for i := len(chunk.StakeRows) - 36; i >= 0; i -= 36 {
			digest = sha256.Sum256(append(digest[:], chunk.StakeRows[i:i+36]...))
		}
	case ObservationAppendBlocks:
		if len(chunk.Blocks) == 0 {
			return [32]byte{}, fmt.Errorf("empty block segment")
		}
		for i := len(chunk.Blocks) - 1; i >= 0; i-- {
			var err error
			digest, err = observationBlockDigest(digest, chunk.Blocks[i], anchor)
			if err != nil {
				return [32]byte{}, err
			}
		}
	default:
		return [32]byte{}, fmt.Errorf("operation does not append evidence")
	}
	return digest, nil
}
