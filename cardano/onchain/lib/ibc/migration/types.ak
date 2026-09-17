use cardano/address.{Address}
use ibc/auth.{AuthToken}
use ibc/core/ics_025_handler_interface/host_state.{ModuleRegistration}

// Ordered roles are part of the immutable migration ABI.
pub const host_role = 0

pub const client_role = 1

pub const connection_role = 2

pub const channel_role = 3

pub const transfer_role = 4

pub const role_count = 5

pub const registry_token_name = "ibc_implementation_registry"

pub const migration_spend_tag = 100

pub const minimum_delay_ms = 86_400_000

pub type Governance {
  signers: List<ByteArray>,
  quorum: Int,
  delay_ms: Int,
}

pub type Implementation {
  generation: Int,
  // Full addresses, including stake credentials. Indexes are the roles above.
  addresses: List<Address>,
  // Digest of canonical fixed-policy/script inventory and compatibility profile.
  compatibility: ByteArray,
}

pub type FixedIdentity {
  client_policy: ByteArray,
  connection_policy: ByteArray,
  channel_policy: ByteArray,
  escrow_policy: ByteArray,
  reference_holder: Address,
}

// A small view for normal operations. The registry NFT's immutable custody
// establishes full datum validity; wrappers need only these immutable fields.
pub type OperationalIdentity {
  client_policy: ByteArray,
  connection_policy: ByteArray,
  channel_policy: ByteArray,
  escrow_policy: ByteArray,
}

pub type OperationalImplementation {
  generation: Int,
  addresses: List<Data>,
}

pub type ActiveRegistry {
  preparing: Bool,
  host_policy: ByteArray,
  identity: OperationalIdentity,
  current: OperationalImplementation,
}

pub type Counts {
  clients: Int,
  connections: Int,
  channels: Int,
}

pub type Proposal {
  Replace {
    source_generation: Int,
    nonce: Int,
    target: Implementation,
    maximum: Counts,
    escrow_inventory: ByteArray,
  }
  Rotate { nonce: Int, governance: Governance }
}

pub type Phase {
  Ready
  Proposed { proposal: Proposal, ready_at: Int, expires_at: Int }
  Moving {
    target: Implementation,
    limits: Counts,
    next: Counts,
    registration: ModuleRegistration,
    escrow_remaining: ByteArray,
    module_moved: Bool,
  }
}

pub type Registry {
  token: AuthToken,
  host_policy: ByteArray,
  identity: FixedIdentity,
  governance: Governance,
  nonce: Int,
  current: Implementation,
  phase: Phase,
}

pub type RegistryRedeemer {
  Propose { proposal: Proposal, expires_at: Int }
  Cancel
  RotateAuthority
  Begin
  MoveCore { role: Int }
  MoveTransferRoot
  MoveEscrow { siblings: List<ByteArray> }
  Activate { port_siblings: List<ByteArray> }
}
