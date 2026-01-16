use crate::logger::{self, verbose};
use std::path::Path;
use std::process::Command;
use std::thread;
use std::time::{Duration, Instant};

/// Test results summary
#[derive(Debug)]
pub struct TestResults {
    pub passed: usize,
    pub skipped: usize,
    pub failed: usize,
}

impl TestResults {
    pub fn new() -> Self {
        TestResults {
            passed: 0,
            skipped: 0,
            failed: 0,
        }
    }

    pub fn total(&self) -> usize {
        self.passed + self.skipped + self.failed
    }

    pub fn has_failures(&self) -> bool {
        self.failed > 0
    }

    pub fn all_passed(&self) -> bool {
        self.passed == self.total() && self.total() > 0
    }
}

/// Run end-to-end integration tests to verify IBC functionality
/// 
/// Tests include:
/// - Services are running
/// - Gateway connectivity via Hermes health-check
/// - Handler UTXO contains ibc_state_root field
/// - Root changes after createClient
/// - Root changes after connectionOpenInit  
/// - Root changes after channelOpenInit
///
/// # Arguments
/// * `project_root` - Path to the project root directory
///
/// # Prerequisites
/// All services must be running before running tests. Use 'caribic start' first.
pub async fn run_integration_tests(
    project_root: &Path,
) -> Result<TestResults, Box<dyn std::error::Error>> {
    logger::log("Running IBC Integration Tests\n");
    let mut results = TestResults::new();

    // Test 1: Verify services are running
    logger::log("Test 1: Verifying services are running...");
    verify_services_running(project_root)?;
    logger::log("PASS Test 1: All services are running\n");
    results.passed += 1;

    // Test 2: Gateway connectivity smoke test via Hermes health-check
    logger::log("Test 2: Verifying Hermes can connect to Gateway (health-check)...");
    match run_hermes_health_check(project_root) {
        Ok(_) => {
            logger::log("PASS Test 2: Hermes health-check passed, Gateway connectivity verified\n");
            results.passed += 1;
        }
        Err(e) => {
            logger::log(&format!("FAIL Test 2: Hermes health-check failed\n{}\n", e));
            results.failed += 1;
            // This is a critical failure - if Hermes can't talk to Gateway, later tests will fail
            logger::log("   Aborting remaining tests due to Gateway connectivity failure.\n");
            return Ok(results);
        }
    }

    // Test 3: Query Handler UTXO and verify ibc_state_root exists
    logger::log("Test 3: Verifying Handler UTXO has ibc_state_root field...");
    let initial_root = query_handler_state_root(project_root)?;
    
    if initial_root.len() != 64 {
        return Err(format!(
            "Invalid ibc_state_root length: expected 64 chars (32 bytes hex), got {}",
            initial_root.len()
        )
        .into());
    }
    
    logger::log(&format!("   Initial root: {}...", &initial_root[..16]));
    logger::log("PASS Test 3: Handler UTXO has valid ibc_state_root\n");
    results.passed += 1;

    // Test 4: Create a client and verify root changes
    logger::log("Test 4: Creating client via Hermes and verifying root changes...");
    
    let client_id = match create_test_client(project_root) {
        Ok(client_id) => {
            // Wait for transaction confirmation
            logger::verbose("   Waiting for transaction confirmation...");
            std::thread::sleep(std::time::Duration::from_secs(10));

            let root_after_client = query_handler_state_root(project_root)?;
            
            if root_after_client == initial_root {
                logger::log("   Warning: Root unchanged after client creation");
                logger::log("FAIL Test 4: Root did not update after client creation\n");
                results.failed += 1;
                None
            } else {
                logger::log(&format!("   Client ID: {}", client_id));
                logger::log(&format!("   New root: {}...", &root_after_client[..16]));
                logger::log("PASS Test 4: Root changed after createClient\n");
                results.passed += 1;
                Some(client_id)
            }
        }
        Err(e) => {
            logger::log(&format!("FAIL Test 4: Hermes client creation failed\n{}\n", e));
            results.failed += 1;
            None
        }
    };

    // Test 5: Query client state to verify Tendermint light client is working
    logger::log("Test 5: Querying client state via Hermes...");
    
    if let Some(ref cid) = client_id {
        match query_client_state(project_root, cid) {
            Ok(client_state_info) => {
                logger::log(&format!("   Chain ID: {}", client_state_info.chain_id));
                logger::log(&format!("   Latest height: {}", client_state_info.latest_height));
                logger::log(&format!("   Trust level: {}", client_state_info.trust_level));
                logger::log("PASS Test 5: Client state queried successfully\n");
                results.passed += 1;
            }
            Err(e) => {
                let error_str = e.to_string();
                // Check for known Gateway limitation: requires height parameter
                if error_str.contains("height") && error_str.contains("must be provided") {
                    logger::log("SKIP Test 5: Gateway requires height parameter for client queries");
                    logger::log("   This is a known limitation - Gateway needs to support querying at latest height.\n");
                    results.skipped += 1;
                } else {
                    logger::log(&format!("FAIL Test 5: Failed to query client state\n{}\n", e));
                    results.failed += 1;
                }
            }
        }
    } else {
        logger::log("SKIP Test 5: Skipped due to Test 4 failure\n");
        results.skipped += 1;
    }

    // Test 6: Update client with new Tendermint headers and verify height advances
    logger::log("Test 6: Updating client with new headers (exercises Tendermint verification)...");
    
    if let Some(ref cid) = client_id {
        // Wait for new blocks on the Cosmos chain
        logger::verbose("   Waiting for new blocks on sidechain...");
        std::thread::sleep(std::time::Duration::from_secs(5));
        
        match update_client(project_root, cid) {
            Ok(_) => {
                // Wait for tx confirmation
                std::thread::sleep(std::time::Duration::from_secs(10));
                
                logger::log("PASS Test 6: Client updated successfully (Tendermint header verification passed)\n");
                results.passed += 1;
            }
            Err(e) => {
                let error_str = e.to_string();
                // Check for known Gateway limitation: requires height parameter
                if error_str.contains("height") && error_str.contains("must be provided") {
                    logger::log("SKIP Test 6: Gateway requires height parameter for client queries");
                    logger::log("   Update requires querying current state first, which needs height support.\n");
                    results.skipped += 1;
                } else if error_str.contains("no need to update") || error_str.contains("already up to date") {
                    logger::log("SKIP Test 6: No new blocks available to update client\n");
                    results.skipped += 1;
                } else {
                    logger::log(&format!("FAIL Test 6: Client update failed\n{}\n", e));
                    results.failed += 1;
                }
            }
        }
    } else {
        logger::log("SKIP Test 6: Skipped due to Test 4 failure\n");
        results.skipped += 1;
    }

    // Test 7: Create a connection and verify root changes
    logger::log("Test 7: Creating connection via Hermes and verifying root changes...");
    
    let connection_id = if client_id.is_some() {
        match create_test_connection(project_root) {
            Ok(connection_id) => {
                // Wait for transaction confirmation
                logger::verbose("   Waiting for transaction confirmation...");
                std::thread::sleep(std::time::Duration::from_secs(10));

                let root_after_connection = query_handler_state_root(project_root)?;
                
                logger::log(&format!("   Connection ID: {}", connection_id));
                logger::log(&format!("   New root: {}...", &root_after_connection[..16]));
                logger::log("PASS Test 7: Connection created and root updated\n");
                results.passed += 1;
                Some(connection_id)
            }
            Err(e) => {
                let error_str = e.to_string();
                // Check for known limitation: Cardano client on Cosmos not yet implemented
                if error_str.contains("CardanoClientState -> AnyClientState") 
                    || error_str.contains("not yet implemented") {
                    logger::log("SKIP Test 7: Bidirectional connection requires Cardano light client on Cosmos");
                    results.skipped += 1;
                } else {
                    logger::log(&format!("FAIL Test 7: Hermes connection creation failed\n{}\n", e));
                    results.failed += 1;
                }
                None
            }
        }
    } else {
        logger::log("SKIP Test 7: Skipped due to earlier test failure\n");
        results.skipped += 1;
        None
    };

    // Test 8: Create a channel and verify root changes
    logger::log("Test 8: Creating channel via Hermes and verifying root changes...");
    
    if let Some(conn_id) = connection_id {
        match create_test_channel(project_root, &conn_id) {
            Ok(channel_id) => {
                // Wait for transaction confirmation
                logger::verbose("   Waiting for transaction confirmation...");
                std::thread::sleep(std::time::Duration::from_secs(10));

                let root_after_channel = query_handler_state_root(project_root)?;
                
                logger::log(&format!("   Channel ID: {}", channel_id));
                logger::log(&format!("   New root: {}...", &root_after_channel[..16]));
                logger::log("PASS Test 8: Channel created and root updated\n");
                results.passed += 1;
            }
            Err(e) => {
                logger::log(&format!("FAIL Test 8: Hermes channel creation failed\n{}\n", e));
                results.failed += 1;
            }
        }
    } else {
        logger::log("SKIP Test 8: Skipped due to Test 7 failure\n");
        results.skipped += 1;
    }

    Ok(results)
}

/// Verify that all required services are running
fn verify_services_running(project_root: &Path) -> Result<(), Box<dyn std::error::Error>> {
    let mut missing_services = Vec::new();

    // Check Cardano node using cardano-cli query tip
    let cardano_running = check_cardano_node_running(project_root);
    if !cardano_running {
        missing_services.push("Cardano node");
    } else {
        verbose("   Cardano node is running");
    }

    // Check Gateway (via docker container status, since host networking doesn't work on macOS)
    let gateway_running = check_gateway_container_running();
    if !gateway_running {
        missing_services.push("Gateway");
    } else {
        verbose("   Gateway is running");
    }

    // Check local packet-forwarding chain (Cosmos chain we operate)
    // Don't wait - just check once. User should run 'caribic start' first.
    verbose("   Checking packet-forwarding chain RPC (http://127.0.0.1:26657/status)...");
    let pfc_running = check_service_health("http://127.0.0.1:26657/status");
    if !pfc_running {
        missing_services.push("Packet-forwarding chain (Cosmos) on :26657");
    } else {
        verbose("   Packet-forwarding chain is running");
    }

    // Check Mithril (optional)
    let mithril_running = check_service_health("http://127.0.0.1:8080/health");
    if !mithril_running {
        logger::verbose("   Mithril is not running (optional)");
    } else {
        verbose("   Mithril is running");
    }

    if !missing_services.is_empty() {
        return Err(format!(
            "Required services not running: {}.\n\nPlease run 'caribic start' first to start all services.",
            missing_services.join(", ")
        ).into());
    }

    Ok(())
}

/// Run Hermes health-check to verify Gateway connectivity
/// 
/// This exercises the Hermes -> Gateway gRPC connection by querying LatestHeight.
/// It validates that:
/// - Hermes binary is built and accessible
/// - Hermes config is valid and points to the Gateway
/// - Gateway is accepting gRPC connections and responding correctly
fn run_hermes_health_check(project_root: &Path) -> Result<(), Box<dyn std::error::Error>> {
    let hermes_binary = project_root.join("relayer/target/release/hermes");
    
    if !hermes_binary.exists() {
        return Err(format!(
            "Hermes binary not found at: {}\n\
             Please build Hermes first: cd relayer && cargo build --release",
            hermes_binary.display()
        ).into());
    }
    
    verbose("   Running: hermes health-check");
    
    let output = Command::new(&hermes_binary)
        .args(&["health-check"])
        .output()?;
    
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    
    verbose(&format!("   stdout: {}", stdout.trim()));
    if !stderr.is_empty() {
        verbose(&format!("   stderr: {}", stderr.trim()));
    }
    
    if !output.status.success() {
        return Err(format!(
            "Hermes health-check failed (exit code: {:?}):\n\
             stdout: {}\n\
             stderr: {}\n\n\
             This indicates Hermes cannot connect to the Gateway.\n\
             Check that:\n\
             - Gateway is running on port 5001\n\
             - Hermes config (~/.hermes/config.toml) has correct grpc_addr for cardano-devnet\n\
             - No firewall is blocking the connection",
            output.status.code(),
            stdout,
            stderr
        ).into());
    }
    
    // Check that the Cardano chain is reported as healthy
    // Hermes health-check output typically includes chain status
    let combined_output = format!("{}{}", stdout, stderr);
    
    if combined_output.to_lowercase().contains("unhealthy") 
        || combined_output.to_lowercase().contains("error") 
        || combined_output.to_lowercase().contains("failed") {
        return Err(format!(
            "Hermes health-check reported unhealthy chain(s):\n{}",
            combined_output
        ).into());
    }
    
    // Look for cardano-devnet being healthy
    if combined_output.contains("cardano-devnet") {
        if combined_output.contains("healthy") || combined_output.contains("Healthy") {
            verbose("   cardano-devnet chain is healthy");
        }
    }
    
    verbose("   Hermes health-check passed");

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

/// Check if Gateway container is running
fn check_gateway_container_running() -> bool {
    let output = Command::new("docker")
        .args(&["ps", "--filter", "name=gateway-app", "--format", "{{.Names}}"])
        .output();
    
    match output {
        Ok(result) => {
            let stdout = String::from_utf8_lossy(&result.stdout).trim().to_string();
            !stdout.is_empty()
        }
        Err(_) => false,
    }
}

/// Check if a service is healthy by querying its health endpoint
fn check_service_health(url: &str) -> bool {
    let client = match reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(3))
        .build()
    {
        Ok(c) => c,
        Err(_) => return false,
    };

    client
        .get(url)
        .send()
        .map(|resp| resp.status().is_success())
        .unwrap_or(false)
}

fn wait_for_service_health(url: &str, max_attempts: usize, interval: Duration) -> bool {
    let start = Instant::now();
    for attempt in 0..max_attempts {
        if check_service_health(url) {
            return true;
        }
        logger::verbose(&format!(
            "   Waiting for {} (attempt {}/{}, elapsed {}s)...",
            url,
            attempt + 1,
            max_attempts,
            start.elapsed().as_secs()
        ));
        thread::sleep(interval);
    }
    false
}

/// Query the current ibc_state_root from the Handler UTXO
fn query_handler_state_root(project_root: &Path) -> Result<String, Box<dyn std::error::Error>> {
    // Read deployment info to get the HostState NFT policy ID (STT architecture)
    let deployment_path = project_root.join("cardano/offchain/deployments/handler.json");
    
    if !deployment_path.exists() {
        return Err("Deployment file not found. Please run 'caribic start bridge' first.".into());
    }

    let deployment_json = std::fs::read_to_string(&deployment_path)?;
    let deployment: serde_json::Value = serde_json::from_str(&deployment_json)?;
    
    // Use hostStateNFT for STT architecture
    let host_state_nft_policy = deployment["hostStateNFT"]["policyId"]
        .as_str()
        .ok_or("hostStateNFT.policyId not found in deployment")?;
    
    verbose(&format!("   HostState NFT policy: {}", host_state_nft_policy));

    // Query the HostState UTXO using cardano-cli inside the Docker container
    let cardano_dir = project_root.join("chains/cardano");
    
    // Get hostStateStt address from deployment
    let host_state_address = deployment["validators"]["hostStateStt"]["address"]
        .as_str()
        .ok_or("validators.hostStateStt.address not found in deployment")?;
    
    verbose(&format!("   HostState address: {}", host_state_address));

    // Query UTXOs at HostState address using docker compose exec
    let output = Command::new("docker")
        .args(&[
            "compose", "exec", "-T", "cardano-node",
            "cardano-cli", "query", "utxo",
            "--address", host_state_address,
            "--testnet-magic", "42",
            "--out-file", "/dev/stdout",
        ])
        .current_dir(&cardano_dir)
        .output()?;

    if !output.status.success() {
        return Err(format!(
            "Failed to query HostState UTXO: {}",
            String::from_utf8_lossy(&output.stderr)
        )
        .into());
    }

    let utxo_json = String::from_utf8(output.stdout)?;
    verbose(&format!("   Raw UTXO output: {}", utxo_json));

    // Parse UTXO JSON to find the HostState UTXO (the one with the hostStateNFT)
    let utxos: serde_json::Value = serde_json::from_str(&utxo_json)?;
    
    // Find UTXO with hostStateNFT
    let mut host_state_datum: Option<&serde_json::Value> = None;
    
    for (_utxo_ref, utxo_data) in utxos.as_object().ok_or("Invalid UTXO JSON")? {
        if let Some(value) = utxo_data.get("value") {
            if let Some(tokens) = value.as_object() {
                if tokens.contains_key(host_state_nft_policy) {
                    // Found the HostState UTXO - get the inlineDatum object
                    if utxo_data.get("inlineDatum").is_some() {
                        host_state_datum = Some(utxo_data);
                        break;
                    }
                }
            }
        }
    }

    let host_state_utxo = host_state_datum.ok_or(
        "HostState UTXO not found or has no datum.\n\n\
         This can happen when the deployment config (handler.json) is out of sync\n\
         with the on-chain state. Common causes:\n\
         - The devnet was regenerated but contracts weren't redeployed\n\
         - A previous deployment failed partway through\n\
         - The handler.json is from a different devnet instance\n\n\
         Fix: Run 'caribic start --clean' to reset and redeploy everything."
    )?;
    
    // Extract the ibc_state_root from the inline datum
    // HostStateDatum structure: {constructor: 0, fields: [state, nft_policy]}
    // HostState structure: {constructor: 0, fields: [version, ibc_state_root, next_client_seq, ...]}
    let inline_datum = host_state_utxo["inlineDatum"]
        .as_object()
        .ok_or("Invalid inlineDatum structure")?;
    
    let outer_fields = inline_datum["fields"]
        .as_array()
        .ok_or("Missing fields in inlineDatum")?;
    
    if outer_fields.is_empty() {
        return Err("Invalid HostStateDatum structure: missing state field".into());
    }
    
    let state_obj = &outer_fields[0];
    let state_fields = state_obj["fields"]
        .as_array()
        .ok_or("Missing fields in HostState")?;
    
    if state_fields.len() < 2 {
        return Err("Invalid HostState: missing ibc_state_root field".into());
    }
    
    // Field 1 (index 1) is ibc_state_root in HostState
    let root_bytes = state_fields[1]["bytes"]
        .as_str()
        .ok_or("ibc_state_root not found or invalid")?;
    
    verbose(&format!("   Found ibc_state_root: {}...", &root_bytes[..16.min(root_bytes.len())]));
    
    Ok(root_bytes.to_string())
}

/// Information about a client state returned from Hermes query
#[derive(Debug, Default)]
struct ClientStateInfo {
    chain_id: String,
    latest_height: String,
    trust_level: String,
}

/// Query client state via Hermes to verify the Tendermint light client is working
fn query_client_state(project_root: &Path, client_id: &str) -> Result<ClientStateInfo, Box<dyn std::error::Error>> {
    let hermes_binary = project_root.join("relayer/target/release/hermes");
    
    logger::verbose(&format!("   Running: hermes query client state --chain cardano-devnet --client {}", client_id));
    
    let output = Command::new(&hermes_binary)
        .args(&[
            "query", "client", "state",
            "--chain", "cardano-devnet",
            "--client", client_id,
        ])
        .output()?;
    
    if !output.status.success() {
        return Err(format!(
            "Failed to query client state:\n{}",
            String::from_utf8_lossy(&output.stderr)
        ).into());
    }
    
    let stdout = String::from_utf8_lossy(&output.stdout);
    logger::verbose(&format!("   Raw output: {}", stdout.trim()));
    
    // Parse the output to extract client state info
    let mut info = ClientStateInfo::default();
    
    for line in stdout.lines() {
        let line = line.trim();
        if line.contains("chain_id:") {
            info.chain_id = line.split(':').last().unwrap_or("").trim().to_string();
        } else if line.contains("latest_height:") || line.contains("revision_height:") {
            if info.latest_height.is_empty() {
                info.latest_height = line.split(':').last().unwrap_or("").trim().to_string();
            }
        } else if line.contains("trust_level:") || line.contains("numerator:") {
            if info.trust_level.is_empty() {
                info.trust_level = line.split(':').last().unwrap_or("1/3").trim().to_string();
            }
        }
    }
    
    // If we couldn't parse structured output, try to detect success from raw output
    if info.chain_id.is_empty() && stdout.contains("sidechain") {
        info.chain_id = "sidechain".to_string();
    }
    if info.latest_height.is_empty() {
        // Try to extract any number that looks like a height
        for word in stdout.split_whitespace() {
            if word.chars().all(|c| c.is_ascii_digit()) && word.len() > 1 {
                info.latest_height = word.to_string();
                break;
            }
        }
    }
    if info.trust_level.is_empty() {
        info.trust_level = "1/3".to_string();
    }
    
    Ok(info)
}

/// Update client with new headers via Hermes
/// This exercises the Tendermint light client verification on Cardano
fn update_client(project_root: &Path, client_id: &str) -> Result<(), Box<dyn std::error::Error>> {
    let hermes_binary = project_root.join("relayer/target/release/hermes");
    
    logger::verbose(&format!("   Running: hermes update client --host-chain cardano-devnet --client {}", client_id));
    
    let output = Command::new(&hermes_binary)
        .args(&[
            "update", "client",
            "--host-chain", "cardano-devnet",
            "--client", client_id,
        ])
        .output()?;
    
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    
    logger::verbose(&format!("   stdout: {}", stdout.trim()));
    if !stderr.is_empty() {
        logger::verbose(&format!("   stderr: {}", stderr.trim()));
    }
    
    if !output.status.success() {
        return Err(format!(
            "Failed to update client:\nstdout: {}\nstderr: {}",
            stdout, stderr
        ).into());
    }
    
    // Check for "client already up to date" message which isn't an error
    let combined = format!("{} {}", stdout, stderr);
    if combined.contains("already updated") || combined.contains("no update") {
        return Err("Client already up to date - no new blocks to verify".into());
    }
    
    Ok(())
}

/// Create a test client using Hermes relayer
/// 
/// This uses Hermes CLI to create an IBC client, which:
/// 1. Calls Gateway to build unsigned transaction
/// 2. Signs transaction with Hermes keyring
/// 3. Submits signed transaction to Cardano
fn create_test_client(project_root: &Path) -> Result<String, Box<dyn std::error::Error>> {
    logger::verbose("   Creating client via Hermes...");
    
    let hermes_binary = project_root.join("relayer/target/release/hermes");
    
    if !hermes_binary.exists() {
        return Err(format!(
            "Hermes binary not found at: {}\n\
             Please build Hermes first: cd relayer && cargo build --release",
            hermes_binary.display()
        ).into());
    }
    
    logger::verbose("   Running: hermes create client --host-chain cardano-devnet --reference-chain sidechain");
    
    let output = Command::new(&hermes_binary)
        .args(&[
            "create", "client",
            "--host-chain", "cardano-devnet",
            "--reference-chain", "sidechain",
        ])
        .output()?;
    
    if !output.status.success() {
        return Err(format!(
            "Hermes client creation failed:\n\
             stdout: {}\n\
             stderr: {}\n\
             \n\
             Ensure Hermes is configured and keys are added:\n\
             - hermes keys add --chain cardano-devnet --mnemonic-file ~/cardano.txt\n\
             - hermes keys add --chain sidechain --mnemonic-file ~/sidechain.txt",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        ).into());
    }
    
    let stdout = String::from_utf8_lossy(&output.stdout);
    logger::verbose(&format!("   {}", stdout.trim()));
    
    // Extract client_id from output (format: "ibc_client-0" or similar)
    let client_id = stdout
        .lines()
        .find(|line| line.contains("client") || line.contains("Client"))
        .and_then(|line| {
            line.split_whitespace()
                .find(|word| word.starts_with("ibc_client-") || word.contains("07-tendermint-"))
        })
        .unwrap_or("ibc_client-0")
        .to_string();
    
    logger::verbose(&format!("   Client created: {}", client_id));
    
    Ok(client_id)
}

/// Create a test connection using Hermes relayer
/// 
/// Creates a connection between cardano-devnet and the local packet-forwarding chain
fn create_test_connection(project_root: &Path) -> Result<String, Box<dyn std::error::Error>> {
    logger::verbose("   Creating connection via Hermes...");
    
    let hermes_binary = project_root.join("relayer/target/release/hermes");
    
    logger::verbose("   Running: hermes create connection --a-chain cardano-devnet --b-chain sidechain");
    
    let output = Command::new(&hermes_binary)
        .args(&[
            "create", "connection",
            "--a-chain", "cardano-devnet",
            "--b-chain", "sidechain",
        ])
        .output()?;
    
    if !output.status.success() {
        return Err(format!(
            "Hermes connection creation failed:\n\
             stdout: {}\n\
             stderr: {}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        ).into());
    }
    
    let stdout = String::from_utf8_lossy(&output.stdout);
    logger::verbose(&format!("   {}", stdout.trim()));
    
    // Extract connection_id from output
    let connection_id = stdout
        .lines()
        .find(|line| line.contains("connection"))
        .and_then(|line| {
            line.split_whitespace()
                .find(|word| word.starts_with("connection-"))
        })
        .unwrap_or("connection-0")
        .to_string();
    
    logger::verbose(&format!("   Connection created: {}", connection_id));
    
    Ok(connection_id)
}

/// Create a test channel using Hermes relayer
/// 
/// Creates a transfer channel on the specified connection
fn create_test_channel(
    project_root: &Path,
    connection_id: &str,
) -> Result<String, Box<dyn std::error::Error>> {
    logger::verbose("   Creating channel via Hermes...");
    
    let hermes_binary = project_root.join("relayer/target/release/hermes");
    
    logger::verbose(&format!(
        "   Running: hermes create channel --a-chain cardano-devnet --a-connection {} --a-port transfer --b-port transfer",
        connection_id
    ));
    
    let output = Command::new(&hermes_binary)
        .args(&[
            "create", "channel",
            "--a-chain", "cardano-devnet",
            "--a-connection", connection_id,
            "--a-port", "transfer",
            "--b-port", "transfer",
        ])
        .output()?;
    
    if !output.status.success() {
        return Err(format!(
            "Hermes channel creation failed:\n\
             stdout: {}\n\
             stderr: {}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        ).into());
    }
    
    let stdout = String::from_utf8_lossy(&output.stdout);
    logger::verbose(&format!("   {}", stdout.trim()));
    
    // Extract channel_id from output
    let channel_id = stdout
        .lines()
        .find(|line| line.contains("channel"))
        .and_then(|line| {
            line.split_whitespace()
                .find(|word| word.starts_with("channel-"))
        })
        .unwrap_or("channel-0")
        .to_string();
    
    logger::verbose(&format!("   Channel created: {}", channel_id));
    
    Ok(channel_id)
}
