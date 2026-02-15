use std::path::Path;

use crate::{logger, start, KeysCommand};

/// Proxies Hermes key management commands through caribic.
pub fn run_keys(project_root_path: &Path, command: KeysCommand) -> Result<(), String> {
    let _ = project_root_path;

    match command {
        KeysCommand::Add {
            chain,
            mnemonic_file,
            key_name,
            overwrite,
        } => match start::hermes_keys_add(&chain, &mnemonic_file, key_name.as_deref(), overwrite) {
            Ok(msg) => logger::log(&msg),
            Err(error) => return Err(format!("Failed to add key: {}", error)),
        },
        KeysCommand::List { chain } => match start::hermes_keys_list(chain.as_deref()) {
            Ok(output) => logger::log(&output),
            Err(error) => return Err(format!("Failed to list keys: {}", error)),
        },
        KeysCommand::Delete { chain, key_name } => {
            match start::hermes_keys_delete(&chain, key_name.as_deref()) {
                Ok(msg) => logger::log(&msg),
                Err(error) => return Err(format!("Failed to delete key: {}", error)),
            }
        }
    }

    Ok(())
}
