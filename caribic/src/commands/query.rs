use serde_json::Value;

use crate::{logger, start::run_hermes_command};

pub fn run_list_clients(chain: &str) -> Result<(), String> {
    let output = run_hermes_command(&["--json", "query", "clients", "--host-chain", chain])
        .map_err(|error| format!("Failed to query clients on '{}': {}", chain, error))?;

    if !output.status.success() {
        return Err(format!(
            "Failed to query clients on '{}': {}",
            chain,
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }

    let parsed_lines: Vec<Value> = String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter_map(|line| serde_json::from_str::<Value>(line).ok())
        .collect();

    let client_entries = parsed_lines
        .iter()
        .filter_map(|entry| match entry.get("result") {
            Some(result) if result.is_array() => result.as_array(),
            _ => None,
        })
        .next_back()
        .cloned()
        .unwrap_or_default();

    logger::log(&format!("IBC clients on '{}':", chain));

    if client_entries.is_empty() {
        logger::log("  (none)");
        return Ok(());
    }

    for client in client_entries {
        let client_id = client
            .get("client_id")
            .and_then(Value::as_str)
            .unwrap_or("<unknown-client>");
        let tracked_chain = client
            .get("chain_id")
            .and_then(Value::as_str)
            .unwrap_or("<unknown-chain>");
        logger::log(&format!("  - {} -> {}", client_id, tracked_chain));
    }

    Ok(())
}
