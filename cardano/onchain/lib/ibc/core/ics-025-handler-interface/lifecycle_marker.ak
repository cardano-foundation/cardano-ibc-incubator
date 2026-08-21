use ibc/auth.{AuthToken}

/// Fixed receipt token minted once for each Host transition delegated to the
/// lifecycle companion policy. All receipts remain on the singleton Host UTxO,
/// so the asset-map size stays constant while the quantity advances.
pub const lifecycle_marker_token_name = "ibc_lifecycle"

/// The Host redeemer selects the lifecycle operation. The mint redeemer keeps
/// core cleanup distinct from transfer cleanup and, for transfer branches,
/// binds the policy-authenticated port and capability-token registration.
pub type LifecycleMarkerRedeemer {
  AuthorizeLifecycle
  AuthorizeTransferChannelReclaim {
    port_id: ByteArray,
    port_token: AuthToken,
    module_token: AuthToken,
  }
  AuthorizeTransferModuleReclaim {
    port_id: ByteArray,
    port_token: AuthToken,
    module_token: AuthToken,
  }
}

pub type LifecycleCreationMarkerRedeemer {
  AuthorizeCreation
}

/// Authorizes one ordinary Host root transition. The operational policy
/// decodes the Host redeemer and validates the exact branch-specific Merkle
/// update, so this constructor deliberately carries no duplicate branch data.
pub type LifecycleOperationalMarkerRedeemer {
  AuthorizeOperation
}

/// Authorizes one HandlePacket root transition. Packet commitment logic is
/// isolated so both operational companions fit the reference-script limit.
pub type LifecyclePacketMarkerRedeemer {
  AuthorizePacket
}
