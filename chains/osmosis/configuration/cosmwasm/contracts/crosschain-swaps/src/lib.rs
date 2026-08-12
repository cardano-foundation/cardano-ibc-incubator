#![allow(clippy::useless_format)]

pub mod checks;
pub mod consts;
pub mod contract;
mod error;
mod execute;
pub mod ibc;
mod ibc_lifecycle;
pub mod msg;
pub mod state;
mod utils;

// `CosmwasmExt` expands against `crate::shim` for protobuf `Any` support.
pub use osmosis_std::shim;

pub use crate::error::ContractError;
pub use crate::msg::ExecuteMsg;
pub use crate::msg::FailedDeliveryAction;
