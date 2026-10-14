package state

import (
	"bytes"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"fmt"
	"math/big"
	"sort"

	storetypes "cosmossdk.io/store/types"
	"github.com/blinklabs-io/gouroboros/cbor"
	"github.com/blinklabs-io/gouroboros/ledger"
	core "github.com/cardano-foundation/cardano-ibc-incubator/cosmos/cardano-probabilistic-light-client-core"
)

const snapshotQualified byte = 10
const maxCertificatesPerStep = 128
const maxCertificatesPerBody = 3072

func observationBlockDigest(previous [32]byte, block *ProbabilisticBlock, anchor uint64) ([32]byte, error) {
	copy := *block
	if block.Height.RevisionHeight > anchor && len(block.BlockCbor) > 0 {
		var fields []cbor.RawMessage
		if _, err := cbor.Decode(block.BlockCbor, &fields); err != nil || len(fields) == 0 {
			return [32]byte{}, fmt.Errorf("cannot extract descendant's signed header")
		}
		copy.HeaderCbor = bytes.Clone(fields[0])
		copy.BlockCbor = nil
	}
	if copy.Height == nil || copy.Height.RevisionNumber != 0 {
		return [32]byte{}, fmt.Errorf("invalid observation block height")
	}
	hash, err := decodeBlockHash(copy.Hash)
	if err != nil {
		return [32]byte{}, err
	}
	raw := binary.BigEndian.AppendUint64(nil, copy.Height.RevisionHeight)
	for _, value := range []uint64{copy.Slot, copy.Epoch, copy.Timestamp} {
		raw = binary.BigEndian.AppendUint64(raw, value)
	}
	raw = append(raw, hash[:]...)
	witness := copy.BlockCbor
	if len(witness) == 0 {
		witness = copy.HeaderCbor
	}
	raw = binary.BigEndian.AppendUint32(raw, uint32(len(witness)))
	raw = append(raw, witness...)
	return sha256.Sum256(append(previous[:], raw...)), nil
}
func lookupStakeAmount(store storetypes.KVStore, scope [32]byte, snapshot stakeSnapshot, key []byte) (uint64, error) {
	raw, found, err := NewSnapshotMap(store, scope, snapshotStake).Lookup(snapshot.Root, key)
	if err != nil {
		return 0, err
	}
	if !found || len(raw) != 8 {
		return 0, fmt.Errorf("issuer has no sealed stake row")
	}
	amount := binary.BigEndian.Uint64(raw)
	if amount == 0 || snapshot.Total == 0 || amount > snapshot.Total {
		return 0, fmt.Errorf("sealed stake amount is invalid")
	}
	return amount, nil
}

func appendObservationBlocks(ctx Context, store storetypes.KVStore, cs *ClientState, session *observationSession, blocks []*ProbabilisticBlock) error {
	if session.Complete || session.PendingBlock != nil || !session.CreditReady || session.RowsRead != session.TableRows || len(blocks) == 0 {
		return fmt.Errorf("session is not ready for the next block batch")
	}
	if len(blocks) > maxObservationBlocksPerStep || uint32(len(blocks)) > session.BlockCount-session.ProcessedBlocks {
		return fmt.Errorf("block batch exceeds remaining logical evidence")
	}
	for index, block := range blocks {
		if err := appendObservationBlock(ctx, store, cs, session, block); err != nil {
			return err
		}
		if session.PendingBlock != nil && index+1 != len(blocks) {
			return fmt.Errorf("a pending body must finish before subsequent blocks are appended")
		}
	}
	return nil
}
func appendObservationBlock(ctx Context, store storetypes.KVStore, cs *ClientState, session *observationSession, block *ProbabilisticBlock) error {
	if block == nil || block.Height == nil || block.Height.RevisionNumber != 0 || block.Height.RevisionHeight != session.Working.Height+1 {
		return fmt.Errorf("staged block does not follow the verified cursor")
	}
	full := block.Height.RevisionHeight <= session.AnchorHeight
	if err := validateProbabilisticBlockWitness(block, "staged", full); err != nil {
		return err
	}
	var decoded ledger.Block
	var header ledger.BlockHeader
	var rawHeader *ledger.BabbageBlockHeader
	var err error
	if len(block.BlockCbor) > 0 {
		decoded, err = decodeLedgerBlock(block.BlockCbor)
		if err != nil {
			return err
		}
		header = decoded
	} else {
		rawHeader, err = core.DecodeLedgerHeader(block.HeaderCbor)
		if err != nil {
			return err
		}
		header = rawHeader
	}
	if header.BlockNumber() != block.Height.RevisionHeight || header.SlotNumber() != block.Slot || !equalBlockHashes(header.Hash().String(), block.Hash) {
		return fmt.Errorf("staged block metadata disagrees with its signed header")
	}
	var previous string
	if decoded != nil {
		previous, err = blockPrevHash(decoded)
		if err != nil {
			return err
		}
	} else {
		previous = core.HeaderPrevHash(rawHeader)
	}
	if !equalBlockHashes(previous, hex.EncodeToString(session.Working.BlockHash[:])) || block.Slot <= session.Working.Slot {
		return fmt.Errorf("staged block ancestry or slot is not contiguous")
	}
	timestamp, err := cs.DeriveTimestampFromSlot(block.Slot)
	if err != nil {
		return err
	}
	maximum, err := cs.maximumAllowedCardanoTimestamp(ctx)
	if err != nil {
		return err
	}
	if timestamp != block.Timestamp || timestamp <= session.Working.Timestamp || timestamp > maximum {
		return fmt.Errorf("staged block %d timestamp %d, supplied %d, previous %d, maximum %d", block.Height.RevisionHeight, timestamp, block.Timestamp, session.Working.Timestamp, maximum)
	}
	epoch, err := cs.epochForSlot(block.Slot)
	if err != nil {
		return err
	}
	if block.Epoch != epoch || epoch < session.Working.Epoch || epoch-session.Working.Epoch > 1 {
		return fmt.Errorf("staged block epoch disagrees with the authenticated schedule")
	}
	registry, err := tickVerificationRegistry(session.Working.Registry, epoch)
	if err != nil {
		return err
	}
	session.Working.Registry = registry
	if epoch != session.Working.Epoch {
		if session.Table.Root.Rows == 0 || session.Table.Epoch != epoch {
			return fmt.Errorf("new epoch cannot verify before its complete table and credit transition")
		}
		session.Working.Stake = session.Table
		session.Working.Credit = session.NextCredit
	}
	key, err := poolKey(header.IssuerVkey().PoolId())
	if err != nil {
		return err
	}
	binding, found, err := lookupBinding(store, session.Working.Scope, registry.Effective, key)
	if err != nil {
		return err
	}
	if !found {
		return fmt.Errorf("issuer has no authenticated effective pool registration")
	}
	amount, err := lookupStakeAmount(store, session.Working.Scope, session.Working.Stake, key)
	if err != nil {
		return err
	}
	stake := &StakeDistributionEntry{PoolId: binding.PoolId, Stake: amount, VrfKeyHash: binding.VrfKeyHash, FirstRegistrationSlot: binding.FirstRegistrationSlot, RelativeStakeNumerator: amount, RelativeStakeDenominator: session.Working.Stake.Total}
	tracker, err := newNonceTracker(&trustedBlockState{height: NewHeight(0, session.Working.Height), slot: session.Working.Slot, epoch: session.Working.Epoch, blockHash: hex.EncodeToString(session.Working.BlockHash[:]), nonceState: session.Working.Nonce})
	if err != nil {
		return err
	}
	if err := tracker.tick(cs, block.Height.RevisionHeight, block.Slot, epoch, previous); err != nil {
		return err
	}
	if session.Table.Epoch == epoch && !bytes.Equal(session.TableNonce, tracker.state.EpochNonce) {
		return fmt.Errorf("epoch nonce hint disagrees with native checkpoint evolution")
	}
	if ctx.ConsumeGas != nil {
		ctx.ConsumeGas(NativeBlockVerificationGas, "Cardano native header verification")
	}
	var vrf, output []byte
	var counter uint64
	if decoded != nil {
		vrf, counter, output, err = cs.verifyNativeProbabilisticBlock(decoded, "staged", tracker.state.EpochNonce, stake)
	} else {
		vrf, counter, output, err = cs.verifyNativeProbabilisticHeader(rawHeader, "staged", tracker.state.EpochNonce, stake)
	}
	if err != nil {
		return err
	}
	if !bytes.Equal(vrf, binding.VrfKeyHash) {
		return fmt.Errorf("verified VRF key does not match the independent registration")
	}
	counterMap := NewSnapshotMap(store, session.Working.Scope, snapshotCounters)
	saved, exists, err := counterMap.Lookup(session.Working.Counters, key)
	if err != nil {
		return err
	}
	if exists && (len(saved) != 8 || counter < binary.BigEndian.Uint64(saved)) {
		return fmt.Errorf("operational certificate counter moved backwards")
	}
	session.Working.Counters, err = counterMap.Put(session.Working.Counters, key, binary.BigEndian.AppendUint64(nil, counter))
	if err != nil {
		return err
	}
	authenticated := &authenticatedProbabilisticBlock{height: header.BlockNumber(), slot: block.Slot, epoch: epoch, timestamp: timestamp, hash: header.Hash().String(), prevHash: previous, slotLeader: binding.PoolId}
	if err := tracker.apply(cs, authenticated, output); err != nil {
		return err
	}
	session.Working.Nonce = clonePraosNonceState(tracker.state)
	session.Working.Epoch = epoch
	session.Working.Height = header.BlockNumber()
	session.Working.Slot = block.Slot
	session.Working.Timestamp = timestamp
	session.Working.BlockHash, err = decodeBlockHash(header.Hash().String())
	if err != nil {
		return err
	}
	session.InputDigest, err = observationBlockDigest(session.InputDigest, block, session.AnchorHeight)
	if err != nil {
		return err
	}
	if full {
		certificates, err := core.AuthenticatedPoolCertificates(decoded)
		if err != nil {
			return err
		}
		if len(certificates) > maxCertificatesPerBody {
			return fmt.Errorf("authenticated body certificate count exceeds the bounded continuation budget")
		}
		if len(certificates) > maxCertificatesPerStep {
			if len(blocksOrNil(block)) > MaxBlockCBORBytes {
				return fmt.Errorf("pending block body exceeds its bounded buffer")
			}
			hash := sha256.Sum256(block.BlockCbor)
			bodyKey := pendingBodyKey(session.Working.Scope, hash)
			store.Set(bodyKey, block.BlockCbor)
			if err := registerSnapshotObject(store, session.Working.Scope, objectBody, hash, bodyKey); err != nil {
				return err
			}
			session.PendingBody = bytes.Clone(hash[:])
			copy := *block
			copy.BlockCbor = nil
			session.PendingBlock = &copy
			return continueObservationBody(ctx, store, cs, session)
		}
		if err := applyObservationCertificates(store, session, certificates); err != nil {
			return err
		}
		return finishObservationBody(store, cs, session, block, key)
	}
	if session.Anchor == nil {
		return fmt.Errorf("descendants cannot precede the completely processed anchor")
	}
	if epoch < session.Anchor.Epoch || epoch-session.Anchor.Epoch > 1 {
		return fmt.Errorf("settlement evidence crosses more than one epoch")
	}
	if err := creditObservationProducer(store, cs, session, key); err != nil {
		return err
	}
	session.ProcessedBlocks++
	return nil
}
func blocksOrNil(block *ProbabilisticBlock) []byte {
	if block == nil {
		return nil
	}
	return block.BlockCbor
}
func pendingBodyKey(scope, hash [32]byte) []byte {
	return append(append([]byte("snapshots/v2/bodies/"), scope[:]...), hash[:]...)
}
func applyObservationCertificates(store storetypes.KVStore, session *observationSession, certificates []core.PoolCertificate) error {
	records := map[string]storedRegistration{}
	registryMap := NewSnapshotMap(store, session.Working.Scope, snapshotRegistry)
	for _, certificate := range certificates {
		key, err := poolKey(certificate.PoolID)
		if err != nil {
			return err
		}
		record, exists := records[string(key)]
		if !exists {
			var lookupErr error
			record, exists, lookupErr = lookupRegistration(store, session.Working.Scope, session.Working.Registry, key)
			if lookupErr != nil {
				return lookupErr
			}
		}
		if certificate.Retirement {
			if !exists || !record.Registered || certificate.RetirementEpoch <= session.Working.Epoch {
				return fmt.Errorf("retirement has no current registration or valid future epoch")
			}
			record.RetirementEpoch = certificate.RetirementEpoch
		} else {
			if len(certificate.VRFKeyHash) != 32 {
				return fmt.Errorf("registration key must be 32 bytes")
			}
			if !exists {
				record = storedRegistration{Epoch: session.Working.Epoch, FirstSlot: session.Working.Slot}
			}
			if !record.Registered {
				record.Registered = true
				copy(record.VRF[:], certificate.VRFKeyHash)
				record.PendingEpoch = 0
				record.PendingVRF = nil
			} else {
				if session.Working.Epoch == ^uint64(0) {
					return fmt.Errorf("registration activation epoch overflow")
				}
				record.PendingEpoch = session.Working.Epoch + 1
				record.PendingVRF = bytes.Clone(certificate.VRFKeyHash)
			}
			record.RetirementEpoch = 0
		}
		records[string(key)] = record
	}
	var changes []SnapshotChange
	for key, record := range records {
		raw, err := encodeRegistration(record)
		if err != nil {
			return err
		}
		changes = append(changes, SnapshotChange{[]byte(key), raw})
	}
	sort.Slice(changes, func(i, j int) bool { return bytes.Compare(changes[i].Key, changes[j].Key) < 0 })
	var err error
	session.Working.Registry.Records, err = registryMap.PutBatch(session.Working.Registry.Records, changes)
	if err != nil {
		return err
	}
	if session.Working.Registry.Records.Rows > MaxRetainedPoolIdentities {
		return fmt.Errorf("retained identity capacity exceeded")
	}

	return nil
}
func continueObservationBody(ctx Context, store storetypes.KVStore, cs *ClientState, session *observationSession) error {
	if session.PendingBlock == nil || len(session.PendingBody) != 32 {
		return fmt.Errorf("no authenticated body is awaiting completion")
	}
	raw := store.Get(pendingBodyKey(session.Working.Scope, [32]byte(session.PendingBody)))
	if len(raw) > MaxBlockCBORBytes || sha256.Sum256(raw) != [32]byte(session.PendingBody) {
		return fmt.Errorf("authenticated body buffer is missing or changed")
	}
	decoded, err := decodeLedgerBlock(raw)
	if err != nil {
		return err
	}
	certificates, err := core.AuthenticatedPoolCertificates(decoded)
	if err != nil {
		return err
	}
	from := int(session.PendingCertificate)
	if from >= len(certificates) {
		return fmt.Errorf("invalid body certificate cursor")
	}
	to := from + maxCertificatesPerStep
	if to > len(certificates) {
		to = len(certificates)
	}
	if err := applyObservationCertificates(store, session, certificates[from:to]); err != nil {
		return err
	}
	session.PendingCertificate = uint32(to)
	if to < len(certificates) {
		return nil
	}
	block := *session.PendingBlock
	block.BlockCbor = raw
	key, err := poolKey(decoded.IssuerVkey().PoolId())
	if err != nil {
		return err
	}
	if err := finishObservationBody(store, cs, session, &block, key); err != nil {
		return err
	}
	session.PendingBlock = nil
	session.PendingBody = nil
	session.PendingCertificate = 0
	return nil
}
func finishObservationBody(store storetypes.KVStore, cs *ClientState, session *observationSession, block *ProbabilisticBlock, pool []byte) error {
	reference, hostRoot, err := advancePacketCheckpoint(store, session.Working.Scope, session.Working.PacketReference, block.BlockCbor, cs)
	if err != nil {
		return err
	}
	session.Working.PacketReference = reference
	session.Working.HostRoot = hostRoot
	production, err := lookupProduction(store, session.Working.Scope, session.Working.Production, pool, session.Working.Epoch)
	if err != nil {
		return err
	}
	production.ProducedCurrentEpoch = true
	session.Working.Production, err = NewSnapshotMap(store, session.Working.Scope, snapshotProduction).Put(session.Working.Production, pool, encodeProduction(session.Working.Epoch, production))
	if err != nil {
		return err
	}
	session.Working.SettledHistory, err = NewSnapshotMap(store, session.Working.Scope, snapshotSettledHistory).Put(session.Working.SettledHistory, binary.BigEndian.AppendUint64(nil, block.Height.RevisionHeight), session.Working.BlockHash[:])
	if err != nil {
		return err
	}
	if session.Working.Height == session.AnchorHeight {
		if session.HostTxHash != "" {
			header := &ProbabilisticHeader{AnchorBlock: block, HostStateTxHash: session.HostTxHash}
			if err := verifyHostStateTxIncludedInAnchorBlock(header); err != nil {
				return err
			}
		}
		anchor := session.Working
		anchor.Nonce = clonePraosNonceState(session.Working.Nonce)
		session.Anchor = &anchor
	}
	session.ProcessedBlocks++
	return nil
}
func creditObservationProducer(store storetypes.KVStore, cs *ClientState, session *observationSession, key []byte) error {
	seen := NewSnapshotMap(store, session.Working.Scope, snapshotQualified)
	_, exists, err := seen.Lookup(session.Qualified, key)
	if err != nil {
		return err
	}
	if exists {
		return nil
	}
	session.Qualified, err = seen.Put(session.Qualified, key, []byte{1})
	if err != nil {
		return err
	}
	anchor := session.Anchor
	binding, exists, err := lookupBinding(store, anchor.Scope, anchor.Registry.Effective, key)
	if err != nil {
		return err
	}
	if !exists {
		if session.Working.Epoch > anchor.Epoch {
			return nil
		}
		return fmt.Errorf("settlement producer has no anchor registration")
	}
	cutoff, err := cs.poolRegistrationCutoffSlotExclusive(anchor.Slot)
	if err != nil {
		return err
	}
	if binding.FirstRegistrationSlot >= cutoff {
		return nil
	}
	production, err := lookupProduction(store, anchor.Scope, anchor.Production, key, anchor.Epoch)
	if err != nil {
		return err
	}
	if production.CompletedEpochsBitmap == 0 {
		return nil
	}
	amount, err := lookupStakeAmount(store, anchor.Scope, anchor.Stake, key)
	if err != nil {
		return err
	}
	old, err := lookupCredit(store, anchor.Scope, anchor.Credit, key)
	if err != nil {
		return err
	}
	cap := new(big.Rat).Add(old, big.NewRat(int64(DefaultAdditionalSettlementCreditBps), 10000))
	credit := new(big.Rat).SetFrac(new(big.Int).SetUint64(amount), new(big.Int).SetUint64(anchor.Stake.Total))
	if credit.Cmp(cap) > 0 {
		credit.Set(cap)
	}
	if session.Table.Root.Rows > 0 && session.Table.Epoch > anchor.Epoch {
		raw, found, err := NewSnapshotMap(store, anchor.Scope, snapshotStake).Lookup(session.Table.Root, key)
		if err != nil {
			return err
		}
		limit := new(big.Rat)
		if found {
			if len(raw) != 8 {
				return fmt.Errorf("invalid following-epoch stake row")
			}
			limit.SetFrac(new(big.Int).SetUint64(binary.BigEndian.Uint64(raw)), new(big.Int).SetUint64(session.Table.Total))
		}
		if credit.Cmp(limit) > 0 {
			credit.Set(limit)
		}
	}
	total := new(big.Rat).SetFrac(new(big.Int).SetBytes(session.QualifiedNumerator), new(big.Int).SetBytes(session.QualifiedDenominator))
	total.Add(total, credit)
	session.QualifiedNumerator = total.Num().Bytes()
	session.QualifiedDenominator = total.Denom().Bytes()
	session.QualifiedCount++
	return nil
}
