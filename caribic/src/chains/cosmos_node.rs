//! Shared runtime utilities for Cosmos-style chain adapters.

use std::path::PathBuf;

use dirs::home_dir;
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum CosmosNetworkKind {
    Local,
    Testnet,
    Mainnet,
}

impl CosmosNetworkKind {
    pub(crate) fn parse(raw_network: &str) -> Result<Self, String> {
        match raw_network {
            "local" => Ok(Self::Local),
            "testnet" => Ok(Self::Testnet),
            "mainnet" => Ok(Self::Mainnet),
            _ => Err(format!(
                "Unsupported Cosmos network '{}'. Expected one of: local, testnet, mainnet",
                raw_network
            )),
        }
    }
}

pub(crate) fn resolve_home_relative_path(
    relative_path: &str,
) -> Result<PathBuf, Box<dyn std::error::Error>> {
    home_dir()
        .map(|path| path.join(relative_path))
        .ok_or_else(|| "Unable to resolve home directory".into())
}
