use cardano/address.{Address}
use ibc/auth.{AuthToken}
use ibc/client/ics_007_tendermint_client/cometbft/signed_header.{SignedHeader}
use ibc/client/ics_007_tendermint_client/height.{Height}

pub const max_validators = 256

pub const max_records = 2

pub const max_signers = 45

pub type Record {
  root: ByteArray,
  count: Int,
  total_power: Int,
}

/// Addresses and proposer priorities are not part of the CometBFT leaf.
pub type Leaf {
  index: Int,
  pubkey: ByteArray,
  power: Int,
}

pub type PowerChange {
  index: Int,
  pubkey: ByteArray,
  old_power: Int,
  new_power: Int,
}

pub type SetUpdate {
  /// Full target rows contain key32 || unsigned powerBE8. Old references are
  /// tag00 || target-index1 || powerBE8 or tag01 || prior-key32 || powerBE8.
  /// The verifier derives every hash and total from these exact row formats.
  Full {
    leaves: ByteArray,
    trusted: ByteArray,
    signers: List<Int>,
    pubkey_order: List<Int>,
  }
  Powers {
    old_root: ByteArray,
    leaves: List<PowerChange>,
    siblings: List<ByteArray>,
    signers: List<Int>,
  }
}

pub type CacheDatum {
  token: AuthToken,
  client_token: AuthToken,
  client_address: Address,
  records: List<Record>,
}

pub type MintCache {
  InitializeCache {
    client_token: AuthToken,
    leaves: List<Leaf>,
    additional_set: List<Leaf>,
  }
  RetireCache { client_token: AuthToken }
}

/// With no set transition, target leaves and signatures use the same strictly
/// increasing order and cached roots use separate membership witnesses.
/// Powers and Full carry their signer positions inside the transition. Their
/// top-level target, target_siblings, trusted and trusted_siblings are empty.
/// Powers authenticates the union of signers, changed leaves and boundary
/// neighbors against both roots. Full authenticates complete target and old
/// sets and proves target key uniqueness with pubkey_order.
pub type Update {
  cache_token: AuthToken,
  signed_header: SignedHeader,
  trusted_height: Height,
  target: List<Leaf>,
  target_siblings: List<ByteArray>,
  trusted: List<Leaf>,
  trusted_siblings: List<ByteArray>,
  sets: List<SetUpdate>,
  history_siblings: List<ByteArray>,
}

/// Keep the new witness out of administrative and staged redeemer decoders.
/// The first six tags are reserved for the existing staged ABI. Only tag six
/// is decoded as this type. Other tags go to the existing staged decoder.
pub type CachedClientRedeemer {
  ReservedFinalizeUpdate
  ReservedDirectUpdate
  ReservedRecoverClient
  ReservedFinalizeMisbehaviour
  ReservedReclaimClient
  ReservedUpgradeClient
  CachedUpdate { update: Update }
}
