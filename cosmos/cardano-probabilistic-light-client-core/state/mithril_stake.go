package state

import (
	"bytes"
	"encoding/binary"
	"fmt"
	"strconv"

	errorsmod "cosmossdk.io/errors"
	storetypes "cosmossdk.io/store/types"
	"github.com/cardano-foundation/cardano-ibc-incubator/cosmos/cardano-probabilistic-light-client-core/mithril"
)

// For a client with a Mithril anchor, a Cardano stake distribution certified by
// Mithril outranks an uploaded stake table. A new epoch's table must match the
// certified distribution once one is recorded, and then needs no response
// window. Until then the uploaded table and its response window apply as for
// any client. Mithril certifies the distribution that elects an epoch's
// leaders during the epoch before it, so relayers can record it well ahead of
// the rollover.
const (
	MaxMithrilCertificates            = 8
	MaxMithrilCertificateBytes        = 512 * 1024
	MithrilCertificateVerificationGas = uint64(2_000_000)
)

var (
	mithrilStakeRootPrefix  = []byte("mithrilStakeRoot/")
	acceptedStakeRootPrefix = []byte("acceptedStakeRoot/")
)

// Certified roots belong to the verification generation whose Mithril state
// verified them. Recovery starts a generation with the substitute's state.
func mithrilStakeRootKey(generation, epoch uint64) []byte {
	key := binary.BigEndian.AppendUint64(bytes.Clone(mithrilStakeRootPrefix), generation)
	return binary.BigEndian.AppendUint64(key, epoch)
}

// An accepted root is the Mithril root of a table a generation accepted under
// the response window, before Mithril certified its epoch. A late certificate
// is checked against it, so it is kept apart from the activated table, which
// retention cleanup deletes. It lives until a certificate for its epoch is
// applied, or with its generation if Mithril never certifies that epoch.
// Recovery carries the substitute's accepted roots into the new generation.
func acceptedStakeRootKey(generation, epoch uint64) []byte {
	key := binary.BigEndian.AppendUint64(bytes.Clone(acceptedStakeRootPrefix), generation)
	return binary.BigEndian.AppendUint64(key, epoch)
}

// certifiedStakeRoot is a root a recovery carries into its new generation.
type certifiedStakeRoot struct {
	Epoch uint64
	Root  string
}

// maxRecoveredMithrilRoots bounds the certified roots a recovery carries.
// Mithril certifies stake at most two epochs ahead of a current checkpoint.
const maxRecoveredMithrilRoots = 8

// maxRecoveredAcceptedRoots bounds the accepted roots a recovery carries: one
// for each epoch the substitute's anchor trails its checkpoint.
const maxRecoveredAcceptedRoots = 64

func (cs *ClientState) mithrilAnchor() (mithril.Anchor, bool) {
	if cs.MithrilEpoch == 0 && cs.MithrilAggregateVerificationKey == "" && cs.MithrilProtocolParametersHash == "" {
		return mithril.Anchor{}, false
	}
	return mithril.Anchor{
		Epoch:                    cs.MithrilEpoch,
		AggregateVerificationKey: cs.MithrilAggregateVerificationKey,
		ProtocolParametersHash:   cs.MithrilProtocolParametersHash,
	}, true
}

func (cs *ClientState) validateMithrilAnchor() error {
	anchor, ok := cs.mithrilAnchor()
	if !ok {
		return nil
	}
	if err := mithril.ValidateAnchor(anchor); err != nil {
		return errorsmod.Wrap(ErrIBCInvalidClient, err.Error())
	}
	return nil
}

// ValidateBasic bounds a certificate message before any verification work.
func (m *MithrilStakeCertificates) ValidateBasic() error {
	if m == nil || len(m.Certificates) == 0 || len(m.Certificates) > MaxMithrilCertificates {
		return errorsmod.Wrapf(ErrInvalidHeader, "Mithril stake update must carry 1 to %d certificates", MaxMithrilCertificates)
	}
	total := 0
	for index, certificate := range m.Certificates {
		if len(certificate) > MaxMithrilCertificateBytes {
			return errorsmod.Wrapf(ErrInvalidHeader, "Mithril certificate %d exceeds %d bytes", index, MaxMithrilCertificateBytes)
		}
		total += len(certificate)
	}
	// The message must fit the transport budget of a bounded operation.
	if total > MaxOperationSignedBytes-20000 {
		return errorsmod.Wrap(ErrInvalidHeader, "Mithril certificates exceed the transport budget")
	}
	return nil
}

func (cs *ClientState) verifyMithrilStakeCertificates(ctx Context, msg *MithrilStakeCertificates) error {
	if err := msg.ValidateBasic(); err != nil {
		return err
	}
	// The bootstrap's own certificate moves the anchor to its epoch.
	if cs.BootstrapPending {
		return errorsmod.Wrap(ErrInvalidHeader, "trusted bootstrap import has not completed")
	}
	if ctx.ConsumeGas != nil {
		// Covers the verification here and its repetition in UpdateState.
		ctx.ConsumeGas(uint64(len(msg.Certificates))*MithrilCertificateVerificationGas, "Mithril certificate verification")
	}
	_, _, err := cs.extendMithrilAnchor(msg)
	return err
}

// extendMithrilAnchor verifies certificates that extend the client's anchor.
// Each must certify a stake distribution, so the anchor cannot pass an epoch
// without recording the stake that elects the next epoch's leaders.
func (cs *ClientState) extendMithrilAnchor(msg *MithrilStakeCertificates) (mithril.Anchor, []mithril.StakeDistribution, error) {
	anchor, ok := cs.mithrilAnchor()
	if !ok {
		return mithril.Anchor{}, nil, errorsmod.Wrap(ErrIBCInvalidClient, "client has no Mithril anchor")
	}
	next, distributions, err := mithril.VerifyCertificates(anchor, msg.Certificates)
	if err != nil {
		return mithril.Anchor{}, nil, errorsmod.Wrap(ErrInvalidHeader, err.Error())
	}
	if len(distributions) != len(msg.Certificates) {
		return mithril.Anchor{}, nil, errorsmod.Wrap(ErrInvalidHeader, "every Mithril certificate must certify a Cardano stake distribution")
	}
	return next, distributions, nil
}

func (cs *ClientState) applyMithrilStakeCertificates(ctx Context, cdc StateCodec, clientStore storetypes.KVStore, msg *MithrilStakeCertificates) []HeightValue {
	// ReCheckTx omits VerifyClientMessage, so verification repeats here.
	next, distributions, err := cs.extendMithrilAnchor(msg)
	if err != nil {
		panic(err)
	}
	for _, distribution := range distributions {
		clientStore.Set(mithrilStakeRootKey(cs.VerificationGeneration, distribution.LeaderEpoch()), []byte(distribution.MerkleRoot))
		// CheckForMisbehaviour found any accepted table for this epoch equal
		// to the certified one, which now supersedes it.
		clientStore.Delete(acceptedStakeRootKey(cs.VerificationGeneration, distribution.LeaderEpoch()))
		ctx.emitEvent("mithril_stake_certified",
			newEventAttribute("leader_epoch", strconv.FormatUint(distribution.LeaderEpoch(), 10)),
			newEventAttribute("merkle_root", distribution.MerkleRoot),
		)
	}
	cs.MithrilEpoch = next.Epoch
	cs.MithrilAggregateVerificationKey = next.AggregateVerificationKey
	cs.MithrilProtocolParametersHash = next.ProtocolParametersHash
	if err := writeClientState(ctx, cdc, clientStore, cs); err != nil {
		panic(err)
	}
	return nil
}

// requireCertifiedStake rejects a sealed table whose Mithril root differs from
// the distribution Mithril certified for its epoch. It reports whether one was
// certified. Without one, the table keeps its response window.
func requireCertifiedStake(clientStore storetypes.KVStore, generation, epoch uint64, root string) (bool, error) {
	certified := clientStore.Get(mithrilStakeRootKey(generation, epoch))
	if certified == nil {
		return false, nil
	}
	if root != string(certified) {
		return false, fmt.Errorf("epoch %d stake table differs from the Mithril-certified distribution", epoch)
	}
	return true, nil
}

// recoveredMithrilRoots selects the certification state a recovery adopts:
// the substitute's anchor and the roots it certified for epochs after its
// checkpoint, which the replacement's coming rollovers need. Earlier roots
// are not needed. The subject's roots stay with its old generation. A
// relayer re-establishes any it had beyond the substitute's anchor by
// submitting those certificates again. Roots both clients certified for the
// same epoch describe the same Cardano stake, so they must agree.
//
// It also returns the substitute's accepted roots for epochs after its anchor
// up to its checkpoint. The replacement's history relies on those tables, so
// a late certificate must still be able to disprove them.
func recoveredMithrilRoots(subject *ClientState, subjectStore storetypes.KVStore, substitute *ClientState, substituteStore storetypes.KVStore, checkpointEpoch uint64) ([]certifiedStakeRoot, []certifiedStakeRoot, error) {
	anchor, ok := substitute.mithrilAnchor()
	if !ok {
		return nil, nil, nil
	}
	if held, ok := subject.mithrilAnchor(); ok && held.Epoch == anchor.Epoch && held != anchor {
		return nil, nil, fmt.Errorf("subject and substitute hold different Mithril anchors for epoch %d", anchor.Epoch)
	}
	if anchor.Epoch > checkpointEpoch && anchor.Epoch-checkpointEpoch > maxRecoveredMithrilRoots {
		return nil, nil, fmt.Errorf("substitute's Mithril anchor is more than %d epochs ahead of its checkpoint", maxRecoveredMithrilRoots)
	}
	if checkpointEpoch > anchor.Epoch && checkpointEpoch-anchor.Epoch > maxRecoveredAcceptedRoots {
		return nil, nil, fmt.Errorf("substitute's Mithril anchor is more than %d epochs behind its checkpoint", maxRecoveredAcceptedRoots)
	}
	var roots []certifiedStakeRoot
	for epoch := checkpointEpoch + 1; epoch <= anchor.Epoch; epoch++ {
		root := substituteStore.Get(mithrilStakeRootKey(substitute.VerificationGeneration, epoch))
		if root == nil {
			continue
		}
		if held := subjectStore.Get(mithrilStakeRootKey(subject.VerificationGeneration, epoch)); held != nil && !bytes.Equal(held, root) {
			return nil, nil, fmt.Errorf("subject and substitute certified different epoch %d stake distributions", epoch)
		}
		roots = append(roots, certifiedStakeRoot{Epoch: epoch, Root: string(root)})
	}
	var accepted []certifiedStakeRoot
	for epoch := anchor.Epoch + 1; epoch <= checkpointEpoch; epoch++ {
		if root := substituteStore.Get(acceptedStakeRootKey(substitute.VerificationGeneration, epoch)); root != nil {
			accepted = append(accepted, certifiedStakeRoot{Epoch: epoch, Root: string(root)})
		}
	}
	return roots, accepted, nil
}

// mithrilStakeConflict reports whether verified certificates certify a stake
// distribution that differs from a table the client accepted under the
// response window. That table is then proven wrong, so the certificates are
// misbehaviour. The accepted root outlives the activated table's retention.
func (cs ClientState) mithrilStakeConflict(clientStore storetypes.KVStore, msg *MithrilStakeCertificates) bool {
	_, distributions, err := cs.extendMithrilAnchor(msg)
	if err != nil {
		return false
	}
	for _, distribution := range distributions {
		accepted := clientStore.Get(acceptedStakeRootKey(cs.VerificationGeneration, distribution.LeaderEpoch()))
		if accepted != nil && string(accepted) != distribution.MerkleRoot {
			return true
		}
	}
	return false
}

// recordAcceptedStake keeps the Mithril root of a table activated before
// Mithril certified its epoch.
func recordAcceptedStake(clientStore storetypes.KVStore, generation, epoch uint64, root string) error {
	if root == "" {
		return fmt.Errorf("accepted epoch %d table has no Mithril root", epoch)
	}
	clientStore.Set(acceptedStakeRootKey(generation, epoch), []byte(root))
	return nil
}

// requireReceiptStake rejects a receipt that relies on a stake table Mithril
// has disproved, whenever the certificate arrived. Such a receipt can neither
// activate nor serve as misbehaviour evidence. If the client's own installed
// table is the disproved one, the certificate itself freezes the client.
func requireReceiptStake(clientStore storetypes.KVStore, generation uint64, receipt *verifiedObservation) error {
	if receipt.Table.Root.Rows == 0 {
		return nil
	}
	_, err := requireCertifiedStake(clientStore, generation, receipt.Table.Epoch, receipt.TableMithrilRoot)
	return err
}
