use std::path::Path;

use crate::{logger, start as relayer_start};

pub fn run_create_client(
    project_root_path: &Path,
    host_chain: &str,
    reference_chain: &str,
) -> Result<(), String> {
    let relayer_path = project_path_chain(project_root_path);

    match relayer_start::hermes_create_client(&relayer_path, host_chain, reference_chain) {
        Ok(msg) => logger::log(&msg),
        Err(error) => {
            return Err(format!("Failed to create client: {}", error));
        }
    }

    Ok(())
}

pub fn run_create_connection(
    project_root_path: &Path,
    a_chain: &str,
    b_chain: &str,
) -> Result<(), String> {
    let relayer_path = project_path_chain(project_root_path);

    match relayer_start::hermes_create_connection(&relayer_path, a_chain, b_chain) {
        Ok(msg) => logger::log(&msg),
        Err(error) => {
            return Err(format!("Failed to create connection: {}", error));
        }
    }

    Ok(())
}

pub fn run_create_channel(
    project_root_path: &Path,
    a_chain: &str,
    b_chain: &str,
    a_port: &str,
    b_port: &str,
) -> Result<(), String> {
    let relayer_path = project_path_chain(project_root_path);

    match relayer_start::hermes_create_channel(&relayer_path, a_chain, b_chain, a_port, b_port) {
        Ok(msg) => logger::log(&msg),
        Err(error) => {
            return Err(format!("Failed to create channel: {}", error));
        }
    }

    Ok(())
}

fn project_path_chain(project_root_path: &Path) -> std::path::PathBuf {
    project_root_path.join("relayer")
}
