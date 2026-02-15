use crate::{logger, start as relayer_start};

/// Runs a create action with consistent logging and error formatting.
fn run_create_action<F>(action_label: &str, action: F) -> Result<(), String>
where
    F: FnOnce() -> Result<String, Box<dyn std::error::Error>>,
{
    match action() {
        Ok(msg) => logger::log(&msg),
        Err(error) => return Err(format!("Failed to {}: {}", action_label, error)),
    }
    Ok(())
}

/// Creates an IBC client on `host_chain` using `reference_chain` as the trusted source.
pub fn run_create_client(
    _project_root_path: &std::path::Path,
    host_chain: &str,
    reference_chain: &str,
) -> Result<(), String> {
    run_create_action("create client", || {
        relayer_start::hermes_create_client(host_chain, reference_chain)
    })
}

/// Creates a connection between two chains using existing client ids resolved by Hermes.
pub fn run_create_connection(
    _project_root_path: &std::path::Path,
    a_chain: &str,
    b_chain: &str,
) -> Result<(), String> {
    run_create_action("create connection", || {
        relayer_start::hermes_create_connection(a_chain, b_chain)
    })
}

/// Creates a transfer channel between two chains and ports.
pub fn run_create_channel(
    _project_root_path: &std::path::Path,
    a_chain: &str,
    b_chain: &str,
    a_port: &str,
    b_port: &str,
) -> Result<(), String> {
    run_create_action("create channel", || {
        relayer_start::hermes_create_channel(a_chain, b_chain, a_port, b_port)
    })
}
