package state

import (
	"encoding/binary"
	"fmt"
	"strconv"

	errorsmod "cosmossdk.io/errors"
	storetypes "cosmossdk.io/store/types"
	"github.com/cardano-foundation/cardano-ibc-incubator/cosmos/cardano-probabilistic-light-client-core/mithril"
)

// Every client starts from a stake table that Mithril certified, never from
// one that only a response window protects. A client bootstrapped in epoch C
// is created with Mithril's anchor for epoch C-1. Its bootstrap completes only
// with the certificate signed in C-1 that certifies the distribution electing
// epoch C's leaders, and only if that distribution's Merkle root equals the
// root of the bootstrap table. The table is then usable at once, and the
// anchor moves to epoch C.

// requireBootstrapAnchor rejects a new client without the anchor for the epoch
// before its checkpoint.
func (cs *ClientState) requireBootstrapAnchor() error {
	anchor, ok := cs.mithrilAnchor()
	if !ok || anchor.Epoch+1 != cs.CurrentEpoch {
		return errorsmod.Wrapf(ErrIBCInvalidClient, "a client bootstrapped in epoch %d needs the Mithril anchor for epoch %d", cs.CurrentEpoch, cs.CurrentEpoch-1)
	}
	return cs.validateMithrilAnchor()
}

// certifyBootstrapStake verifies the certificate for the bootstrap table under
// stake, records its root and makes the table usable without a response
// window.
func (cs *ClientState) certifyBootstrapStake(ctx Context, private, shared storetypes.KVStore, scope [32]byte, stake SnapshotRoot, certificate []byte) error {
	if err := cs.requireBootstrapAnchor(); err != nil {
		return err
	}
	if err := validateBootstrapCertificate(certificate); err != nil {
		return err
	}
	if ctx.ConsumeGas != nil {
		ctx.ConsumeGas(MithrilCertificateVerificationGas, "Mithril certificate verification")
	}
	root, err := stakeTableMithrilRoot(shared, scope, stake)
	if err != nil {
		return err
	}
	anchor, _ := cs.mithrilAnchor()
	next, err := mithril.VerifyBootstrapStake(anchor, certificate, cs.CurrentEpoch, root)
	if err != nil {
		return errorsmod.Wrap(ErrInvalidHeader, err.Error())
	}
	private.Set(mithrilStakeRootKey(cs.VerificationGeneration, cs.CurrentEpoch), []byte(root))
	cs.MithrilEpoch = next.Epoch
	cs.MithrilAggregateVerificationKey = next.AggregateVerificationKey
	cs.MithrilProtocolParametersHash = next.ProtocolParametersHash
	// Mithril authenticates the table, so it needs no response window. It
	// becomes usable after the next committed block.
	now := ctx.BlockTime().UnixNano()
	if now <= 0 {
		return fmt.Errorf("bootstrap needs a positive block time")
	}
	cs.EpochContextChallenges = []*EpochContextChallenge{{Epoch: cs.CurrentEpoch, UsableAfterUnixNs: uint64(now)}}
	ctx.emitEvent("mithril_stake_certified",
		newEventAttribute("leader_epoch", strconv.FormatUint(cs.CurrentEpoch, 10)),
		newEventAttribute("merkle_root", root),
	)
	return nil
}

func validateBootstrapCertificate(certificate []byte) error {
	if len(certificate) == 0 || len(certificate) > MaxMithrilCertificateBytes {
		return errorsmod.Wrapf(ErrInvalidHeader, "bootstrap needs a Mithril certificate of at most %d bytes", MaxMithrilCertificateBytes)
	}
	return nil
}

// stakeTableMithrilRoot computes the Merkle root Mithril certifies for a
// sealed stake table.
func stakeTableMithrilRoot(store storetypes.KVStore, scope [32]byte, stake SnapshotRoot) (string, error) {
	if stake.Rows == 0 || stake.Rows > MaxStakeEntries {
		return "", fmt.Errorf("bootstrap stake table must have 1 to %d pools", MaxStakeEntries)
	}
	entries := make([]mithril.StakeEntry, 0, stake.Rows)
	_, err := NewSnapshotMap(store, scope, snapshotStake).Visit(stake, nil, int(stake.Rows), func(key, value []byte) error {
		if len(value) != 8 {
			return fmt.Errorf("invalid sealed stake amount")
		}
		name, err := poolName(key)
		if err != nil {
			return err
		}
		entries = append(entries, mithril.StakeEntry{PoolID: name, Stake: binary.BigEndian.Uint64(value)})
		return nil
	})
	if err != nil {
		return "", err
	}
	if uint64(len(entries)) != stake.Rows {
		return "", fmt.Errorf("bootstrap stake table has %d of its %d pools", len(entries), stake.Rows)
	}
	return mithril.StakeDistributionRoot(entries)
}

// BootstrapStakeTable returns the stake table a trusted client starts from,
// which Mithril must have certified.
func BootstrapStakeTable(client *ClientState) ([]mithril.StakeEntry, error) {
	contexts, err := client.normalizedEpochContexts()
	if err != nil {
		return nil, err
	}
	current := epochContextByEpoch(contexts, client.CurrentEpoch)
	if current == nil {
		return nil, fmt.Errorf("trusted client has no epoch %d stake table", client.CurrentEpoch)
	}
	entries := make([]mithril.StakeEntry, 0, len(current.StakeDistribution))
	for _, entry := range current.StakeDistribution {
		entries = append(entries, mithril.StakeEntry{PoolID: entry.PoolId, Stake: entry.Stake})
	}
	return entries, nil
}

// AnchorToMithril prepares a trusted bootstrap client from an aggregator. It
// sets the anchor for the epoch before the client's checkpoint and returns
// the certificate that completes its bootstrap, after checking Mithril's
// distribution against the client's stake table.
func AnchorToMithril(client *ClientState, aggregator string) ([]byte, error) {
	entries, err := BootstrapStakeTable(client)
	if err != nil {
		return nil, err
	}
	bootstrap, err := mithril.FetchBootstrapStake(aggregator, client.CurrentEpoch, entries)
	if err != nil {
		return nil, err
	}
	client.MithrilEpoch = bootstrap.Anchor.Epoch
	client.MithrilAggregateVerificationKey = bootstrap.Anchor.AggregateVerificationKey
	client.MithrilProtocolParametersHash = bootstrap.Anchor.ProtocolParametersHash
	return bootstrap.Certificate, nil
}
