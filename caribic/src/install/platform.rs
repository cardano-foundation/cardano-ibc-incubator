use std::env;

#[derive(Debug)]
pub enum HostOs {
    MacOs,
    Linux,
    Unsupported(String),
}

pub fn detect_host_os() -> HostOs {
    match env::consts::OS {
        "macos" => HostOs::MacOs,
        "linux" => HostOs::Linux,
        other => HostOs::Unsupported(other.to_string()),
    }
}
