use serde_json::Value;
use std::{fs, path::Path, process::Command};

use crate::{config, logger::log};

fn execute_relayer_command_and_get_reponse(
    relayer_args: &Vec<&str>,
    json_path: &[&str],
) -> Result<String, Box<dyn std::error::Error>> {
    let configuration = config::get_config();
    let project_root_path = Path::new(&configuration.project_root);
    let relayer_base_args = vec!["compose", "exec", "relayer", "./bin/rly"];
    let relayer_output = Command::new("docker")
        .current_dir(project_root_path.join("relayer"))
        .args(relayer_base_args)
        .args(relayer_args)
        .output()
        .map_err(|error| format!("Failed to execute relayer command: {}", error.to_string()))?
        .stdout;

    let relayer_output_str = std::str::from_utf8(&relayer_output)
        .map_err(|error| format!("Failed to parse relayer output: {}", error.to_string()))?;
    let json: Value = serde_json::from_str(relayer_output_str).map_err(|error| {
        format!(
            "Failed to parse relayer output as JSON: {}",
            error.to_string()
        )
    })?;
    let mut response = &json;

    for key in json_path {
        response = response.get(key).ok_or("Key not found")?;
    }
    response
        .as_str()
        .map(String::from)
        .ok_or_else(|| "Value is not a string".into())
}

fn extract_channel_id(
    relayer_args: &Vec<&str>,
    field_path: &[&str],
) -> Result<String, Box<dyn std::error::Error>> {
    let configuration = config::get_config();
    let project_root_path = Path::new(&configuration.project_root);
    let relayer_base_args = vec!["compose", "exec", "relayer", "./bin/rly"];
    let relayer_output = Command::new("docker")
        .current_dir(project_root_path.join("relayer"))
        .args(relayer_base_args)
        .args(relayer_args)
        .output()
        .map_err(|error| format!("Failed to execute relayer command: {}", error.to_string()))?
        .stdout;
    let relayer_output_str = std::str::from_utf8(&relayer_output)
        .map_err(|error| format!("Failed to parse relayer output: {}", error.to_string()))?;
    let json: Value = serde_json::from_str(relayer_output_str).map_err(|error| {
        format!(
            "Failed to parse relayer output as JSON: {}",
            error.to_string()
        )
    })?;

    if let Some(array) = json.as_array() {
        for item in array {
            if let Some(state) = item.get("state") {
                if state == "STATE_OPEN" {
                    let mut current_value = item;
                    for key in field_path {
                        current_value = current_value.get(key).ok_or("Key not found")?;
                    }
                    if let Some(channel_id_str) = current_value.as_str() {
                        return Ok(channel_id_str.to_string());
                    }
                }
            }
        }
    }

    Err("No open channel found".into())
}

pub fn transfer_tokens() -> Result<(), Box<dyn std::error::Error>> {
    let path = "demo";
    let amount1 = "2000stake";

    let configuration = config::get_config();
    let project_root_path = Path::new(&configuration.project_root);
    let handler_path = project_root_path.join("cardano/deployments/handler.json");

    let data = fs::read_to_string(handler_path)?;
    let json: Value = serde_json::from_str(&data)?;

    if let Some(token_name) = json.get("tokens").and_then(|tokens| tokens.get("mock")) {
        let amount2 = format!("1000-{}", token_name);

        let src_chain_name = "ibc-0";
        let src_public_key_hash = "247570b8ba7dc725e9ff37e9757b8148b4d5a125958edac2fd4417b8";

        let dst_chain_name = "ibc-1";
        let dst_address = "cosmos1ycel53a5d9xk89q3vdr7vm839t2vwl08pl6zk6";

        let destionation_connection_id = execute_relayer_command_and_get_reponse(
            &vec!["config", "show", "--json"],
            &["paths", path, "dst", "connection-id"],
        )?;
        let source_channel_id = extract_channel_id(
            &vec![
                "query",
                "connection-channels",
                dst_chain_name,
                destionation_connection_id.as_str(),
                "--reverse",
                "--limit",
                "1",
            ],
            &["counterparty", "channel_id"],
        )?;
        let destination_channel_id = extract_channel_id(
            &vec![
                "query",
                "connection-channels",
                dst_chain_name,
                destionation_connection_id.as_str(),
                "--reverse",
                "--limit",
                "1",
            ],
            &["channel_id"],
        )?;

        log(&format!(
            "Transfer {} from {} to {}",
            amount1, src_chain_name, dst_chain_name
        ));

        let configuration = config::get_config();
        let project_root_path = Path::new(&configuration.project_root);
        let relayer_base_args = vec!["compose", "exec", "relayer", "./bin/rly"];
        let relayer_transfer_output = Command::new("docker")
            .current_dir(project_root_path.join("relayer"))
            .args(&relayer_base_args)
            .args(&[
                "transact",
                "transfer",
                dst_chain_name,
                src_chain_name,
                amount1,
                src_public_key_hash,
                destination_channel_id.as_str(),
                "--path",
                path,
                "--timeout-time-offset",
                "1h",
            ])
            .output()
            .map_err(|error| format!("Failed to execute relayer command: {}", error.to_string()))?;

        if relayer_transfer_output.status.success() {
            log(&format!(
                "Transfer {} from {} to {} successful",
                amount1, src_chain_name, dst_chain_name
            ));

            let relayer_transfer_output = Command::new("docker")
                .current_dir(project_root_path.join("relayer"))
                .args(&relayer_base_args)
                .args(&[
                    "transact",
                    "transfer",
                    src_chain_name,
                    dst_chain_name,
                    amount2.as_str(),
                    dst_address,
                    source_channel_id.as_str(),
                    "--path",
                    path,
                    "--timeout-time-offset",
                    "1h",
                ])
                .output()
                .map_err(|error| {
                    format!("Failed to execute relayer command: {}", error.to_string())
                })?;

            if relayer_transfer_output.status.success() {
                log(&format!(
                    "Transfer {} from {} to {} successful",
                    amount2, dst_chain_name, src_chain_name
                ));
                Ok(())
            } else {
                Err(format!(
                    "Failed to transfer {} from {} to {}",
                    amount2, dst_chain_name, src_chain_name
                )
                .into())
            }
        } else {
            Err(format!(
                "Failed to transfer {} from {} to {}",
                amount1, src_chain_name, dst_chain_name
            )
            .into())
        }
    } else {
        Err("Failed to get token name from handler.json".into())
    }
}

/*
pub fn swap_tokens() {
    // NOT IMPLEMENTED YET
}

pub fn register_cardano_stake_pool() {
    // NOT IMPLEMENTED YET
}

pub fn register_cosmos_validator() {
    // NOT IMPLEMENTED YET
}

pub fn deregister_cardano_stake_pool() {
    // NOT IMPLEMENTED YET
}

pub fn deregister_cosmos_validator() {
    // NOT IMPLEMENTED YET
}
*/
