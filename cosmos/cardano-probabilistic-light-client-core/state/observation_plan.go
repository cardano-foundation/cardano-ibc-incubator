package state

import (
	"bytes"
	"crypto/sha256"
	"encoding/binary"
	"fmt"
	"sort"

	"github.com/blinklabs-io/gouroboros/cbor"
	core "github.com/cardano-foundation/cardano-ibc-incubator/cosmos/cardano-probabilistic-light-client-core"
)

// ObservationPlan is a transport plan. None of its claims become authoritative
// until the destination has checked every step and completed verification.
type ObservationPlan struct {
	SessionID [32]byte
	Steps     []*ProbabilisticHeader
}

func BuildObservationPlan(cs *ClientState, header *ProbabilisticHeader, originalReceipt []byte, priorTableRows uint64, blocksPerStep int) (*ObservationPlan, error) {
	if cs.StorageVersion != StorageVersionSharedSnapshots || header == nil || header.AnchorBlock == nil || blocksPerStep < 1 || blocksPerStep > maxObservationBlocksPerStep {
		return nil, fmt.Errorf("invalid staged observation plan inputs")
	}
	begin := &ObservationChunk{Operation: ObservationBegin, BaseCheckpointReference: bytes.Clone(cs.CheckpointReference), OriginalReceipt: bytes.Clone(originalReceipt), AnchorHeight: header.AnchorBlock.Height.RevisionHeight, BlockCount: uint32(len(header.BridgeBlocks) + 1 + len(header.DescendantBlocks)), IsCheckpoint: header.IsCheckpoint, HostStateTxHash: header.HostStateTxHash}
	tableDigest := sha256.Sum256([]byte("cardano-ibc.stake-table/v2\x00"))
	var rows []byte
	if header.NewEpochContext != nil && header.NewEpochContext.Epoch > cs.CurrentEpoch {
		context := *header.NewEpochContext
		context.StakeDistribution = nil
		begin.TableContext = &context
		entries := append([]*StakeDistributionEntry(nil), header.NewEpochContext.StakeDistribution...)
		keys := make(map[string][]byte, len(entries))
		for _, entry := range entries {
			key, err := poolKey(entry.PoolId)
			if err != nil {
				return nil, err
			}
			keys[entry.PoolId] = key
		}
		sort.Slice(entries, func(i, j int) bool { return bytes.Compare(keys[entries[i].PoolId], keys[entries[j].PoolId]) < 0 })
		for _, entry := range entries {
			row := binary.BigEndian.AppendUint64(bytes.Clone(keys[entry.PoolId]), entry.Stake)
			var ok bool
			begin.TableTotal, ok = checkedAddStake(begin.TableTotal, entry.Stake)
			if !ok {
				return nil, fmt.Errorf("table total overflow")
			}
			rows = append(rows, row...)
			tableDigest = sha256.Sum256(append(tableDigest[:], row...))
		}
		begin.TableRows = uint32(len(entries))
		begin.TableDigest = bytes.Clone(tableDigest[:])
	}
	blocks := append([]*ProbabilisticBlock(nil), header.BridgeBlocks...)
	blocks = append(blocks, header.AnchorBlock)
	for _, block := range header.DescendantBlocks {
		normalized := *block
		if len(block.BlockCbor) > 0 {
			var fields []cbor.RawMessage
			if _, err := cbor.Decode(block.BlockCbor, &fields); err != nil || len(fields) == 0 {
				return nil, fmt.Errorf("invalid descendant block")
			}
			normalized.BlockCbor = nil
			normalized.HeaderCbor = bytes.Clone(fields[0])
		}
		blocks = append(blocks, &normalized)
	}
	blockSuffixes := make([][32]byte, len(blocks)+1)
	blockSuffixes[len(blocks)] = observationTranscriptEnd(cs.CheckpointReference)
	for i := len(blocks) - 1; i >= 0; i-- {
		var err error
		blockSuffixes[i], err = observationBlockDigest(blockSuffixes[i+1], blocks[i], begin.AnchorHeight)
		if err != nil {
			return nil, err
		}
	}
	rowSuffixes := make([][32]byte, len(rows)/36+1)
	rowSuffixes[len(rowSuffixes)-1] = blockSuffixes[0]
	for i := len(rowSuffixes) - 2; i >= 0; i-- {
		rowSuffixes[i] = sha256.Sum256(append(rowSuffixes[i+1][:], rows[i*36:(i+1)*36]...))
	}
	digest := rowSuffixes[0]
	begin.EvidenceDigest = bytes.Clone(digest[:])
	id, err := observationSessionID(cs, begin)
	if err != nil {
		return nil, err
	}
	plan := &ObservationPlan{SessionID: id, Steps: []*ProbabilisticHeader{{ObservationChunk: begin}}}
	seq := uint32(0)
	appendStep := func(chunk *ObservationChunk) {
		seq++
		chunk.Sequence = seq
		chunk.SessionId = bytes.Clone(id[:])
		plan.Steps = append(plan.Steps, &ProbabilisticHeader{ObservationChunk: chunk})
	}
	rowsRead := 0
	for len(rows) > 0 {
		n := minimumInt(len(rows), maxObservationRowsPerStep*36)
		rowsRead += n / 36
		appendStep(&ObservationChunk{Operation: ObservationAppendStake, StakeRows: bytes.Clone(rows[:n]), EvidenceDigest: bytes.Clone(rowSuffixes[rowsRead][:])})
		rows = rows[n:]
	}
	if begin.TableRows > 0 {
		for offset := uint64(0); offset < priorTableRows; offset += maxObservationRowsPerStep {
			appendStep(&ObservationChunk{Operation: ObservationAdvanceCredit})
		}
	}
	blocksRead := 0
	for len(blocks) > 0 {
		count := minimumInt(len(blocks), blocksPerStep)
		for i := 0; i < count; i++ {
			block := blocks[i]
			if len(block.BlockCbor) > 0 {
				decoded, err := decodeLedgerBlock(block.BlockCbor)
				if err != nil {
					return nil, err
				}
				certs, err := core.AuthenticatedPoolCertificates(decoded)
				if err != nil {
					return nil, err
				}
				if len(certs) > maxCertificatesPerStep {
					if i > 0 {
						count = i
						break
					}
					blocksRead++
					appendStep(&ObservationChunk{Operation: ObservationAppendBlocks, Blocks: []*ProbabilisticBlock{block}, EvidenceDigest: bytes.Clone(blockSuffixes[blocksRead][:])})
					for done := maxCertificatesPerStep; done < len(certs); done += maxCertificatesPerStep {
						appendStep(&ObservationChunk{Operation: ObservationContinueBody})
					}
					blocks = blocks[1:]
					count = 0
					break
				}
			}
		}
		if count > 0 {
			blocksRead += count
			appendStep(&ObservationChunk{Operation: ObservationAppendBlocks, Blocks: blocks[:count], EvidenceDigest: bytes.Clone(blockSuffixes[blocksRead][:])})
			blocks = blocks[count:]
		}
	}
	appendStep(&ObservationChunk{Operation: ObservationComplete})
	return plan, nil
}

func minimumInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}
