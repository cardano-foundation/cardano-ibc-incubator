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
        let details = query_client_details(chain, client_id);
        let suffix = format_client_details_suffix(details.as_ref());
        logger::log(&format!(
            "  - {} -> {}{}",
            client_id, tracked_chain, suffix
        ));
    }

    Ok(())
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ClientDetails {
    client_type: Option<String>,
    latest_height: Option<String>,
    status: Option<String>,
}

fn query_client_details(chain: &str, client_id: &str) -> Result<ClientDetails, String> {
    // `query clients` only gives the ids and tracked chain ids. Enrich the default
    // CLI output with the two most useful follow-up queries Hermes already exposes:
    // the concrete client state (type/latest height) and the client status.
    let client_state_output = run_hermes_command(&[
        "--json",
        "query",
        "client",
        "state",
        "--chain",
        chain,
        "--client",
        client_id,
    ])
    .map_err(|error| format!("failed to query client state: {}", error))?;

    if !client_state_output.status.success() {
        let stdout = String::from_utf8_lossy(&client_state_output.stdout);
        let stderr = String::from_utf8_lossy(&client_state_output.stderr);
        let detailed_error = parsed_query_error(stdout.as_ref())
            .or_else(|| parsed_query_error(stderr.as_ref()))
            .unwrap_or_else(|| "unknown client-state query failure".to_string());
        return Err(detailed_error);
    }

    let client_state = parsed_last_success_result(&String::from_utf8_lossy(&client_state_output.stdout))
        .ok_or_else(|| "missing client-state query result".to_string())?;

    let client_status_output = run_hermes_command(&[
        "--json",
        "query",
        "client",
        "status",
        "--chain",
        chain,
        "--client",
        client_id,
    ])
    .map_err(|error| format!("failed to query client status: {}", error))?;

    if !client_status_output.status.success() {
        let stdout = String::from_utf8_lossy(&client_status_output.stdout);
        let stderr = String::from_utf8_lossy(&client_status_output.stderr);
        let detailed_error = parsed_query_error(stdout.as_ref())
            .or_else(|| parsed_query_error(stderr.as_ref()))
            .unwrap_or_else(|| "unknown client-status query failure".to_string());
        return Err(detailed_error);
    }

    let client_status = parsed_last_success_result(&String::from_utf8_lossy(&client_status_output.stdout))
        .ok_or_else(|| "missing client-status query result".to_string())?;

    Ok(ClientDetails {
        client_type: client_state
            .get("type")
            .and_then(Value::as_str)
            .map(str::to_string),
        latest_height: parse_latest_height(&client_state),
        status: client_status.as_str().map(str::to_string),
    })
}

fn format_client_details_suffix(details: Result<&ClientDetails, &String>) -> String {
    match details {
        Ok(details) => {
            let mut parts = Vec::new();
            if let Some(client_type) = &details.client_type {
                parts.push(client_type.clone());
            }
            if let Some(status) = &details.status {
                parts.push(status.clone());
            }
            if let Some(latest_height) = &details.latest_height {
                parts.push(format!("latest {}", latest_height));
            }

            if parts.is_empty() {
                String::new()
            } else {
                format!(" ({})", parts.join(", "))
            }
        }
        Err(error) => format!(" (details unavailable: {})", error),
    }
}

fn parse_latest_height(client_state: &Value) -> Option<String> {
    let latest_height = client_state.get("latest_height")?;
    let revision_number = latest_height.get("revision_number")?.as_u64()?;
    let revision_height = latest_height.get("revision_height")?.as_u64()?;
    Some(format!("{}-{}", revision_number, revision_height))
}

fn parsed_last_success_result(raw_output: &str) -> Option<Value> {
    raw_output.lines().rev().find_map(|line| {
        let parsed = serde_json::from_str::<Value>(line).ok()?;
        if parsed.get("status").and_then(Value::as_str) != Some("success") {
            return None;
        }
        parsed.get("result").cloned()
    })
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

#[cfg(test)]
mod tests {
    use super::{parse_latest_height, parsed_last_success_result};
    use serde_json::json;

    #[test]
    fn parse_latest_height_formats_revision_pair() {
        let client_state = json!({
            "latest_height": {
                "revision_number": 0,
                "revision_height": 1959,
            }
        });

        assert_eq!(parse_latest_height(&client_state).as_deref(), Some("0-1959"));
    }

    #[test]
    fn parsed_last_success_result_prefers_final_success_line() {
        let raw_output = r#"{"status":"success","result":{"type":"Tendermint"}}
{"status":"success","result":"Active"}"#;

        assert_eq!(
            parsed_last_success_result(raw_output),
            Some(json!("Active"))
        );
    }
}
