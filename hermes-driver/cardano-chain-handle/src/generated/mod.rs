// Generated protobuf code from Gateway proto definitions
// This module contains the gRPC client stubs and message types

#![allow(clippy::all)]
#![allow(warnings)]

// IBC Core modules
pub mod ibc {
    pub mod core {
        pub mod client {
            pub mod v1 {
                include!("ibc.core.client.v1.rs");
            }
        }
        pub mod connection {
            pub mod v1 {
                include!("ibc.core.connection.v1.rs");
            }
        }
        pub mod channel {
            pub mod v1 {
                include!("ibc.core.channel.v1.rs");
            }
        }
        pub mod commitment {
            pub mod v1 {
                include!("ibc.core.commitment.v1.rs");
            }
        }
        pub mod types {
            pub mod v1 {
                include!("ibc.core.types.v1.rs");
            }
        }
    }
    // Cardano-specific modules
    pub mod cardano {
        pub mod v1 {
            include!("ibc.cardano.v1.rs");
        }
    }
}

// Cosmos modules
pub mod cosmos {
    pub mod base {
        pub mod query {
            pub mod v1beta1 {
                include!("cosmos.base.query.v1beta1.rs");
            }
        }
    }
    pub mod upgrade {
        pub mod v1beta1 {
            include!("cosmos.upgrade.v1beta1.rs");
        }
    }
    pub mod ics23 {
        pub mod v1 {
            include!("cosmos.ics23.v1.rs");
        }
    }
}

// Google API
pub mod google {
    pub mod api {
        include!("google.api.rs");
    }
}

// Cosmos proto
include!("cosmos_proto.rs");

