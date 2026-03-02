use std::path::PathBuf;

use dirs::home_dir;

use crate::config;

pub(super) fn runtime() -> config::Injective {
    config::get_config().optional_chains.injective
}

pub(super) fn local_runtime() -> config::InjectiveLocal {
    runtime().local
}

pub(super) fn testnet_runtime() -> config::InjectiveTestnet {
    runtime().testnet
}

pub(super) fn resolve_home_relative_path(
    relative_path: &str,
) -> Result<PathBuf, Box<dyn std::error::Error>> {
    home_dir()
        .map(|path| path.join(relative_path))
        .ok_or_else(|| "Unable to resolve home directory".into())
}

pub(super) fn parse_port_from_url(url: &str, field_name: &str) -> Result<u16, String> {
    let parsed = reqwest::Url::parse(url)
        .map_err(|error| format!("Invalid Injective {} '{}': {}", field_name, url, error))?;
    parsed.port_or_known_default().ok_or_else(|| {
        format!(
            "Injective {} '{}' does not include a known port",
            field_name, url
        )
    })
}

pub(super) fn parse_port_from_socket_address(
    address: &str,
    field_name: &str,
) -> Result<u16, String> {
    let port_text = address
        .trim()
        .rsplit(':')
        .next()
        .ok_or_else(|| format!("Invalid Injective {} '{}'", field_name, address))?;

    port_text.parse::<u16>().map_err(|error| {
        format!(
            "Invalid Injective {} '{}' (cannot parse port): {}",
            field_name, address, error
        )
    })
}
