// Cardano ChainHandle implementation for Hermes relayer
// This crate provides the bridge between Hermes and the Cardano Gateway

pub mod chain_handle;
pub mod config;
pub mod error;
pub mod gateway_client;
pub mod keyring;
pub mod signer;
pub mod types;

// Generated protobuf code
pub mod generated;

// Re-exports for convenience
pub use chain_handle::CardanoChainHandle;
pub use error::{Error, Result};
pub use gateway_client::GatewayClient;
pub use keyring::CardanoKeyring;
pub use signer::CardanoSigner;

