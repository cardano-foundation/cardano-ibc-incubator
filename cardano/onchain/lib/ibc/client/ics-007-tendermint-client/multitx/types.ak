use aiken/crypto.{VerificationKeyHash}
use cardano/transaction.{OutputReference}
use ibc/auth.{AuthToken}
use ibc/client/ics_007_tendermint_client/cometbft/block/block_id.{BlockID}
use ibc/client/ics_007_tendermint_client/cometbft/block/commit_sig.{CommitSig}
use ibc/client/ics_007_tendermint_client/cometbft/block/header.{TmHeader}
use ibc/client/ics_007_tendermint_client/cometbft/tm_validator.{Validator}
use ibc/client/ics_007_tendermint_client/consensus_state.{ConsensusState}
use ibc/client/ics_007_tendermint_client/height.{Height}
use ibc/client/ics_007_tendermint_client/multitx/merkle_accumulator.{
  MerkleAccumulator,
}
use ibc/client/ics_007_tendermint_client/types/unchecked_rational.{
  UncheckedRational,
}

/// Keep every verification transaction comfortably below the ledger execution
/// budget. This is a consensus rule, not merely an off-chain batching hint.
pub const max_batch_size = 6

/// Bound the session datum's trusted-validator bitmap and total work per update.
/// The first protocol version deliberately targets validator sets up to 256.
pub const max_validator_count = 256

/// CometBFT's `MaxTotalVotingPower` (`MaxInt64 / 8`).
pub const max_total_voting_power = 1_152_921_504_606_846_975

/// The part of a CometBFT commit shared by every signature. Keeping signatures
/// out of the session datum is what makes the initial transaction compact.
pub type CommitCore {
  height: Int,
  round: Int,
  block_id: BlockID,
}

/// Immutable statement verified by a multi-transaction update session.
///
/// The current client datum is deliberately not spent when this plan is made.
/// Finalization must bind these claimed client parameters and trusted consensus
/// state to the then-current authenticated client UTxO.
pub type UpdatePlan {
  client_token: AuthToken,
  trusted_height: Height,
  trusted_consensus_state: ConsensusState,
  trust_level: UncheckedRational,
  trusting_period: Int,
  max_clock_drift: Int,
  header: TmHeader,
  commit: CommitCore,
  target_validator_count: Int,
  trusted_validator_count: Int,
}

/// RFC-6962 inclusion proof for one validator in the trusted validator set.
/// `validator.address` and `validator.proposer_priority` are checked/ignored as
/// appropriate; the CometBFT leaf itself commits pubkey and voting power.
pub type TrustedMembership {
  index: Int,
  trusted_validator: Validator,
  audit_path: List<ByteArray>,
}

/// One target validator and its position-aligned commit signature. For a
/// skipped-height update, a committing validator may additionally prove that
/// the same public key occurs in the trusted validator set.
pub type TargetEntry {
  target_validator: Validator,
  commit_sig: CommitSig,
  trusted_membership: Option<TrustedMembership>,
}

/// Minimal state needed to enforce CometBFT's canonical validator ordering
/// across transaction boundaries. The full validator is intentionally not
/// retained in the session datum.
pub type ValidatorOrderKey {
  voting_power: Int,
  address: ByteArray,
}

pub type SessionPhase {
  /// An adjacent update needs only the target validator set's >2/3 commit.
  AdjacentTarget {
    target_accumulator: MerkleAccumulator,
    target_total_power: Int,
    target_signed_power: Int,
    last_target: Option<ValidatorOrderKey>,
  }
  /// A skipped-height update first authenticates and totals the complete
  /// trusted validator set against the stored consensus-state hash.
  NonAdjacentTrusted {
    trusted_accumulator: MerkleAccumulator,
    trusted_total_power: Int,
    last_trusted: Option<ValidatorOrderKey>,
  }
  /// Target signatures are then checked. Membership proofs let one already
  /// verified signature contribute the corresponding trusted voting power.
  NonAdjacentTarget {
    trusted_root: ByteArray,
    trusted_total_power: Int,
    target_accumulator: MerkleAccumulator,
    target_total_power: Int,
    target_signed_power: Int,
    trusted_signed_power: Int,
    used_trusted_indices: Int,
    last_target: Option<ValidatorOrderKey>,
  }
  /// Only this terminal phase may be consumed by the canonical client update.
  Complete {
    target_root: ByteArray,
    target_total_power: Int,
    target_signed_power: Int,
    trusted_root: Option<ByteArray>,
    trusted_total_power: Int,
    trusted_signed_power: Int,
  }
}

/// The session NFT authenticates every intermediate accumulator as a token
/// thread. The immutable plan and owner must be preserved byte-for-byte.
pub type SessionDatum {
  session_token: AuthToken,
  owner: VerificationKeyHash,
  plan: UpdatePlan,
  phase: SessionPhase,
}

pub type MintSessionRedeemer {
  MintSession {
    seed: OutputReference,
    owner: VerificationKeyHash,
    plan: UpdatePlan,
  }
  BurnSession { token_name: ByteArray }
}

pub type SpendSessionRedeemer {
  VerifyTrusted { validators: List<Validator> }
  VerifyTarget { entries: List<TargetEntry> }
  Finalize
  Cancel
}
