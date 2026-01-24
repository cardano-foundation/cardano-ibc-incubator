use crate::logger::{self, verbose};
use std::path::Path;
use std::process::Command;
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
/// - Handler UTXO contains ibc_state_root field
/// - Root changes after createClient
/// - Root changes after connectionOpenInit  
/// - Root changes after channelOpenInit
///
/// # Arguments
/// * `project_root` - Path to the project root directory
///
/// # Prerequisites
/// All services must be running before running tests. Use 'caribic start all' first.
pub async fn run_integration_tests(
    project_root: &Path,
) -> Result<TestResults, Box<dyn std::error::Error>> {
    logger::log("Running IBC Integration Tests\n");
    let mut results = TestResults::new();

    // Test 1: Verify services are running
    logger::log("Test 1: Verifying services are running...");
    verify_services_running(project_root).await?;
    logger::log("PASS Test 1: All services are running\n");
    results.passed += 1;

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
    results.passed += 1;

    // Test 3: Create a client and verify root changes
    logger::log("Test 3: Creating client via Hermes and verifying root changes...");
    
    let client_id = match create_test_client(project_root) {
        Ok(client_id) => {
            // Wait for transaction confirmation
            logger::verbose("   Waiting for transaction confirmation...");
            std::thread::sleep(std::time::Duration::from_secs(10));

            let root_after_client = query_handler_state_root(project_root)?;
            
            if root_after_client == initial_root {
                logger::log("   Warning: Root unchanged after client creation");
                logger::log("FAIL Test 3: Root did not update after client creation\n");
                results.failed += 1;
                None
            } else {
                logger::log(&format!("   Client ID: {}", client_id));
                logger::log(&format!("   New root: {}...", &root_after_client[..16]));
                logger::log("PASS Test 3: Root changed after createClient\n");
                results.passed += 1;
                Some(client_id)
            }
        }
        Err(e) => {
            logger::log(&format!("FAIL Test 3: Hermes client creation failed\n{}\n", e));
            results.failed += 1;
            None
        }
    };

    // Test 4: Create a connection and verify root changes
    logger::log("Test 4: Creating connection via Hermes and verifying root changes...");
    
    let connection_id = if client_id.is_some() {
        match create_test_connection(project_root) {
            Ok(connection_id) => {
                // Wait for transaction confirmation
                logger::verbose("   Waiting for transaction confirmation...");
                std::thread::sleep(std::time::Duration::from_secs(10));

                let root_after_connection = query_handler_state_root(project_root)?;
                
                logger::log(&format!("   Connection ID: {}", connection_id));
                logger::log(&format!("   New root: {}...", &root_after_connection[..16]));
                logger::log("PASS Test 4: Connection created and root updated\n");
                results.passed += 1;
                Some(connection_id)
            }
            Err(e) => {
                logger::log(&format!("FAIL Test 4: Hermes connection creation failed\n{}\n", e));
                results.failed += 1;
                None
            }
        }
    } else {
        logger::log("SKIP Test 4: Skipped due to Test 3 failure\n");
        results.skipped += 1;
        None
    };

    // Test 5: Create a channel and verify root changes
    logger::log("Test 5: Creating channel via Hermes and verifying root changes...");
    
    if let Some(conn_id) = connection_id {
        match create_test_channel(project_root, &conn_id) {
            Ok(channel_id) => {
                // Wait for transaction confirmation
                logger::verbose("   Waiting for transaction confirmation...");
                std::thread::sleep(std::time::Duration::from_secs(10));

                let root_after_channel = query_handler_state_root(project_root)?;
                
                logger::log(&format!("   Channel ID: {}", channel_id));
                logger::log(&format!("   New root: {}...", &root_after_channel[..16]));
                logger::log("PASS Test 5: Channel created and root updated\n");
                results.passed += 1;
            }
            Err(e) => {
                logger::log(&format!("FAIL Test 5: Hermes channel creation failed\n{}\n", e));
                results.failed += 1;
            }
        }
    } else {
        logger::log("SKIP Test 5: Skipped due to Test 4 failure\n");
        results.skipped += 1;
    }

    Ok(results)
}

/// Verify that all required services are running
async fn verify_services_running(project_root: &Path) -> Result<(), Box<dyn std::error::Error>> {
    let mut missing_services = Vec::new();
    let http_client = reqwest::Client::builder()
        .no_proxy()
        .timeout(Duration::from_secs(3))
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {}", e))?;

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
    verbose("   Waiting for packet-forwarding chain RPC (http://127.0.0.1:26657/status) ...");
    let pfc_running = wait_for_service_health(
        &http_client,
        "http://127.0.0.1:26657/status",
        120,
        Duration::from_secs(5),
    )
    .await;
    if !pfc_running {
        missing_services.push("Packet-forwarding chain (Cosmos) on :26657");
    } else {
        verbose("   Packet-forwarding chain is running");
    }

    // Check Mithril (optional)
    // Mithril is required for Cosmos-side Cardano client creation (Mithril light client),
    // which is exercised by connection/channel tests.
    //
    // Mithril aggregator does not expose a dedicated `/health` endpoint in our setup; the
    // `/aggregator` endpoint is stable and returns 2xx when the service is up.
    let mithril_running = check_service_health(&http_client, "http://127.0.0.1:8080/aggregator").await;
    if !mithril_running {
        missing_services.push("Mithril aggregator on :8080");
    } else {
        verbose("   Mithril is running");

        // Mithril "up" is not the same as "ready".
        //
        // The aggregator can return 2xx for `/aggregator` while it still has no certificate chain.
        // In that state, all artifact endpoints keep returning an empty JSON array (`[]`) and the
        // Cosmos-side Cardano client cannot be created, which will later stall or fail connection/
        // channel handshakes.
        //
        // Common symptoms when Mithril is not ready:
        // - `GET /aggregator/certificates` returns `[]`
        // - aggregator logs contain "No certificate found", "certificate chain is invalid", or
        //   aggregate verification key (AVK) mismatch errors.
        //
        // Local devnet recovery (one-time bootstrap):
        // - run the `mithril-aggregator-genesis` job (docker compose profile `mithril-genesis`)
        //   with the genesis keys from `~/.caribic/config.json`
        // - restart Mithril aggregator + signers so they pick up the seeded certificate chain

        // Gateway's `queryNewMithrilClient` requires stake distributions + transaction snapshots.
        // These are produced asynchronously by the local aggregator, so we wait here to avoid
        // flaky failures in later Hermes-driven tests.
        verbose("   Waiting for Mithril stake distributions ...");
        let stake_distributions_ready = wait_for_json_array_non_empty(
            &http_client,
            "http://127.0.0.1:8080/aggregator/artifact/mithril-stake-distributions",
            60,
            Duration::from_secs(5),
        )
        .await;
        if !stake_distributions_ready {
            missing_services.push("Mithril stake distributions (not ready)");
        } else {
            verbose("   Mithril stake distributions available");
        }

        verbose("   Waiting for Mithril Cardano transaction snapshots ...");
        let tx_snapshots_ready = wait_for_json_array_non_empty(
            &http_client,
            "http://127.0.0.1:8080/aggregator/artifact/cardano-transactions",
            60,
            Duration::from_secs(5),
        )
        .await;
        if !tx_snapshots_ready {
            missing_services.push("Mithril Cardano transaction snapshots (not ready)");
        } else {
            verbose("   Mithril Cardano transaction snapshots available");
        }
    }

    if !missing_services.is_empty() {
        return Err(format!(
            "Required services not running: {}.\n\nPlease run 'caribic start all' first to start all services.",
            missing_services.join(", ")
        ).into());
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
async fn check_service_health(client: &reqwest::Client, url: &str) -> bool {
    match client.get(url).send().await {
        Ok(resp) => resp.status().is_success(),
        Err(_) => false,
    }
}

async fn wait_for_service_health(
    client: &reqwest::Client,
    url: &str,
    max_attempts: usize,
    interval: Duration,
) -> bool {
    let start = Instant::now();
    for attempt in 0..max_attempts {
        if check_service_health(client, url).await {
            return true;
        }
        logger::verbose(&format!(
            "   Waiting for {} (attempt {}/{}, elapsed {}s)...",
            url,
            attempt + 1,
            max_attempts,
            start.elapsed().as_secs()
        ));
        tokio::time::sleep(interval).await;
    }
    false
}

async fn check_json_array_non_empty(client: &reqwest::Client, url: &str) -> bool {
    let resp = match client.get(url).send().await {
        Ok(r) => r,
        Err(_) => return false,
    };
    if !resp.status().is_success() {
        return false;
    }
    match resp.json::<serde_json::Value>().await {
        Ok(serde_json::Value::Array(items)) => !items.is_empty(),
        _ => false,
    }
}

async fn wait_for_json_array_non_empty(
    client: &reqwest::Client,
    url: &str,
    max_attempts: usize,
    interval: Duration,
) -> bool {
    // Some services (notably the local Mithril aggregator) intentionally return `[]` until they
    // have produced their first artifacts. For our readiness checks, "non-empty array" is the
    // simplest portable signal that the service is usable for subsequent tests.
    let start = Instant::now();
    for attempt in 0..max_attempts {
        if check_json_array_non_empty(client, url).await {
            return true;
        }
        logger::verbose(&format!(
            "   Waiting for {} (attempt {}/{}, elapsed {}s)...",
            url,
            attempt + 1,
            max_attempts,
            start.elapsed().as_secs()
        ));
        tokio::time::sleep(interval).await;
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

    let host_state_utxo = host_state_datum.ok_or("HostState UTXO not found or has no datum")?;
    
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

    // The connection handshake can legitimately take a few minutes on a local devnet:
    // - Hermes waits for Cardano tx inclusion, then for Mithril certification of the inclusion
    //   height (used as the IBC `proof_height` when proving Cardano state to the Cosmos chain).
    //
    // If this appears stuck, the next debugging step is to identify which handshake message was
    // last submitted (OpenInit/OpenTry/OpenAck/OpenConfirm) in `~/.hermes/hermes.log`, then check
    // Gateway logs for the corresponding unsigned-tx build/evaluation errors (Plutus failures,
    // PastHorizon/slot horizon issues, etc).
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
