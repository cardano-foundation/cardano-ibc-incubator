use crate::logger::{self, verbose};
use std::path::Path;
use std::process::Command;

/// Run end-to-end integration tests to verify IBC functionality
/// 
/// Tests include:
/// - Handler UTXO contains ibc_state_root field
/// - Root changes after createClient
/// - Root changes after connectionOpenInit  
/// - Root changes after channelOpenInit
///
/// # Arguments
/// * `project_root` - Path to the project root directory
/// * `skip_setup` - If true, assumes services are already running
pub async fn run_integration_tests(
    project_root: &Path,
    skip_setup: bool,
) -> Result<(), Box<dyn std::error::Error>> {
    logger::log("Running IBC Integration Tests\n");

    if !skip_setup {
        logger::log("Starting services (this may take a while)...");
        // TODO: Call start::start_local_cardano_network and other setup functions
        // For now, we'll require manual setup
        return Err("Automatic setup not yet implemented. Please run 'caribic start all' first, then use 'caribic test --skip-setup'".into());
    }

    // Test 1: Verify services are running
    logger::log("Test 1: Verifying services are running...");
    verify_services_running(project_root)?;
    logger::log("PASS Test 1: All services are running\n");

    // Test 2: Query Handler UTXO and verify ibc_state_root exists
    logger::log("Test 2: Verifying Handler UTXO has ibc_state_root field...");
    let initial_root = query_handler_state_root(project_root)?;
    
    if initial_root.len() != 64 {
        return Err(format!(
            "Invalid ibc_state_root length: expected 64 chars (32 bytes hex), got {}",
            initial_root.len()
        )
        .into());
    }
    
    logger::log(&format!("   Initial root: {}...", &initial_root[..16]));
    logger::log("PASS Test 2: Handler UTXO has valid ibc_state_root\n");

    // Test 3: Create a client and verify root changes
    logger::log("Test 3: Creating client and verifying root changes...");
    create_test_client(project_root)?;
    
    // Wait for transaction confirmation
    logger::verbose("   Waiting for transaction confirmation...");
    std::thread::sleep(std::time::Duration::from_secs(10));
    
    let root_after_client = query_handler_state_root(project_root)?;
    
    if root_after_client == initial_root {
        return Err("ibc_state_root did not change after createClient".into());
    }
    
    logger::log(&format!("   New root: {}...", &root_after_client[..16]));
    logger::log("PASS Test 3: Root changed after createClient\n");

    // Test 4: Create a connection and verify root changes
    logger::log("Test 4: Creating connection and verifying root changes...");
    
    // TODO: Implement connection creation via relayer
    logger::log("   SKIP Test 4: Connection creation not yet implemented\n");

    // Test 5: Create a channel and verify root changes
    logger::log("Test 5: Creating channel and verifying root changes...");
    
    // TODO: Implement channel creation via relayer
    logger::log("   SKIP Test 5: Channel creation not yet implemented\n");

    Ok(())
}

/// Verify that all required services are running
fn verify_services_running(project_root: &Path) -> Result<(), Box<dyn std::error::Error>> {
    // Check Cardano node using cardano-cli query tip
    let cardano_running = check_cardano_node_running(project_root);
    if !cardano_running {
        return Err("Cardano node is not running. Please run 'caribic start network' first.".into());
    }
    verbose("   Cardano node is running");

    // Check Gateway
    let gateway_running = check_service_health("http://127.0.0.1:5001/health");
    if !gateway_running {
        return Err("Gateway is not running. Please run 'caribic start bridge' first.".into());
    }
    verbose("   Gateway is running");

    // Check Mithril (optional)
    let mithril_running = check_service_health("http://127.0.0.1:8080/health");
    if !mithril_running {
        logger::verbose("   Mithril is not running (optional)");
    } else {
        verbose("   Mithril is running");
    }

    Ok(())
}

/// Check if Cardano node is running using cardano-cli query tip
fn check_cardano_node_running(project_root: &Path) -> bool {
    let cardano_dir = project_root.join("chains/cardano");
    let output = Command::new("docker")
        .arg("compose")
        .arg("exec")
        .arg("-T")
        .arg("cardano-node")
        .arg("cardano-cli")
        .arg("query")
        .arg("tip")
        .arg("--testnet-magic")
        .arg("42")
        .current_dir(&cardano_dir)
        .output();
    
    match output {
        Ok(result) => result.status.success(),
        Err(_) => false,
    }
}

/// Check if a service is healthy by querying its health endpoint
fn check_service_health(url: &str) -> bool {
    match reqwest::blocking::get(url) {
        Ok(response) => response.status().is_success(),
        Err(_) => false,
    }
}

/// Query the current ibc_state_root from the Handler UTXO
fn query_handler_state_root(project_root: &Path) -> Result<String, Box<dyn std::error::Error>> {
    // Read handler deployment info to get the handler token policy ID
    let deployment_path = project_root.join("cardano/offchain/deployments/handler.json");
    
    if !deployment_path.exists() {
        return Err("Handler deployment file not found. Please run 'caribic start bridge' first.".into());
    }

    let deployment_json = std::fs::read_to_string(&deployment_path)?;
    let deployment: serde_json::Value = serde_json::from_str(&deployment_json)?;
    
    let handler_token_policy = deployment["handlerAuthToken"]["policyId"]
        .as_str()
        .ok_or("handlerAuthToken.policyId not found in deployment")?;
    
    verbose(&format!("   Handler token policy: {}", handler_token_policy));

    // Query the Handler UTXO using cardano-cli inside the Docker container
    let cardano_dir = project_root.join("chains/cardano");
    
    // Get handler address from deployment
    let handler_address = deployment["modules"]["handler"]["address"]
        .as_str()
        .ok_or("modules.handler.address not found in deployment")?;
    
    verbose(&format!("   Handler address: {}", handler_address));

    // Query UTXOs at handler address using docker compose exec
    let output = Command::new("docker")
        .args(&[
            "compose", "exec", "-T", "cardano-node",
            "cardano-cli", "query", "utxo",
            "--address", handler_address,
            "--testnet-magic", "42",
            "--out-file", "/dev/stdout",
        ])
        .current_dir(&cardano_dir)
        .output()?;

    if !output.status.success() {
        return Err(format!(
            "Failed to query Handler UTXO: {}",
            String::from_utf8_lossy(&output.stderr)
        )
        .into());
    }

    let utxo_json = String::from_utf8(output.stdout)?;
    verbose(&format!("   Raw UTXO output: {}", utxo_json));

    // Parse UTXO JSON to find the Handler UTXO (the one with the handler token)
    let utxos: serde_json::Value = serde_json::from_str(&utxo_json)?;
    
    // Find UTXO with handler token
    let mut handler_datum: Option<&serde_json::Value> = None;
    
    for (_utxo_ref, utxo_data) in utxos.as_object().ok_or("Invalid UTXO JSON")? {
        if let Some(value) = utxo_data.get("value") {
            if let Some(tokens) = value.as_object() {
                if tokens.contains_key(handler_token_policy) {
                    // Found the Handler UTXO - get the inlineDatum object
                    if utxo_data.get("inlineDatum").is_some() {
                        handler_datum = Some(utxo_data);
                        break;
                    }
                }
            }
        }
    }

    let handler_utxo = handler_datum.ok_or("Handler UTXO not found or has no datum")?;
    
    // Extract the ibc_state_root from the inline datum
    // Structure: {constructor: 0, fields: [{constructor: 0, fields: [seq, seq, seq, ports, ibc_state_root]}, token]}
    let inline_datum = handler_utxo["inlineDatum"]
        .as_object()
        .ok_or("Invalid inlineDatum structure")?;
    
    let outer_fields = inline_datum["fields"]
        .as_array()
        .ok_or("Missing fields in inlineDatum")?;
    
    if outer_fields.len() < 1 {
        return Err("Invalid Handler datum structure: missing state field".into());
    }
    
    let state_obj = &outer_fields[0];
    let state_fields = state_obj["fields"]
        .as_array()
        .ok_or("Missing fields in HandlerState")?;
    
    if state_fields.len() < 5 {
        return Err("Invalid HandlerState: missing ibc_state_root field".into());
    }
    
    // Field 4 (index 4) is ibc_state_root
    let root_bytes = state_fields[4]["bytes"]
        .as_str()
        .ok_or("ibc_state_root not found or invalid")?;
    
    verbose(&format!("   Found ibc_state_root: {}...", &root_bytes[..16]));
    
    Ok(root_bytes.to_string())
}

/// Create a test client via the relayer
fn create_test_client(_project_root: &Path) -> Result<(), Box<dyn std::error::Error>> {
    logger::verbose("   Creating test client via relayer...");
    
    // TODO: Implement client creation via relayer
    // This would use the relayer CLI to create a client on Cardano
    // For now, return an error indicating this needs implementation
    
    Err("Client creation via relayer not yet implemented. This requires:\n\
         1. Configuring the relayer with test chain info\n\
         2. Calling 'rly tx client cardano test-chain'\n\
         3. Waiting for transaction confirmation".into())
}

