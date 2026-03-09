use serde_json::Value;

use crate::{logger, start::run_hermes_command};

pub fn run_list_clients(chain: &str) -> Result<(), String> {
    let output = run_hermes_command(&["--json", "query", "clients", "--host-chain", chain])
        .map_err(|error| format!("Failed to query clients on '{}': {}", chain, error))?;

    if !output.status.success() {
        let stdout = String::from_utf8_lossy(&output.stdout);
        let stderr = String::from_utf8_lossy(&output.stderr);
        let detailed_error = parsed_query_error(stdout.as_ref())
            .or_else(|| parsed_query_error(stderr.as_ref()))
            .or_else(|| {
                let stderr = stderr.trim();
                if stderr.is_empty() {
                    None
                } else {
                    Some(stderr.to_string())
                }
            })
            .or_else(|| {
                let stdout = stdout.trim();
                if stdout.is_empty() {
                    None
                } else {
                    Some(stdout.to_string())
                }
            })
            .unwrap_or_else(|| "Unknown Hermes query failure".to_string());

        return Err(format!(
            "Failed to query clients on '{}': {}",
            chain, detailed_error
        ));
    }

    let parsed_lines: Vec<Value> = String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter_map(|line| serde_json::from_str::<Value>(line).ok())
        .collect();

    // Hermes emits one JSON envelope per line. For `query clients` the final
    // successful line carries the batch in `result`, so prefer the last array we
    // see instead of assuming there is exactly one line of output.
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

fn parsed_query_error(raw_output: &str) -> Option<String> {
    // Hermes wraps many query failures in JSON lines like:
    // {"status":"error","result":"..."}
    // Parse that first so CLI users see the underlying relayer/gateway error
    // instead of a blank or overly generic stderr message.
    raw_output.lines().find_map(|line| {
        let parsed = serde_json::from_str::<Value>(line).ok()?;
        if parsed.get("status").and_then(Value::as_str) != Some("error") {
            return None;
        }
        parsed
            .get("result")
            .and_then(Value::as_str)
            .map(str::to_string)
    })
}
