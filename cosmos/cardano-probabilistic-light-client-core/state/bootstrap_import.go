package state

import (
	"bytes"
	"crypto/sha256"
	"encoding/binary"
	"fmt"
	"sort"

	storetypes "cosmossdk.io/store/types"
	"github.com/blinklabs-io/gouroboros/cbor"
)

const ObservationBootstrapImport uint32 = 10
const ObservationBootstrapComplete uint32 = 11
const snapshotBootstrapFrontier byte = 14
const maxBootstrapPagesPerStep = 8

type bootstrapManifest struct {
	Checkpoint *verificationCheckpoint
	Packet     *packetCheckpoint
}
type bootstrapPage struct {
	Kind byte
	Raw  []byte
}
type bootstrapExpected struct {
	Kind   byte
	Root   SnapshotRoot
	Depth  byte
	Prefix []byte
}
type bootstrapProgress struct {
	Manifest   bootstrapManifest
	Frontier   SnapshotRoot
	Sequence   uint32
	LastDigest [32]byte
}

func bootstrapProgressKey(cs *ClientState) []byte {
	return binary.BigEndian.AppendUint64(append([]byte("snapshots/v2/bootstrap/"), cs.StorageNamespace...), cs.VerificationGeneration)
}
func bootstrapFrontierKey(kind byte, hash [32]byte) []byte {
	sum := sha256.Sum256(append([]byte{kind}, hash[:]...))
	return sum[:]
}
func checkpointRoots(cp *verificationCheckpoint, packet *packetCheckpoint) []struct {
	Kind byte
	Root SnapshotRoot
} {
	mark, effective := snapshotRegistry, snapshotRegistry
	if cp.Registry.Mark.Bindings {
		mark = snapshotBindings
	}
	if cp.Registry.Effective.Bindings {
		effective = snapshotBindings
	}
	return []struct {
		Kind byte
		Root SnapshotRoot
	}{{snapshotRegistry, cp.Registry.Records}, {mark, cp.Registry.Mark.Root}, {effective, cp.Registry.Effective.Root}, {snapshotStake, cp.Stake.Root}, {snapshotCredit, cp.Credit}, {snapshotProduction, cp.Production}, {snapshotCounters, cp.Counters}, {snapshotSettledHistory, cp.SettledHistory}, {snapshotPacketLanes, packet.Lanes}, {snapshotPacketInputs, packet.Inputs}, {snapshotPacketRoutes, packet.Routes}}
}
func allocateStorageNamespace(store storetypes.KVStore, scope [32]byte) ([]byte, error) {
	raw := store.Get([]byte("snapshots/v2/nextNamespace"))
	var seq uint64
	if len(raw) > 0 {
		if len(raw) != 8 {
			return nil, fmt.Errorf("invalid storage namespace sequence")
		}
		seq = binary.BigEndian.Uint64(raw)
	}
	if seq == ^uint64(0) {
		return nil, fmt.Errorf("storage namespace sequence overflow")
	}
	seq++
	namespace := sha256.Sum256(binary.BigEndian.AppendUint64(append([]byte("cardano-ibc.namespace/v2\x00"), scope[:]...), seq))
	store.Set([]byte("snapshots/v2/nextNamespace"), binary.BigEndian.AppendUint64(nil, seq))
	return namespace[:], nil
}
func (cs *ClientState) initializeClientState(ctx Context, cdc StateCodec, private storetypes.KVStore, consensus *ConsensusState) error {
	if !cs.BootstrapPending || cs.VerificationGeneration != 1 || len(cs.BootstrapObjects) == 0 || len(cs.BootstrapObjects) > MaxClientBytes {
		return fmt.Errorf("initialization requires an explicit trusted bootstrap manifest")
	}
	var manifest bootstrapManifest
	if _, err := cbor.Decode(cs.BootstrapObjects, &manifest); err != nil {
		return err
	}
	if manifest.Checkpoint == nil || manifest.Packet == nil {
		return fmt.Errorf("bootstrap manifest is incomplete")
	}
	cp := manifest.Checkpoint
	scope, err := verificationScope(cs)
	if err != nil {
		return err
	}
	checkpointRaw, err := cbor.Encode(cp)
	if err != nil {
		return err
	}
	reference := checkpointDigest(scope, checkpointRaw)
	if cp.Scope != scope || cp.Version != VerificationPolicyVersion || !bytes.Equal(reference[:], cs.CheckpointReference) || cp.Height != cs.LatestCheckpointHeight.RevisionHeight || cp.Height != cs.LatestHeight.RevisionHeight || cp.Epoch != cs.CurrentEpoch || cp.Slot != cs.LatestCheckpointSlot || cp.Timestamp != cs.LatestCheckpointTimestamp || !praosNonceStatesEqual(cp.Nonce, cs.LatestCheckpointNonceState) || cp.BlockHash != mustBlockHash(cs.LatestCheckpointBlockHash) {
		return fmt.Errorf("trusted bootstrap manifest disagrees with the initial client")
	}
	packetRaw, err := cbor.Encode(manifest.Packet)
	if err != nil {
		return err
	}
	packetHash := packetObjectDigest(scope, packetRaw)
	if cp.PacketReference != packetHash || manifest.Packet.Height != cp.Height || manifest.Packet.BlockHash != cp.BlockHash || manifest.Packet.HostRoot != cp.HostRoot || consensus.VerificationGeneration != 1 || !bytes.Equal(consensus.CheckpointReference, reference[:]) || !bytes.Equal(consensus.PacketStateReference, packetHash[:]) || consensus.Timestamp != cp.Timestamp || consensus.AcceptedEpoch != cp.Epoch || consensus.AcceptedBlockHash != cs.LatestCheckpointBlockHash || !bytes.Equal(consensus.IbcStateRoot, cp.HostRoot[:]) {
		return fmt.Errorf("trusted bootstrap manifest disagrees with initial consensus")
	}
	shared, err := ctx.snapshotStore()
	if err != nil {
		return err
	}
	cs.StorageNamespace, err = allocateStorageNamespace(shared, scope)
	if err != nil {
		return err
	}
	// A trusted export can carry another client's host-local deadlines. The
	// new namespace gets its own response window only after import completes.
	// Installing exported deadlines now would make that final window immutable.
	cs.EpochContextChallenges = nil
	cs.BootstrapObjects = nil
	frontierChanges := map[string][]byte{}
	for _, root := range checkpointRoots(cp, manifest.Packet) {
		if root.Root.Rows > 0 {
			expected := bootstrapExpected{Kind: root.Kind, Root: root.Root}
			raw, err := cbor.Encode(expected)
			if err != nil {
				return err
			}
			frontierChanges[string(bootstrapFrontierKey(root.Kind, root.Root.Hash))] = raw
		}
	}
	progress := bootstrapProgress{Manifest: manifest}
	progress.Frontier, err = NewSnapshotMap(shared, scope, snapshotBootstrapFrontier).PutBatch(SnapshotRoot{}, orderedPacketChanges(frontierChanges))
	if err != nil {
		return err
	}
	raw, err := cbor.Encode(progress)
	if err != nil {
		return err
	}
	shared.Set(bootstrapProgressKey(cs), raw)
	if err := NewSnapshotMap(shared, scope, snapshotBootstrapFrontier).Pin(namespaceOwner(cs.StorageNamespace, 1, 7, nil), progress.Frontier); err != nil {
		return err
	}
	if err := writeClientState(ctx, cdc, private, cs); err != nil {
		return err
	}
	SetConsensusState(private, cdc, consensus, cs.LatestHeight)
	setConsensusMetadata(ctx, private, cs.LatestHeight)
	return nil
}
func (cs *ClientState) continueBootstrap(ctx Context, cdc StateCodec, private, shared storetypes.KVStore, chunk *ObservationChunk, digest [32]byte) error {
	if !cs.BootstrapPending {
		return fmt.Errorf("bootstrap already completed")
	}
	raw := shared.Get(bootstrapProgressKey(cs))
	var progress bootstrapProgress
	if len(raw) == 0 || len(raw) > maxSessionBytes {
		return fmt.Errorf("bootstrap progress is missing")
	}
	if _, err := cbor.Decode(raw, &progress); err != nil {
		return err
	}
	if chunk.Sequence == progress.Sequence && digest == progress.LastDigest {
		return nil
	}
	if chunk.Sequence != progress.Sequence+1 || chunk.Sequence > MaxObservationSteps {
		return fmt.Errorf("bootstrap chunk is reordered")
	}
	scope := progress.Manifest.Checkpoint.Scope
	frontier := NewSnapshotMap(shared, scope, snapshotBootstrapFrontier)
	if chunk.Operation == ObservationBootstrapImport {
		var pages []bootstrapPage
		if _, err := cbor.Decode(chunk.Objects, &pages); err != nil {
			return err
		}
		if len(pages) == 0 || len(pages) > maxBootstrapPagesPerStep {
			return fmt.Errorf("bootstrap page batch exceeds its bound")
		}
		// A batch may contain a parent's children. Keep those expected entries in
		// this transaction until the final copy-on-write frontier update.
		changes := map[string][]byte{}
		for _, page := range pages {
			m := NewSnapshotMap(shared, scope, page.Kind)
			hash := m.digest(page.Raw)
			key := bootstrapFrontierKey(page.Kind, hash)
			expectation, changed := changes[string(key)]
			found := expectation != nil
			if !changed {
				var err error
				expectation, found, err = frontier.Lookup(progress.Frontier, key)
				if err != nil {
					return err
				}
			}
			if !found {
				return fmt.Errorf("bootstrap page was not committed by the trusted manifest or was already imported")
			}
			var expected bootstrapExpected
			if _, err := cbor.Decode(expectation, &expected); err != nil {
				return err
			}
			decoded, err := decodeSnapshotPage(page.Raw)
			if err != nil {
				return err
			}
			if expected.Kind != page.Kind || expected.Root.Hash != hash || decoded.Rows != expected.Root.Rows || decoded.Depth != expected.Depth {
				return fmt.Errorf("bootstrap page disagrees with its expected path or count")
			}
			for _, entry := range decoded.Entries {
				for depth := 0; depth < int(decoded.Depth); depth++ {
					if snapshotNibble(entry.Key, depth) != snapshotNibble(expected.Prefix, depth) {
						return fmt.Errorf("bootstrap leaf escaped its directory path")
					}
				}
			}
			if _, err := m.save(decoded); err != nil {
				return err
			}
			if expected.Depth == 0 {
				if err := m.Pin(namespaceOwner(cs.StorageNamespace, cs.VerificationGeneration, 7, append([]byte{page.Kind}, hash[:]...)), expected.Root); err != nil {
					return err
				}
			}
			changes[string(key)] = nil
			if decoded.Children != nil {
				for index, child := range decoded.Children {
					if child.Rows == 0 {
						continue
					}
					prefix := bytes.Clone(expected.Prefix)
					if len(prefix) < (int(expected.Depth)+2)/2 {
						prefix = append(prefix, 0)
					}
					if expected.Depth%2 == 0 {
						prefix[expected.Depth/2] = byte(index) << 4
					} else {
						prefix[expected.Depth/2] |= byte(index)
					}
					childExpected := bootstrapExpected{Kind: page.Kind, Root: SnapshotRoot{Hash: child.Hash, Rows: child.Rows}, Depth: expected.Depth + 1, Prefix: prefix}
					raw, err := cbor.Encode(childExpected)
					if err != nil {
						return err
					}
					childKey := string(bootstrapFrontierKey(page.Kind, child.Hash))
					if previous, exists := changes[childKey]; exists && previous != nil && !bytes.Equal(previous, raw) {
						return fmt.Errorf("bootstrap child has ambiguous paths")
					}
					changes[childKey] = raw
				}
			}
		}
		var err error
		progress.Frontier, err = frontier.PutBatch(progress.Frontier, orderedPacketChanges(changes))
		if err != nil {
			return err
		}
	} else {
		if progress.Frontier.Rows != 0 {
			return fmt.Errorf("bootstrap cannot activate before every committed page is imported")
		}
		ref, err := savePacketCheckpoint(shared, scope, progress.Manifest.Packet)
		if err != nil {
			return err
		}
		if ref != progress.Manifest.Checkpoint.PacketReference {
			return fmt.Errorf("bootstrap packet commitment changed")
		}
		ref, err = saveVerificationCheckpoint(shared, progress.Manifest.Checkpoint)
		if err != nil {
			return err
		}
		if !bytes.Equal(ref[:], cs.CheckpointReference) {
			return fmt.Errorf("bootstrap checkpoint commitment changed")
		}
		if err := pinVerificationCheckpoint(shared, progress.Manifest.Checkpoint, namespaceOwner(cs.StorageNamespace, 1, 1, nil)); err != nil {
			return err
		}
		private.Set(ownedCheckpointKey(1, progress.Manifest.Checkpoint.Height), ref[:])
		if err := retainCheckpoint(shared, cs, progress.Manifest.Checkpoint, ref[:]); err != nil {
			return err
		}
		for _, root := range checkpointRoots(progress.Manifest.Checkpoint, progress.Manifest.Packet) {
			if err := NewSnapshotMap(shared, scope, root.Kind).Pin(namespaceOwner(cs.StorageNamespace, cs.VerificationGeneration, 7, append([]byte{root.Kind}, root.Root.Hash[:]...)), SnapshotRoot{}); err != nil {
				return err
			}
		}
		cs.BootstrapPending = false
		if err := cs.resetEpochDeadline(ctx, cs.CurrentEpoch); err != nil {
			return err
		}
		if err := writeClientState(ctx, cdc, private, cs); err != nil {
			return err
		}
	}
	progress.Sequence = chunk.Sequence
	progress.LastDigest = digest
	raw, err := cbor.Encode(progress)
	if err != nil {
		return err
	}
	shared.Set(bootstrapProgressKey(cs), raw)
	return frontier.Pin(namespaceOwner(cs.StorageNamespace, 1, 7, nil), progress.Frontier)
}
func packetObjectDigest(scope [32]byte, raw []byte) [32]byte {
	return sha256.Sum256(append(append([]byte("cardano-ibc.packet-snapshot/v2\x00"), scope[:]...), raw...))
}

// BuildBootstrap runs in a preparation tool. The creator explicitly
// trusts the resulting checkpoint. Imports prove only that the uploaded bytes
// match that starting commitment, not that a relayer-selected checkpoint is true.
func BuildBootstrap(store storetypes.KVStore, client *ClientState, consensus *ConsensusState) (*ClientState, *ConsensusState, []*ProbabilisticHeader, error) {
	cp, err := buildTrustedCheckpoint(store, client, consensus)
	if err != nil {
		return nil, nil, nil, err
	}
	ref, err := saveVerificationCheckpoint(store, cp)
	if err != nil {
		return nil, nil, nil, err
	}
	packet, err := loadPacketCheckpoint(store, cp.Scope, cp.PacketReference)
	if err != nil {
		return nil, nil, nil, err
	}
	thin := referenceClientState(client, make([]byte, 32), cp, ref)
	thin.BootstrapPending = true
	thin.BootstrapObjects, err = cbor.Encode(bootstrapManifest{cp, packet})
	if err != nil {
		return nil, nil, nil, err
	}
	compact := referenceConsensusState(consensus, cp, ref, 1)
	var pages []bootstrapPage
	seen := map[string]bool{}
	var visit func(byte, SnapshotRoot, int) error
	visit = func(kind byte, root SnapshotRoot, depth int) error {
		if root.Rows == 0 {
			return nil
		}
		key := string(bootstrapFrontierKey(kind, root.Hash))
		if seen[key] {
			return nil
		}
		seen[key] = true
		m := NewSnapshotMap(store, cp.Scope, kind)
		page, err := m.load(root, depth)
		if err != nil {
			return err
		}
		raw, err := encodeSnapshotPage(page)
		if err != nil {
			return err
		}
		pages = append(pages, bootstrapPage{kind, raw})
		if page.Children != nil {
			for _, child := range page.Children {
				if child.Rows > 0 {
					if err := visit(kind, SnapshotRoot{child.Hash, child.Rows}, depth+1); err != nil {
						return err
					}
				}
			}
		}
		return nil
	}
	// Keep the dictionary order explicit, roots may share identical pages.
	roots := checkpointRoots(cp, packet)
	sort.SliceStable(roots, func(i, j int) bool { return roots[i].Kind < roots[j].Kind })
	for _, root := range roots {
		if err := visit(root.Kind, root.Root, 0); err != nil {
			return nil, nil, nil, err
		}
	}
	var steps []*ProbabilisticHeader
	seq := uint32(0)
	for len(pages) > 0 {
		count := minimumInt(len(pages), maxBootstrapPagesPerStep)
		raw, err := cbor.Encode(pages[:count])
		if err != nil {
			return nil, nil, nil, err
		}
		seq++
		steps = append(steps, &ProbabilisticHeader{ObservationChunk: &ObservationChunk{Operation: ObservationBootstrapImport, Objects: raw, Sequence: seq}})
		pages = pages[count:]
	}
	seq++
	steps = append(steps, &ProbabilisticHeader{ObservationChunk: &ObservationChunk{Operation: ObservationBootstrapComplete, Sequence: seq}})
	return thin, compact, steps, nil
}
