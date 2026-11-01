use cardano/address.{Address}
use ibc/auth.{AuthToken}
use ibc/client/ics_007_tendermint_client/cometbft/signed_header.{SignedHeader}
use ibc/client/ics_007_tendermint_client/height.{Height}

pub const max_validators = 256

pub const max_records = 2

pub const max_signers = 24

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
  /// Reserved marker. Full misses use a staged receipt to refresh the cache.
  Full { leaves: List<Leaf> }
  Powers {
    old_root: ByteArray,
    leaves: List<PowerChange>,
    siblings: List<ByteArray>,
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

/// Target leaves and signatures are in the same strictly increasing order.
/// A Powers transition discloses their union with changed leaves and boundary
/// neighbors. It authenticates both roots and old signer powers together, so
/// target_siblings, trusted and trusted_siblings must then be empty.
/// With no transition, cached roots use the separate membership witnesses.
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
