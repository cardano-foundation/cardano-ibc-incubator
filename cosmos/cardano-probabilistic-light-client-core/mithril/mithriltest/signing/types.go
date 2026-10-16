package signing

import (
	"github.com/cardano-foundation/cardano-ibc-incubator/cosmos/cardano-probabilistic-light-client-core/mithril/crypto"
)

// Generation uses the same public wire types as verification.
type (
	VerificationKey                 = crypto.VerificationKey
	Signature                       = crypto.Signature
	Stake                           = crypto.Stake
	Index                           = crypto.Index
	StmParameters                   = crypto.StmParameters
	StmVerificationKey              = crypto.StmVerificationKey
	StmSig                          = crypto.StmSig
	StmSigRegParty                  = crypto.StmSigRegParty
	StmAggrSig                      = crypto.StmAggrSig
	StmAggrVerificationKey          = crypto.StmAggrVerificationKey
	RegParty                        = crypto.RegParty
	MTLeaf                          = crypto.MTLeaf
	BatchPath                       = crypto.BatchPath
	MerkleTreeCommitmentBatchCompat = crypto.MerkleTreeCommitmentBatchCompat
)
