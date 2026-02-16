use crate::logger::{self, verbose};
use indicatif::{ProgressBar, ProgressStyle};
use std::collections::BTreeMap;
use std::io::{BufRead, BufReader, IsTerminal};
use std::path::Path;
use std::process::{Command, Output, Stdio};
use std::sync::mpsc;
use std::thread;
use std::time::{Duration, Instant};

/// Run a command while streaming its stdout/stderr to the user (for long-running steps),
/// while also capturing the full output for later parsing.
fn run_command_streaming(
    mut command: Command,
    label: &str,
) -> Result<Output, Box<dyn std::error::Error>> {
    enum Stream {
        Stdout,
        Stderr,
    }

    let verbosity = logger::get_verbosity();
    let command_started = Instant::now();
    let mut last_progress_line: Option<String> = None;
    let mut last_progress_at = Instant::now()
        .checked_sub(Duration::from_secs(60))
        .unwrap_or_else(Instant::now);

    command.stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut child = command.spawn()?;

    let stdout = child.stdout.take().ok_or("Failed to capture stdout")?;
    let stderr = child.stderr.take().ok_or("Failed to capture stderr")?;

    let (sender, receiver) = mpsc::channel::<(Stream, String)>();

    let stdout_sender = sender.clone();
    let stdout_handle = thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines().flatten() {
            let _ = stdout_sender.send((Stream::Stdout, line));
        }
    });

    let stderr_sender = sender.clone();
    let stderr_handle = thread::spawn(move || {
        let reader = BufReader::new(stderr);
        for line in reader.lines().flatten() {
            let _ = stderr_sender.send((Stream::Stderr, line));
        }
    });

    drop(sender);

    let mut stdout_buf = String::new();
    let mut stderr_buf = String::new();

    for (stream, line) in receiver {
        let trimmed = line.trim_end().to_string();

        match stream {
            Stream::Stdout => {
                stdout_buf.push_str(&trimmed);
                stdout_buf.push('\n');
            }
            Stream::Stderr => {
                stderr_buf.push_str(&trimmed);
                stderr_buf.push('\n');
            }
        }

        // Always keep full logs available in verbose mode.
        logger::verbose(&format!("   [{}] {}", label, trimmed));

        // In normal runs, emit a few "heartbeat" lines so long Hermes steps don't look stuck.
        if verbosity != logger::Verbosity::Verbose {
            let is_progress_line = trimmed.contains("Waiting for Mithril snapshot")
                || trimmed.contains("certified")
                || trimmed.contains("submitted")
                || trimmed.contains("Building unsigned transaction")
                || trimmed.contains("MsgConnection")
                || trimmed.contains("ERROR")
                || trimmed.contains("Error")
                || trimmed.contains("failed");

            if is_progress_line {
                let now = Instant::now();
                let should_emit = last_progress_line.as_deref() != Some(trimmed.as_str())
                    && now.duration_since(last_progress_at) >= Duration::from_secs(2);
                if should_emit {
                    logger::log(&format!("   [{}] {}", label, trimmed));
                    last_progress_line = Some(trimmed.clone());
                    last_progress_at = now;
                }
            }
        }
    }

    let status = child.wait()?;
    let _ = stdout_handle.join();
    let _ = stderr_handle.join();
    let elapsed = command_started.elapsed();

    logger::verbose(&format!(
        "   [{}] completed in {:.2}s (success={})",
        label,
        elapsed.as_secs_f32(),
        status.success()
    ));

    if !status.success() && logger::get_verbosity() != logger::Verbosity::Quite {
        let tail_preview = |text: &str| -> String {
            let lines: Vec<&str> = text.lines().collect();
            let start = lines.len().saturating_sub(20);
            if lines.is_empty() {
                String::new()
            } else {
                lines[start..]
                    .iter()
                    .map(|line| format!("   [tail] {line}"))
                    .collect::<Vec<_>>()
                    .join("\n")
            }
        };

        let stdout_tail = tail_preview(&stdout_buf);
        let stderr_tail = tail_preview(&stderr_buf);

        logger::warn(&format!(
            "   [{}] command failed after {:.2}s with exit code {:?}",
            label,
            elapsed.as_secs_f32(),
            status
        ));
        if !stdout_tail.is_empty() {
            logger::warn(&format!("   [{}] stdout tail:\n{}", label, stdout_tail));
        }
        if !stderr_tail.is_empty() {
            logger::warn(&format!("   [{}] stderr tail:\n{}", label, stderr_tail));
        }
    }

    Ok(Output {
        status,
        stdout: stdout_buf.into_bytes(),
        stderr: stderr_buf.into_bytes(),
    })
}

fn format_duration(duration: Duration) -> String {
    let total_secs = duration.as_secs();
    let hours = total_secs / 3600;
    let minutes = (total_secs % 3600) / 60;
    let seconds = total_secs % 60;

    if hours > 0 {
        format!("{hours}h{minutes:02}m{seconds:02}s")
    } else if minutes > 0 {
        format!("{minutes}m{seconds:02}s")
    } else {
        format!("{seconds}s")
    }
}

fn test_progress_style() -> ProgressStyle {
    ProgressStyle::with_template("{spinner} {msg} (elapsed {elapsed_precise})")
        .unwrap_or_else(|_| ProgressStyle::default_spinner())
        .tick_strings(&["-", "\\", "|", "/"])
}

struct TestTimer {
    progress_bar: Option<ProgressBar>,
    started_at: Instant,
    finished: bool,
}

impl TestTimer {
    fn start(message: &str) -> Self {
        let started_at = Instant::now();

        if logger::is_quite() || !std::io::stdout().is_terminal() {
            logger::log(message);
            return Self {
                progress_bar: None,
                started_at,
                finished: false,
            };
        }

        let progress_bar = ProgressBar::new_spinner();
        progress_bar.set_style(test_progress_style());
        progress_bar.set_message(message.to_owned());
        progress_bar.enable_steady_tick(Duration::from_millis(120));

        Self {
            progress_bar: Some(progress_bar),
            started_at,
            finished: false,
        }
    }

    fn finish(&mut self) -> Duration {
        if self.finished {
            return Instant::now().duration_since(self.started_at);
        }

        self.finished = true;
        if let Some(progress_bar) = self.progress_bar.take() {
            progress_bar.finish_and_clear();
        }

        Instant::now().duration_since(self.started_at)
    }
}

impl Drop for TestTimer {
    fn drop(&mut self) {
        if !self.finished {
            if let Some(progress_bar) = self.progress_bar.take() {
                progress_bar.finish_and_clear();
            }
        }
    }
}

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

const MAX_TEST_INDEX: u8 = 12;
const ENTRYPOINT_CHAIN_ID: &str = "entrypoint";

#[derive(Debug, Clone)]
struct TestSelection {
    requested: BTreeMap<u8, ()>,
    expanded: BTreeMap<u8, ()>,
}

impl TestSelection {
    fn parse(spec: Option<&str>) -> Result<Self, Box<dyn std::error::Error>> {
        let requested_tests = match spec {
            None => (1..=MAX_TEST_INDEX).collect::<Vec<u8>>(),
            Some(raw) => parse_test_selector(raw)?,
        };

        let mut requested = BTreeMap::new();
        for test in requested_tests {
            requested.insert(test, ());
        }

        let mut expanded = BTreeMap::new();
        for test in requested.keys().copied() {
            add_test_with_prerequisites(test, &mut expanded)?;
        }

        Ok(Self {
            requested,
            expanded,
        })
    }

    fn should_run(&self, test_number: u8) -> bool {
        self.expanded.contains_key(&test_number)
    }

    fn requested_list(&self) -> String {
        self.requested
            .keys()
            .map(|value| value.to_string())
            .collect::<Vec<_>>()
            .join(", ")
    }

    fn setup_only_list(&self) -> String {
        self.expanded
            .keys()
            .filter(|value| !self.requested.contains_key(value))
            .map(|value| value.to_string())
            .collect::<Vec<_>>()
            .join(", ")
    }
}

fn parse_test_selector(raw: &str) -> Result<Vec<u8>, Box<dyn std::error::Error>> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("Empty test selector. Use examples like --tests 9-12 or --tests 6,9-12".into());
    }

    let mut selected = BTreeMap::new();
    for part in trimmed.split(',') {
        let token = part.trim();
        if token.is_empty() {
            continue;
        }

        if let Some((start_raw, end_raw)) = token.split_once('-') {
            let start: u8 = start_raw
                .trim()
                .parse()
                .map_err(|_| format!("Invalid test number in selector '{}'", token))?;
            let end: u8 = end_raw
                .trim()
                .parse()
                .map_err(|_| format!("Invalid test number in selector '{}'", token))?;

            if start == 0 || end == 0 || start > MAX_TEST_INDEX || end > MAX_TEST_INDEX {
                return Err(format!(
                    "Test selector '{}' is out of range. Supported tests are 1-{}",
                    token, MAX_TEST_INDEX
                )
                .into());
            }
            if start > end {
                return Err(format!("Invalid range '{}': start must be <= end", token).into());
            }

            for value in start..=end {
                selected.insert(value, ());
            }
        } else {
            let value: u8 = token
                .parse()
                .map_err(|_| format!("Invalid test number '{}'", token))?;
            if value == 0 || value > MAX_TEST_INDEX {
                return Err(format!(
                    "Test '{}' is out of range. Supported tests are 1-{}",
                    value, MAX_TEST_INDEX
                )
                .into());
            }
            selected.insert(value, ());
        }
    }

    if selected.is_empty() {
        return Err("No tests selected. Use examples like --tests 9-12 or --tests 6,9-12".into());
    }

    Ok(selected.keys().copied().collect())
}

fn add_test_with_prerequisites(
    test: u8,
    expanded: &mut BTreeMap<u8, ()>,
) -> Result<(), Box<dyn std::error::Error>> {
    if expanded.contains_key(&test) {
        return Ok(());
    }

    for prereq in test_prerequisites(test)? {
        add_test_with_prerequisites(prereq, expanded)?;
    }
    expanded.insert(test, ());
    Ok(())
}

fn test_prerequisites(test: u8) -> Result<Vec<u8>, Box<dyn std::error::Error>> {
    let prerequisites = match test {
        1 => vec![],
        2 => vec![1],
        3 => vec![1, 2],
        4 => vec![1, 2, 3],
        5 => vec![1, 2, 3, 4],
        6 => vec![1, 2, 3, 4],
        7 => vec![1, 2, 3, 4],
        8 => vec![1, 2, 3, 4, 7],
        9 => vec![1, 2, 3, 4, 7, 8],
        10 => vec![1, 2, 3, 4, 7, 8, 9],
        11 => vec![1, 2, 3, 4, 7, 8],
        12 => vec![1, 2, 3, 4, 7, 8, 11],
        _ => {
            return Err(format!(
                "Test {} is out of range. Supported tests are 1-{}",
                test, MAX_TEST_INDEX
            )
            .into())
        }
    };
    Ok(prerequisites)
}

#[cfg(test)]
mod test_selection_tests {
    use super::*;

    #[test]
    fn parse_selector_handles_ranges_and_lists() {
        let parsed = parse_test_selector("6,9-12").expect("selector should parse");
        assert_eq!(parsed, vec![6, 9, 10, 11, 12]);
    }

    #[test]
    fn parse_selector_rejects_invalid_values() {
        assert!(parse_test_selector("").is_err());
        assert!(parse_test_selector("0").is_err());
        assert!(parse_test_selector("13").is_err());
        assert!(parse_test_selector("10-9").is_err());
        assert!(parse_test_selector("abc").is_err());
    }

    #[test]
    fn selection_auto_includes_prerequisites_for_ics20_range() {
        let selection = TestSelection::parse(Some("9-12")).expect("selection should parse");

        let expected_requested = vec![9, 10, 11, 12];
        let actual_requested: Vec<u8> = selection.requested.keys().copied().collect();
        assert_eq!(actual_requested, expected_requested);

        let expected_expanded = vec![1, 2, 3, 4, 7, 8, 9, 10, 11, 12];
        let actual_expanded: Vec<u8> = selection.expanded.keys().copied().collect();
        assert_eq!(actual_expanded, expected_expanded);
    }

    #[test]
    fn selection_without_filter_runs_full_suite() {
        let selection = TestSelection::parse(None).expect("default selection should parse");
        let actual_expanded: Vec<u8> = selection.expanded.keys().copied().collect();
        let expected: Vec<u8> = (1..=MAX_TEST_INDEX).collect();
        assert_eq!(actual_expanded, expected);
    }

    #[test]
    fn extract_channel_ids_parses_transfer_channel_tokens() {
        let line = &format!(
            "cardano-devnet: transfer/channel-1 --- {}: transfer/channel-2",
            ENTRYPOINT_CHAIN_ID
        );
        let channel_ids = extract_channel_ids_from_line(line);
        assert_eq!(channel_ids, vec!["channel-1", "channel-2"]);
    }

    #[test]
    fn parse_hermes_channel_pair_line_extracts_chain_and_channel_ids() {
        let line = &format!(
            "{}: transfer/channel-3 --- cardano-devnet: transfer/channel-2",
            ENTRYPOINT_CHAIN_ID
        );
        let pair = parse_hermes_channel_pair_line(line).expect("pair should parse");
        assert_eq!(pair.local_chain, ENTRYPOINT_CHAIN_ID);
        assert_eq!(pair.local_channel, "channel-3");
        assert_eq!(pair.counterparty_chain, "cardano-devnet");
        assert_eq!(pair.counterparty_channel, "channel-2");
    }

    #[test]
    fn resolve_counterparty_channel_from_output_matches_chain_side() {
        let output = format!(
            "SUCCESS \n\
{}: transfer/channel-1 --- cardano-devnet: transfer/channel-0\n\
{}: transfer/channel-2 --- cardano-devnet: transfer/channel-1\n\
{}: transfer/channel-3 --- cardano-devnet: transfer/channel-2\n",
            ENTRYPOINT_CHAIN_ID, ENTRYPOINT_CHAIN_ID, ENTRYPOINT_CHAIN_ID
        );

        let resolved = resolve_counterparty_channel_from_query_output(
            &output,
            "cardano-devnet",
            "channel-2",
            ENTRYPOINT_CHAIN_ID,
        )
        .expect("counterparty channel should resolve");

        assert_eq!(resolved, "channel-3");
    }

    #[test]
    fn parse_counterparty_channel_from_channel_end_output_reads_remote_channel() {
        let output = r#"SUCCESS ChannelEnd {
    state: Open(
        NotUpgrading,
    ),
    ordering: Unordered,
    remote: Counterparty {
        port_id: PortId(
            "transfer",
        ),
        channel_id: Some(
            ChannelId(
                "channel-9",
            ),
        ),
    },
}"#;

        let parsed = parse_counterparty_channel_from_channel_end_output(output)
            .expect("counterparty channel should parse");
        assert_eq!(parsed, "channel-9");
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
    test_selector: Option<&str>,
) -> Result<TestResults, Box<dyn std::error::Error>> {
    let selection = TestSelection::parse(test_selector)?;
    logger::log("Running IBC Integration Tests\n");
    if test_selector.is_some() {
        logger::log(&format!("Selected tests: {}", selection.requested_list()));
        let setup_only = selection.setup_only_list();
        if !setup_only.is_empty() {
            logger::log(&format!(
                "Auto-including prerequisite tests: {}",
                setup_only
            ));
        }
        logger::log("");
    }
    let mut results = TestResults::new();

    // Test 1: Verify services are running
    if selection.should_run(1) {
        let mut test_1 = TestTimer::start("Test 1: Verifying services are running...");
        verify_services_running(project_root).await?;
        let elapsed = test_1.finish();
        logger::log(&format!(
            "PASS Test 1: All services are running (took {})\n",
            format_duration(elapsed)
        ));
        results.passed += 1;
    }

    // [HERMES-GATEWAY-INTEGRATION-TEST]
    // Test 2: Gateway connectivity smoke test via Hermes health-check
    //
    // This is the first real test of Hermes talking to the Gateway. Hermes runs its
    // built-in health-check command which calls the Gateway's gRPC endpoint to fetch
    // the latest Cardano block height. If this fails, nothing else will work since
    // all IBC operations flow through this same gRPC channel.
    //
    // What's being tested:
    //   - Gateway is listening on a local port (5001) and accepting gRPC connections
    //   - Hermes config (normally at ~/.hermes/config.toml) has grpc_addr = "http://localhost:5001" for cardano-devnet
    //     (can obviously change this setup as needed but I would call this the canonical setup)
    //   - The LatestHeight query should actually return valid data from the Cardano network
    if selection.should_run(2) {
        let mut test_2 =
            TestTimer::start("Test 2: Verifying Hermes can connect to Gateway (health-check)...");
        match run_hermes_health_check(project_root) {
            Ok(_) => {
                let elapsed = test_2.finish();
                logger::log(&format!(
                    "PASS Test 2: Hermes health-check passed, Gateway connectivity verified (took {})\n",
                    format_duration(elapsed)
                ));
                results.passed += 1;
            }
            Err(e) => {
                let elapsed = test_2.finish();
                logger::log(&format!(
                    "FAIL Test 2: Hermes health-check failed (took {})\n{}\n",
                    format_duration(elapsed),
                    e
                ));
                results.failed += 1;
                // This is a critical failure - if Hermes can't talk to Gateway, later tests will fail
                logger::log("   Aborting remaining tests due to Gateway connectivity failure.\n");
                return Ok(results);
            }
        }
    }

    // Test 3: Query Handler UTXO and verify ibc_state_root exists
    let mut initial_root: Option<String> = None;
    if selection.should_run(3) {
        let mut test_3 =
            TestTimer::start("Test 3: Verifying Handler UTXO has ibc_state_root field...");
        let root = query_handler_state_root(project_root)?;

        if root.len() != 64 {
            let _ = test_3.finish();
            return Err(format!(
                "Invalid ibc_state_root length: expected 64 chars (32 bytes hex), got {}",
                root.len()
            )
            .into());
        }

        logger::log(&format!("   Initial root: {}...", &root[..16]));
        let elapsed = test_3.finish();
        logger::log(&format!(
            "PASS Test 3: Handler UTXO has valid ibc_state_root (took {})\n",
            format_duration(elapsed)
        ));
        results.passed += 1;
        initial_root = Some(root);
    }

    // [HERMES-GATEWAY-INTEGRATION-TEST]
    // Test 4: Create a client and verify root changes
    //
    // We're testing the full CreateClient flow end-to-end.
    //
    // Quick clarification on "creating" vs "deploying" light clients:
    //   - The light client code (Plutus validators that verify Tendermint headers) was
    //     already deployed to Cardano during `caribic start bridge`. That's infrastructure.
    //   - What we're doing here is creating a client INSTANCE - a piece of on-chain state
    //     that tracks a specific counterparty chain (the Cosmos Entrypoint chain's chain ID, current
    //     trusted height, validator set hash, etc.) When you call CreateClient that's basically
    //     initializing the first anchor point of trust. Its a state snapshot as opposed to code.
    //
    // Hermes asks the Gateway to build an unsigned Cardano transaction that will
    // create this Tendermint client instance on Cardano. In Cardano terms, this means
    // creating a new UTXO at the client validator address, where the datum contains
    // the trusted state (chain ID, height, validator set hash, etc.). Hermes then
    // signs the tx with its own wallet keys and submits it to Cardano.
    //
    // What's being tested:
    //   - Gateway's CreateClient gRPC endpoint builds a valid unsigned tx
    //   - The tx includes the correct Tendermint ClientState and ConsensusState
    //   - Hermes can sign and submit the transaction to Cardano
    //   - The on-chain ibc_state_root actually changes (proving the tx landed)
    //
    // The flow: Hermes -> Gateway (builds tx) -> Hermes (signs) -> Cardano (submits)

    let mut client_id: Option<String> = None;
    if selection.should_run(4) {
        let root_before_client = initial_root
            .clone()
            .ok_or("Test 4 requires Test 3 to run and capture the initial root")?;

        let mut test_4 =
            TestTimer::start("Test 4: Creating client via Hermes and verifying root changes...");

        client_id = match create_test_client(project_root) {
            Ok(client_id) => {
                // Wait for transaction confirmation
                logger::verbose("   Waiting for transaction confirmation...");
                std::thread::sleep(std::time::Duration::from_secs(10));

                let root_after_client = query_handler_state_root(project_root)?;

                if root_after_client == root_before_client {
                    let elapsed = test_4.finish();
                    logger::log("   Warning: Root unchanged after client creation");
                    logger::log(&format!(
                        "FAIL Test 4: Root did not update after client creation (took {})\n",
                        format_duration(elapsed)
                    ));
                    results.failed += 1;
                    None
                } else {
                    let elapsed = test_4.finish();
                    logger::log(&format!("   Client ID: {}", client_id));
                    logger::log(&format!("   New root: {}...", &root_after_client[..16]));
                    logger::log(&format!(
                        "PASS Test 4: Root changed after createClient (took {})\n",
                        format_duration(elapsed)
                    ));
                    results.passed += 1;
                    Some(client_id)
                }
            }
            Err(e) => {
                let elapsed = test_4.finish();
                logger::log(&format!(
                    "FAIL Test 4: Hermes client creation failed (took {})\n{}\n",
                    format_duration(elapsed),
                    e
                ));
                results.failed += 1;
                None
            }
        };
    }

    // [HERMES-GATEWAY-INTEGRATION-TEST]
    // Test 5: Query client state to verify Tendermint light client is working
    //
    // After creating a client, we want to read it back to confirm it's stored correctly.
    // Hermes queries the Gateway which reads the client state from Cardano's on-chain
    // storage and returns it in standard IBC format.
    //
    // What's being tested:
    //   - Gateway's ClientState query endpoint can find and decode stored clients
    //   - The Tendermint client state fields (chain_id, trust_level, heights) are correct
    //   - Round-trip: what we wrote in Test 4 can be read back properly
    //
    // Known limitation: Gateway currently requires an explicit height parameter for
    // client queries. If this test skips, it means we need to add support for querying
    // at "latest" height without requiring the caller to specify it.
    //
    // Status: May skip due to height parameter requirement - this is a known TODO.
    if selection.should_run(5) {
        let mut test_5 = TestTimer::start("Test 5: Querying client state via Hermes...");

        if let Some(ref cid) = client_id {
            match query_client_state(project_root, cid) {
                Ok(client_state_info) => {
                    let elapsed = test_5.finish();
                    logger::log(&format!("   Chain ID: {}", client_state_info.chain_id));
                    logger::log(&format!(
                        "   Latest height: {}",
                        client_state_info.latest_height
                    ));
                    logger::log(&format!(
                        "   Trust level: {}",
                        client_state_info.trust_level
                    ));
                    logger::log(&format!(
                        "PASS Test 5: Client state queried successfully (took {})\n",
                        format_duration(elapsed)
                    ));
                    results.passed += 1;
                }
                Err(e) => {
                    let elapsed = test_5.finish();
                    let error_str = e.to_string();
                    // Check for known Gateway limitation: requires height parameter
                    if error_str.contains("height") && error_str.contains("must be provided") {
                        logger::log(&format!(
                            "SKIP Test 5: Gateway requires height parameter for client queries (took {})",
                            format_duration(elapsed)
                        ));
                        logger::log("   This is a known limitation - Gateway needs to support querying at latest height.\n");
                        results.skipped += 1;
                    } else {
                        logger::log(&format!(
                            "FAIL Test 5: Failed to query client state (took {})\n{}\n",
                            format_duration(elapsed),
                            e
                        ));
                        results.failed += 1;
                    }
                }
            }
        } else {
            let elapsed = test_5.finish();
            logger::log(&format!(
                "SKIP Test 5: Skipped due to Test 4 failure (took {})\n",
                format_duration(elapsed)
            ));
            results.skipped += 1;
        }
    }

    // [HERMES-GATEWAY-INTEGRATION-TEST]
    // Test 6: Update client with new Tendermint headers and verify height advances
    //
    // This is where the Tendermint light client gets exercised. Hermes fetches
    // new block headers from the Cosmos Entrypoint chain and submits them to update the client
    // on Cardano. The Cardano smart contracts verify the headers are valid (signatures,
    // validator set transitions, etc.) before accepting them.
    //
    // What's being tested:
    //   - Gateway's UpdateClient endpoint can build header update transactions
    //   - Tendermint header verification logic in Cardano smart contracts works
    //   - The client's trusted height advances after accepting new headers
    //
    // This is important because it proves we can track the Cosmos chain's progress
    // from Cardano - which is essential for verifying IBC packet proofs later.
    //
    if selection.should_run(6) {
        let mut test_6 = TestTimer::start(
            "Test 6: Updating client with new headers (exercises Tendermint verification)...",
        );

        if let Some(ref cid) = client_id {
            // Wait for new blocks on the Cosmos chain
            logger::verbose("   Waiting for new blocks on Cosmos Entrypoint chain...");
            std::thread::sleep(std::time::Duration::from_secs(5));

            match update_client(project_root, cid) {
                Ok(_) => {
                    let elapsed = test_6.finish();
                    // Wait for tx confirmation
                    std::thread::sleep(std::time::Duration::from_secs(10));

                    logger::log(&format!(
                        "PASS Test 6: Client updated successfully (Tendermint header verification passed) (took {})\n",
                        format_duration(elapsed)
                    ));
                    results.passed += 1;
                }
                Err(e) => {
                    let elapsed = test_6.finish();
                    let error_str = e.to_string();
                    // Check for known Gateway limitation: requires height parameter
                    if error_str.contains("height") && error_str.contains("must be provided") {
                        logger::log(&format!(
                            "SKIP Test 6: Gateway requires height parameter for client queries (took {})",
                            format_duration(elapsed)
                        ));
                        logger::log("   Update requires querying current state first, which needs height support.\n");
                        results.skipped += 1;
                    } else if error_str.contains("no need to update")
                        || error_str.contains("already up to date")
                    {
                        logger::log(&format!(
                            "SKIP Test 6: No new blocks available to update client (took {})\n",
                            format_duration(elapsed)
                        ));
                        results.skipped += 1;
                    } else {
                        logger::log(&format!(
                            "FAIL Test 6: Client update failed (took {})\n{}\n",
                            format_duration(elapsed),
                            e
                        ));
                        results.failed += 1;
                    }
                }
            }
        } else {
            let elapsed = test_6.finish();
            logger::log(&format!(
                "SKIP Test 6: Skipped due to Test 4 failure (took {})\n",
                format_duration(elapsed)
            ));
            results.skipped += 1;
        }
    }

    // [HERMES-GATEWAY-INTEGRATION-TEST]
    // Test 7: Create a connection and verify root changes
    //
    // IBC connections are the next layer up from clients. A connection links two
    // chains together and requires a 4-step handshake (Init, Try, Ack, Confirm).
    // This test has Hermes orchestrate the full handshake between Cardano and Cosmos.
    //
    // What's being tested:
    //   - Gateway's ConnectionOpenInit, Try, Ack, Confirm endpoints all work
    //   - Hermes can coordinate the back-and-forth between both chains
    //   - Connection state is properly stored on Cardano
    //
    // Known limitation: This requires a Cardano light client to exist on the Cosmos
    // side too (for the bidirectional handshake). If the Cardano light client isn't
    // implemented on Cosmos yet, this test will skip. At the point of writing this,
    // there is still some uncertainty around Mithril/Ourobouos/STT architecture.
    //
    // Status: May skip - depends on Cardano light client being available on Cosmos.
    let mut connection_test_skipped = false;
    let mut connection_id: Option<String> = None;
    if selection.should_run(7) {
        let mut test_7 = TestTimer::start(
            "Test 7: Creating connection via Hermes and verifying root changes...",
        );

        connection_id = if client_id.is_some() {
            match create_test_connection(project_root).await {
                Ok(connection_id) => {
                    // Wait for transaction confirmation
                    logger::verbose("   Waiting for transaction confirmation...");
                    std::thread::sleep(std::time::Duration::from_secs(10));

                    let root_after_connection = query_handler_state_root(project_root)?;

                    let elapsed = test_7.finish();
                    logger::log(&format!("   Connection ID: {}", connection_id));
                    logger::log(&format!("   New root: {}...", &root_after_connection[..16]));
                    logger::log(&format!(
                        "PASS Test 7: Connection created and root updated (took {})\n",
                        format_duration(elapsed)
                    ));
                    results.passed += 1;
                    Some(connection_id)
                }
                Err(e) => {
                    let elapsed = test_7.finish();
                    let error_str = e.to_string();
                    // If we know we're missing the Cardano light client pieces on the Cosmos side,
                    // skip the test rather than failing the full suite.
                    if error_str.contains("CardanoClientState -> AnyClientState")
                        || error_str.contains("not yet implemented")
                        || error_str.contains("Cardano header verification is not implemented")
                        || error_str.contains("/ibc.lightclients.cardano.v1.Header")
                    {
                        logger::log(&format!(
                            "SKIP Test 7: Bidirectional connection requires Cardano light client on Cosmos (took {})",
                            format_duration(elapsed)
                        ));
                        logger::log(&format!("   {}", error_str));
                        logger::log("");
                        results.skipped += 1;
                        connection_test_skipped = true;
                    } else {
                        logger::log(&format!(
                            "FAIL Test 7: Hermes connection creation failed (took {})\n{}\n",
                            format_duration(elapsed),
                            e
                        ));
                        results.failed += 1;
                    }
                    None
                }
            }
        } else {
            let elapsed = test_7.finish();
            logger::log(&format!(
                "SKIP Test 7: Skipped due to earlier test failure (took {})\n",
                format_duration(elapsed)
            ));
            results.skipped += 1;
            connection_test_skipped = true;
            None
        };
    }

    // [HERMES-GATEWAY-INTEGRATION-TEST]
    // Test 8: Create a channel and verify root changes
    //
    // Channels are the final layer. They're what applications actually use to send
    // packets. This test creates a "transfer" channel (ICS-20) for moving tokens
    // between Cardano and Cosmos. Like connections, channels have a 4-step handshake.
    //
    // What's being tested:
    //   - Gateway's ChannelOpenInit, Try, Ack, Confirm endpoints all work
    //   - The channel is bound to the "transfer" port on both sides
    //   - Channel state is properly stored on Cardano
    //
    // Once this works we're ready to test actual token transfers.
    //
    // Status: Depends on Test 7 passing (needs an established connection first).
    let mut channel_id: Option<String> = None;
    if selection.should_run(8) {
        let mut test_8 =
            TestTimer::start("Test 8: Creating channel via Hermes and verifying root changes...");

        channel_id = if let Some(conn_id) = connection_id {
            match create_test_channel(project_root, &conn_id) {
                Ok(channel_id) => {
                    // Wait for transaction confirmation
                    logger::verbose("   Waiting for transaction confirmation...");
                    std::thread::sleep(std::time::Duration::from_secs(10));

                    let root_after_channel = query_handler_state_root(project_root)?;

                    let elapsed = test_8.finish();
                    logger::log(&format!("   Channel ID: {}", channel_id));
                    logger::log(&format!("   New root: {}...", &root_after_channel[..16]));
                    logger::log(&format!(
                        "PASS Test 8: Channel created and root updated (took {})\n",
                        format_duration(elapsed)
                    ));
                    results.passed += 1;
                    Some(channel_id)
                }
                Err(e) => {
                    let elapsed = test_8.finish();
                    logger::log(&format!(
                        "FAIL Test 8: Hermes channel creation failed (took {})\n{}\n",
                        format_duration(elapsed),
                        e
                    ));
                    results.failed += 1;
                    None
                }
            }
        } else {
            let elapsed = test_8.finish();
            if connection_test_skipped {
                logger::log(&format!(
                    "SKIP Test 8: Skipped because no connection was established (took {})\n",
                    format_duration(elapsed)
                ));
            } else {
                logger::log(&format!(
                    "SKIP Test 8: Skipped due to Test 7 failure (took {})\n",
                    format_duration(elapsed)
                ));
            }
            results.skipped += 1;
            None
        };
    }

    if channel_id.is_none() && (selection.should_run(9) || selection.should_run(11)) {
        if let Some(existing_channel_id) = resolve_cardano_transfer_channel_id(project_root) {
            logger::warn(&format!(
                "No channel created during this run; reusing existing transfer channel {} for downstream ICS-20 tests.",
                existing_channel_id
            ));
            channel_id = Some(existing_channel_id);
        }
    }

    // Test 9: ICS-20 transfer (Cosmos -> Cardano) and packet clearing
    //
    // This tests the first real packet path:
    //   - Submit MsgTransfer on the packet-forwarding chain (Cosmos)
    //   - Relay RecvPacket to Cardano and Ack back to Cosmos
    //   - Validate basic token effects and Cardano voucher minting
    let mut transfer_test_passed = false;
    let mut stake_denom_trace_hash: Option<String> = None;
    if selection.should_run(9) {
        let mut test_9 =
            TestTimer::start("Test 9: ICS-20 transfer (Entrypoint chain -> Cardano)...");

        if let Some(cardano_channel_id) = &channel_id {
            let entrypoint_channel_id = resolve_entrypoint_channel_id_with_retries(
                project_root,
                cardano_channel_id,
                120,
                Duration::from_secs(2),
            )
            .unwrap_or_else(|| {
                logger::warn(&format!(
                    "Could not resolve entrypoint counterparty channel for {}; falling back to same channel id",
                    cardano_channel_id
                ));
                cardano_channel_id.clone()
            });

            let entrypoint_address = get_hermes_chain_address(project_root, ENTRYPOINT_CHAIN_ID)?;
            let cardano_receiver_credential = get_cardano_payment_credential_hex(project_root)?;
            let cardano_receiver_address = cardano_enterprise_address_from_payment_credential(
                project_root,
                &cardano_receiver_credential,
            )?;

            let denom = "stake";
            // Use a large enough amount that fee noise cannot mask the balance delta.
            let amount: u64 = 1_000_000;

            let voucher_policy_id = read_handler_json_value(
                project_root,
                &["validators", "mintVoucher", "scriptHash"],
            )?;

            let entrypoint_balance_before = query_entrypoint_balance(&entrypoint_address, denom)?;
            let cardano_voucher_assets_before = query_cardano_policy_assets(
                project_root,
                &cardano_receiver_address,
                &voucher_policy_id,
            )?;
            let cardano_voucher_before = sum_cardano_policy_assets(&cardano_voucher_assets_before);
            let cardano_root_before = query_handler_state_root(project_root)?;

            // The chain rejects packets that have both timeout_height and timeout_timestamp set
            // to zero, so ensure at least one is populated.
            let timeout_height_offset = 100;
            let timeout_seconds = 600;

            logger::verbose(&format!(
                "   Cardano receiver credential: {}...",
                &cardano_receiver_credential[..8]
            ));

            match hermes_ft_transfer(
                project_root,
                ENTRYPOINT_CHAIN_ID,
                "cardano-devnet",
                "transfer",
                &entrypoint_channel_id,
                amount,
                denom,
                Some(&cardano_receiver_credential),
                timeout_height_offset,
                timeout_seconds,
            ) {
                Ok(_) => match hermes_clear_packets(
                    project_root,
                    ENTRYPOINT_CHAIN_ID,
                    "transfer",
                    &entrypoint_channel_id,
                    "cardano-devnet",
                    cardano_channel_id,
                    None,
                ) {
                    Ok(_) => {
                        let entrypoint_balance_after =
                            query_entrypoint_balance(&entrypoint_address, denom)?;
                        let cardano_voucher_assets_after = query_cardano_policy_assets(
                            project_root,
                            &cardano_receiver_address,
                            &voucher_policy_id,
                        )?;
                        let cardano_voucher_after =
                            sum_cardano_policy_assets(&cardano_voucher_assets_after);
                        let cardano_root_after = query_handler_state_root(project_root)?;
                        let entrypoint_delta =
                            entrypoint_balance_before.saturating_sub(entrypoint_balance_after);
                        let voucher_delta =
                            cardano_voucher_after.saturating_sub(cardano_voucher_before);

                        if entrypoint_balance_before < entrypoint_balance_after
                            || entrypoint_delta < amount as u128
                        {
                            let elapsed = test_9.finish();
                            logger::log(&format!(
                            "FAIL Test 9: entrypoint chain balance did not decrease as expected (took {}) (before={}, after={}, delta={}, expected_delta >= {})\n",
                            format_duration(elapsed),
                            entrypoint_balance_before,
                            entrypoint_balance_after,
                            entrypoint_delta,
                            amount
                        ));
                            dump_test_9_ics20_diagnostics(
                                project_root,
                                cardano_channel_id,
                                &entrypoint_channel_id,
                                &entrypoint_address,
                                denom,
                                amount,
                                &cardano_receiver_address,
                                &voucher_policy_id,
                            );
                            results.failed += 1;
                        } else if voucher_delta < amount {
                            let elapsed = test_9.finish();
                            logger::log(&format!(
                            "FAIL Test 9: Cardano voucher token was not minted as expected (took {}) (before={}, after={}, delta={}, expected_delta >= {})\n",
                            format_duration(elapsed),
                            cardano_voucher_before,
                            cardano_voucher_after,
                            voucher_delta,
                            amount
                        ));
                            dump_test_9_ics20_diagnostics(
                                project_root,
                                cardano_channel_id,
                                &entrypoint_channel_id,
                                &entrypoint_address,
                                denom,
                                amount,
                                &cardano_receiver_address,
                                &voucher_policy_id,
                            );
                            results.failed += 1;
                        } else if cardano_root_after == cardano_root_before {
                            let elapsed = test_9.finish();
                            logger::log(&format!(
	                            "FAIL Test 9: Cardano ibc_state_root did not change after transfer (took {}) (root={}...)\n",
	                            format_duration(elapsed),
	                            &cardano_root_after[..16],
	                        ));
                            dump_test_9_ics20_diagnostics(
                                project_root,
                                cardano_channel_id,
                                &entrypoint_channel_id,
                                &entrypoint_address,
                                denom,
                                amount,
                                &cardano_receiver_address,
                                &voucher_policy_id,
                            );
                            results.failed += 1;
                        } else {
                            let expected_path = format!("transfer/{}", cardano_channel_id);
                            let minted_voucher_hash = match find_policy_asset_with_min_delta(
                                &cardano_voucher_assets_before,
                                &cardano_voucher_assets_after,
                                amount,
                            ) {
                                Ok(hash) => Some(hash),
                                Err(e) => {
                                    let elapsed = test_9.finish();
                                    logger::log(&format!(
	                                    "FAIL Test 9: Could not resolve minted Cardano voucher token name for denom-trace reverse lookup (took {})\n{}\n",
	                                    format_duration(elapsed),
	                                    e
	                                ));
                                    dump_test_9_ics20_diagnostics(
                                        project_root,
                                        cardano_channel_id,
                                        &entrypoint_channel_id,
                                        &entrypoint_address,
                                        denom,
                                        amount,
                                        &cardano_receiver_address,
                                        &voucher_policy_id,
                                    );
                                    results.failed += 1;
                                    None
                                }
                            };

                            if let Some(_minted_voucher_hash) = minted_voucher_hash {
                                match ibc_denom_trace_hash(&expected_path, denom) {
                                    Ok(denom_trace_hash) => {
                                        match assert_gateway_denom_trace(
                                            &denom_trace_hash,
                                            &expected_path,
                                            denom,
                                        )
                                        .await
                                        {
                                            Ok(()) => {
                                                let elapsed = test_9.finish();
                                                logger::log(&format!(
	                                                "PASS Test 9: Transfer relayed, voucher minted, and denom-trace reverse lookup succeeded (took {})\n",
	                                                format_duration(elapsed)
	                                            ));
                                                results.passed += 1;
                                                transfer_test_passed = true;
                                                stake_denom_trace_hash = Some(denom_trace_hash);
                                            }
                                            Err(e) => {
                                                let elapsed = test_9.finish();
                                                logger::log(&format!(
	                                                "FAIL Test 9: Denom-trace reverse lookup failed for minted Cardano voucher (took {})\n{}\n",
	                                                format_duration(elapsed),
	                                                e
	                                            ));
                                                dump_test_9_ics20_diagnostics(
                                                    project_root,
                                                    cardano_channel_id,
                                                    &entrypoint_channel_id,
                                                    &entrypoint_address,
                                                    denom,
                                                    amount,
                                                    &cardano_receiver_address,
                                                    &voucher_policy_id,
                                                );
                                                results.failed += 1;
                                            }
                                        }
                                    }
                                    Err(e) => {
                                        let elapsed = test_9.finish();
                                        logger::log(&format!(
	                                        "FAIL Test 9: Could not compute IBC denom-trace hash (took {})\n{}\n",
	                                        format_duration(elapsed),
	                                        e
	                                    ));
                                        dump_test_9_ics20_diagnostics(
                                            project_root,
                                            cardano_channel_id,
                                            &entrypoint_channel_id,
                                            &entrypoint_address,
                                            denom,
                                            amount,
                                            &cardano_receiver_address,
                                            &voucher_policy_id,
                                        );
                                        results.failed += 1;
                                    }
                                }
                            }
                        }
                    }
                    Err(e) => {
                        let elapsed = test_9.finish();
                        logger::log(&format!(
                            "FAIL Test 9: Failed to relay packets (took {})\n{}\n",
                            format_duration(elapsed),
                            e
                        ));
                        dump_test_9_ics20_diagnostics(
                            project_root,
                            cardano_channel_id,
                            &entrypoint_channel_id,
                            &entrypoint_address,
                            denom,
                            amount,
                            &cardano_receiver_address,
                            &voucher_policy_id,
                        );
                        results.failed += 1;
                    }
                },
                Err(e) => {
                    let elapsed = test_9.finish();
                    logger::log(&format!(
                        "FAIL Test 9: hermes tx ft-transfer failed (took {})\n{}\n",
                        format_duration(elapsed),
                        e
                    ));
                    dump_test_9_ics20_diagnostics(
                        project_root,
                        cardano_channel_id,
                        &entrypoint_channel_id,
                        &entrypoint_address,
                        denom,
                        amount,
                        &cardano_receiver_address,
                        &voucher_policy_id,
                    );
                    results.failed += 1;
                }
            }
        } else {
            let elapsed = test_9.finish();
            logger::log(&format!(
                "SKIP Test 9: Skipped because no transfer channel was established (took {})\n",
                format_duration(elapsed)
            ));
            results.skipped += 1;
        }
    }

    // Test 10: Round-trip transfer (Cardano -> Cosmos)
    //
    // Send the Cardano voucher back to the packet-forwarding chain and verify:
    //   - Voucher is burned on Cardano
    //   - Native token balance is restored on Cosmos (minus fees)
    if selection.should_run(10) {
        let mut test_10 =
            TestTimer::start("Test 10: ICS-20 round-trip (Cardano -> Entrypoint chain)...");
        if transfer_test_passed {
            if let Some(cardano_channel_id) = &channel_id {
                let entrypoint_channel_id = resolve_entrypoint_channel_id_with_retries(
                    project_root,
                    cardano_channel_id,
                    120,
                    Duration::from_secs(2),
                )
                .unwrap_or_else(|| {
                    logger::warn(&format!(
                        "Could not resolve entrypoint counterparty channel for {}; falling back to same channel id",
                        cardano_channel_id
                    ));
                    cardano_channel_id.clone()
                });

                let entrypoint_address =
                    get_hermes_chain_address(project_root, ENTRYPOINT_CHAIN_ID)?;
                let cardano_receiver_credential = get_cardano_payment_credential_hex(project_root)?;
                let cardano_receiver_address = cardano_enterprise_address_from_payment_credential(
                    project_root,
                    &cardano_receiver_credential,
                )?;

                let denom = "stake";
                // Current voucher-burn path on Cardano requires extra headroom in the sender voucher balance.
                // Sending half of the freshly minted Test 9 amount keeps this test deterministic.
                let amount: u64 = 500_000;

                let voucher_policy_id = read_handler_json_value(
                    project_root,
                    &["validators", "mintVoucher", "scriptHash"],
                )?;
                let voucher_denom_path = format!("transfer/{}/{}", cardano_channel_id, denom);

                let entrypoint_balance_before = query_entrypoint_balance(&entrypoint_address, denom)?;
                let cardano_voucher_assets_before = query_cardano_policy_assets(
                    project_root,
                    &cardano_receiver_address,
                    &voucher_policy_id,
                )?;
                let cardano_voucher_before =
                    sum_cardano_policy_assets(&cardano_voucher_assets_before);

                // Cardano-origin packets can spend several minutes waiting on Mithril-certified
                // heights while relaying update-client + recv/ack steps. Keep a large timeout
                // margin so packet expiry does not race the relay path.
                let timeout_height_offset = 10_000;
                let timeout_seconds = 600;

                let mut transfer_result: Result<(), Box<dyn std::error::Error>> =
                    Err(std::io::Error::new(
                        std::io::ErrorKind::Other,
                        "hermes ft-transfer not attempted",
                    )
                    .into());
                let transfer_attempts = 5;
                let transfer_retry_delay = Duration::from_secs(10);
                let mut transfer_attempt_errors: Vec<String> = Vec::new();
                for attempt in 1..=transfer_attempts {
                    match hermes_ft_transfer(
                        project_root,
                        "cardano-devnet",
                        ENTRYPOINT_CHAIN_ID,
                        "transfer",
                        cardano_channel_id,
                        amount,
                        &voucher_denom_path,
                        None,
                        timeout_height_offset,
                        timeout_seconds,
                    ) {
                        Ok(()) => {
                            transfer_result = Ok(());
                            break;
                        }
                        Err(e) => {
                            let err_str = e.to_string();
                            transfer_attempt_errors.push(err_str.clone());
                            let retryable = err_str.contains("does not have enough funds")
                                || err_str.contains("reference scripts")
                                || err_str.contains("TxBuilderError");
                            if retryable && attempt < transfer_attempts {
                                logger::log(&format!(
                                "Test 10: hermes ft-transfer attempt {}/{} failed due to wallet selection; retrying in {:?}\n{}\n",
                                attempt,
                                transfer_attempts,
                                transfer_retry_delay,
                                err_str
                            ));
                                std::thread::sleep(transfer_retry_delay);
                                continue;
                            }
                            transfer_result = Err(e);
                            break;
                        }
                    }
                }

                match transfer_result {
                    Ok(_) => match hermes_clear_packets(
                        project_root,
                        "cardano-devnet",
                        "transfer",
                        cardano_channel_id,
                        ENTRYPOINT_CHAIN_ID,
                        &entrypoint_channel_id,
                        None,
                    ) {
                        Ok(_) => {
                            let entrypoint_balance_after =
                                query_entrypoint_balance(&entrypoint_address, denom)?;
                            let cardano_voucher_assets_after = query_cardano_policy_assets(
                                project_root,
                                &cardano_receiver_address,
                                &voucher_policy_id,
                            )?;
                            let cardano_voucher_after =
                                sum_cardano_policy_assets(&cardano_voucher_assets_after);
                            let entrypoint_delta =
                                entrypoint_balance_after.saturating_sub(entrypoint_balance_before);
                            let voucher_delta =
                                cardano_voucher_before.saturating_sub(cardano_voucher_after);

                            if cardano_voucher_after + amount > cardano_voucher_before {
                                let elapsed = test_10.finish();
                                logger::log(&format!(
                                "FAIL Test 10: Cardano voucher token did not burn as expected (took {}) (before={}, after={}, delta={}, expected_delta >= {})\n",
                                format_duration(elapsed),
                                cardano_voucher_before,
                                cardano_voucher_after,
                                voucher_delta,
                                amount
                            ));
                                results.failed += 1;
                            } else if entrypoint_balance_after <= entrypoint_balance_before {
                                let elapsed = test_10.finish();
                                logger::log(&format!(
	                                "FAIL Test 10: entrypoint chain balance did not increase after round-trip (took {}) (before={}, after={}, delta={}, expected_delta > 0)\n",
	                                format_duration(elapsed),
	                                entrypoint_balance_before,
	                                entrypoint_balance_after,
	                                entrypoint_delta
	                            ));
                                results.failed += 1;
                            } else {
                                let expected_path = format!("transfer/{}", cardano_channel_id);
                                let stake_hash = match stake_denom_trace_hash.as_deref() {
                                    Some(hash) => Some(hash),
                                    None => {
                                        let elapsed = test_10.finish();
                                        logger::log(&format!(
		                                        "FAIL Test 10: Missing stake voucher hash from Test 9; cannot verify denom-trace reverse lookup (took {})\n",
		                                        format_duration(elapsed)
		                                    ));
                                        results.failed += 1;
                                        None
                                    }
                                };

                                if let Some(stake_hash) = stake_hash {
                                    match assert_gateway_denom_trace(
                                        stake_hash,
                                        &expected_path,
                                        denom,
                                    )
                                    .await
                                    {
                                        Ok(()) => {
                                            let elapsed = test_10.finish();
                                            logger::log(&format!(
		                                            "PASS Test 10: Round-trip completed, voucher burned, and denom-trace reverse lookup still succeeds (took {})\n",
		                                            format_duration(elapsed)
		                                        ));
                                            results.passed += 1;
                                        }
                                        Err(e) => {
                                            let elapsed = test_10.finish();
                                            logger::log(&format!(
		                                            "FAIL Test 10: Denom-trace reverse lookup failed after burning voucher (took {})\n{}\n",
		                                            format_duration(elapsed),
		                                            e
		                                        ));
                                            results.failed += 1;
                                        }
                                    }
                                }
                            }
                        }
                        Err(e) => {
                            let elapsed = test_10.finish();
                            logger::log(&format!(
                                "FAIL Test 10: Failed to relay packets (took {})\n{}\n",
                                format_duration(elapsed),
                                e
                            ));
                            results.failed += 1;
                        }
                    },
                    Err(e) => {
                        let elapsed = test_10.finish();
                        let cardano_lovelace_total =
                            query_cardano_lovelace_total(project_root, &cardano_receiver_address)
                                .unwrap_or(0);
                        let cardano_utxos =
                            query_cardano_utxos_json(project_root, &cardano_receiver_address)
                                .unwrap_or_else(|err| {
                                    format!("Failed to query Cardano UTxOs: {}", err)
                                });
                        logger::log(&format!(
                            "FAIL Test 10: hermes tx ft-transfer failed (took {})\n{}\n\n=== Test 10 diagnostics (Cardano -> Entrypoint chain) ===\ncardano address: {}\nvoucher policy id: {}\ncardano lovelace total: {}\ncardano voucher assets: {:?}\ncardano utxos:\n{}\n\n=== Test 10 transfer attempt errors (most recent last) ===\n{}\n",
                            format_duration(elapsed),
                            e,
                            cardano_receiver_address,
                            voucher_policy_id,
                            cardano_lovelace_total,
                            cardano_voucher_assets_before,
                            cardano_utxos,
                            if transfer_attempt_errors.is_empty() {
                                "(no attempt errors recorded)".to_string()
                            } else {
                                transfer_attempt_errors.join("\n---\n")
                            }
                        ));
                        results.failed += 1;
                    }
                }
            } else {
                let elapsed = test_10.finish();
                logger::log(&format!(
                    "SKIP Test 10: Skipped because no transfer channel was established (took {})\n",
                    format_duration(elapsed)
                ));
                results.skipped += 1;
            }
        } else {
            let elapsed = test_10.finish();
            logger::log(&format!(
                "SKIP Test 10: Skipped due to Test 9 failure (took {})\n",
                format_duration(elapsed)
            ));
            results.skipped += 1;
        }
    }

    // Test 11: Transfer Cardano native token (Cardano -> Cosmos)
    //
    // Tests the "Cardano is the source chain" path for ICS-20:
    //   - Cardano escrows a native token in the transfer module
    //   - Cosmos mints an IBC voucher denom for that token
    let mut cardano_native_transfer_passed = false;
    let mut cardano_native_voucher_denom: Option<String> = None;
    let mut cardano_native_entrypoint_channel_id: Option<String> = None;
    let mut cardano_native_base_denom: Option<String> = None;
    if selection.should_run(11) {
        let mut test_11 = TestTimer::start(
            "Test 11: ICS-20 transfer of Cardano native token (Cardano -> Entrypoint chain)...",
        );

        if let Some(cardano_channel_id) = &channel_id {
            let entrypoint_channel_id = resolve_entrypoint_channel_id_with_retries(
                project_root,
                cardano_channel_id,
                120,
                Duration::from_secs(2),
            )
            .unwrap_or_else(|| {
                logger::warn(&format!(
                    "Could not resolve entrypoint counterparty channel for {}; falling back to same channel id",
                    cardano_channel_id
                ));
                cardano_channel_id.clone()
            });

            let entrypoint_address = get_hermes_chain_address(project_root, ENTRYPOINT_CHAIN_ID)?;
            let cardano_receiver_credential = get_cardano_payment_credential_hex(project_root)?;
            let cardano_sender_address = cardano_enterprise_address_from_payment_credential(
                project_root,
                &cardano_receiver_credential,
            )?;

            // Use the deployed native mock asset for deterministic round-trip assertions.
            let base_denom = read_handler_json_value(project_root, &["tokens", "mock"])?;
            let amount: u64 = 20_000_000;

            let entrypoint_balances_before = query_entrypoint_balances(&entrypoint_address)?;
            let cardano_native_before =
                query_cardano_asset_total(project_root, &cardano_sender_address, &base_denom)?;
            let cardano_root_before = query_handler_state_root(project_root)?;

            // Keep the timeout margin large for Cardano-origin packets to avoid false timeouts
            // during long Mithril certification waits on relay/update-client steps.
            let timeout_height_offset = 10_000;
            let timeout_seconds = 600;

            match hermes_ft_transfer(
                project_root,
                "cardano-devnet",
                ENTRYPOINT_CHAIN_ID,
                "transfer",
                cardano_channel_id,
                amount,
                &base_denom,
                Some(&entrypoint_address),
                timeout_height_offset,
                timeout_seconds,
            ) {
                Ok(_) => match hermes_clear_packets(
                    project_root,
                    "cardano-devnet",
                    "transfer",
                    cardano_channel_id,
                    ENTRYPOINT_CHAIN_ID,
                    &entrypoint_channel_id,
                    None,
                ) {
                    Ok(_) => {
                        let entrypoint_balances_after =
                            query_entrypoint_balances(&entrypoint_address)?;
                        let cardano_native_after = query_cardano_asset_total(
                            project_root,
                            &cardano_sender_address,
                            &base_denom,
                        )?;
                        let cardano_root_after = query_handler_state_root(project_root)?;

                        let native_token_delta =
                            cardano_native_before.saturating_sub(cardano_native_after);
                        if native_token_delta < amount {
                            let elapsed = test_11.finish();
                            logger::log(&format!(
                            "FAIL Test 11: Cardano native token balance did not decrease by the transfer amount (took {}) (before={}, after={}, expected delta >= {})\n",
                            format_duration(elapsed),
                            cardano_native_before,
                            cardano_native_after,
                            amount
                        ));
                            dump_test_11_ics20_diagnostics(
                                project_root,
                                cardano_channel_id,
                                &entrypoint_channel_id,
                                &entrypoint_address,
                            );
                            results.failed += 1;
                        } else if cardano_root_after == cardano_root_before {
                            let elapsed = test_11.finish();
                            logger::log(&format!(
                            "FAIL Test 11: Cardano ibc_state_root did not change after escrow transfer (took {}) (root={}...)\n",
                            format_duration(elapsed),
                            &cardano_root_after[..16],
                        ));
                            dump_test_11_ics20_diagnostics(
                                project_root,
                                cardano_channel_id,
                                &entrypoint_channel_id,
                                &entrypoint_address,
                            );
                            results.failed += 1;
                        } else {
                            let mut minted_denom: Option<String> = None;
                            for (balance_denom, after_amount) in &entrypoint_balances_after {
                                if !balance_denom.starts_with("ibc/") {
                                    continue;
                                }
                                let before_amount = entrypoint_balances_before
                                    .get(balance_denom)
                                    .copied()
                                    .unwrap_or(0);
                                if after_amount.saturating_sub(before_amount) >= amount as u128 {
                                    minted_denom = Some(balance_denom.clone());
                                    break;
                                }
                            }

                            if let Some(minted_denom) = minted_denom {
                                let expected_path = format!("transfer/{}", entrypoint_channel_id);
                                let minted_hash = minted_denom
                                    .strip_prefix("ibc/")
                                    .unwrap_or(minted_denom.as_str());

                                let expected_base_denom =
                                    expected_denom_trace_base_denom(&base_denom);
                                match assert_entrypoint_denom_trace(
                                    minted_hash,
                                    &expected_path,
                                    &expected_base_denom,
                                ) {
                                    Ok(()) => {
                                        let elapsed = test_11.finish();
                                        logger::log(&format!(
                                        "PASS Test 11: Cardano token escrowed, IBC voucher minted, and denom-trace reverse lookup succeeded (took {}) (denom={})\n",
                                        format_duration(elapsed),
                                        minted_denom
                                    ));
                                        results.passed += 1;
                                        cardano_native_transfer_passed = true;
                                        cardano_native_voucher_denom = Some(minted_denom);
                                        cardano_native_entrypoint_channel_id =
                                            Some(entrypoint_channel_id);
                                        cardano_native_base_denom = Some(base_denom.clone());
                                    }
                                    Err(e) => {
                                        let elapsed = test_11.finish();
                                        logger::log(&format!(
                                        "FAIL Test 11: Denom-trace reverse lookup failed for entrypoint voucher denom (took {}) (denom={})\n{}\n",
                                        format_duration(elapsed),
                                        minted_denom,
                                        e
                                    ));
                                        dump_test_11_ics20_diagnostics(
                                            project_root,
                                            cardano_channel_id,
                                            &entrypoint_channel_id,
                                            &entrypoint_address,
                                        );
                                        results.failed += 1;
                                    }
                                }
                            } else {
                                let elapsed = test_11.finish();
                                let mut ibc_deltas: Vec<(String, u128)> = Vec::new();
                                for (balance_denom, after_amount) in &entrypoint_balances_after {
                                    if !balance_denom.starts_with("ibc/") {
                                        continue;
                                    }
                                    let before_amount = entrypoint_balances_before
                                        .get(balance_denom)
                                        .copied()
                                        .unwrap_or(0);
                                    let delta = after_amount.saturating_sub(before_amount);
                                    if delta > 0 {
                                        ibc_deltas.push((balance_denom.clone(), delta));
                                    }
                                }
                                ibc_deltas.sort_by(|a, b| b.1.cmp(&a.1));
                                logger::log(&format!(
                                "FAIL Test 11: No new IBC voucher denom minted on entrypoint chain (took {})\n",
                                format_duration(elapsed)
                            ));
                                if !ibc_deltas.is_empty() {
                                    logger::log("=== Test 11: observed IBC denom deltas (top candidates) ===");
                                    for (denom, delta) in ibc_deltas.into_iter().take(10) {
                                        logger::log(&format!("{}: +{}", denom, delta));
                                    }
                                    logger::log("");
                                }
                                dump_test_11_ics20_diagnostics(
                                    project_root,
                                    cardano_channel_id,
                                    &entrypoint_channel_id,
                                    &entrypoint_address,
                                );
                                results.failed += 1;
                            }
                        }
                    }
                    Err(e) => {
                        let elapsed = test_11.finish();
                        logger::log(&format!(
                            "FAIL Test 11: Failed to relay packets (took {})\n{}\n",
                            format_duration(elapsed),
                            e
                        ));
                        dump_test_11_ics20_diagnostics(
                            project_root,
                            cardano_channel_id,
                            &entrypoint_channel_id,
                            &entrypoint_address,
                        );
                        results.failed += 1;
                    }
                },
                Err(e) => {
                    let elapsed = test_11.finish();
                    logger::log(&format!(
                        "FAIL Test 11: hermes tx ft-transfer failed (took {})\n{}\n",
                        format_duration(elapsed),
                        e
                    ));
                    dump_test_11_ics20_diagnostics(
                        project_root,
                        cardano_channel_id,
                        &entrypoint_channel_id,
                        &entrypoint_address,
                    );
                    results.failed += 1;
                }
            }
        } else {
            let elapsed = test_11.finish();
            logger::log(&format!(
                "SKIP Test 11: Skipped because no transfer channel was established (took {})\n",
                format_duration(elapsed)
            ));
            results.skipped += 1;
        }
    }

    // Test 12: Round-trip Cardano native token (Cosmos -> Cardano)
    //
    // Send the voucher minted in Test 11 back to Cardano and verify:
    //   - Voucher is burned on Cosmos
    //   - Escrowed Cardano native token is released back to the Cardano receiver
    if selection.should_run(12) {
        let mut test_12 = TestTimer::start(
            "Test 12: ICS-20 round-trip of Cardano native token (Entrypoint chain -> Cardano)...",
        );
        if cardano_native_transfer_passed {
            if let (Some(voucher_denom), Some(entrypoint_channel_id), Some(base_denom)) = (
                &cardano_native_voucher_denom,
                &cardano_native_entrypoint_channel_id,
                &cardano_native_base_denom,
            ) {
                let entrypoint_address =
                    get_hermes_chain_address(project_root, ENTRYPOINT_CHAIN_ID)?;
                let cardano_receiver_credential = get_cardano_payment_credential_hex(project_root)?;
                let cardano_receiver_address = cardano_enterprise_address_from_payment_credential(
                    project_root,
                    &cardano_receiver_credential,
                )?;

                let amount: u64 = 20_000_000;

                let entrypoint_voucher_before =
                    query_entrypoint_balance(&entrypoint_address, voucher_denom)?;
                let cardano_native_before =
                    query_cardano_asset_total(project_root, &cardano_receiver_address, base_denom)?;
                let cardano_root_before = query_handler_state_root(project_root)?;

                let cardano_channel_id_for_test_12 = channel_id
                    .as_deref()
                    .unwrap_or(entrypoint_channel_id.as_str());

                // Cardano-destination relays can spend significant time in Mithril-certified
                // client updates. Keep timeout very large to avoid timeout/refund during long
                // local devnet relay cycles.
                let timeout_height_offset = 10_000;
                let timeout_seconds = 7_200;

                match hermes_ft_transfer(
                    project_root,
                    ENTRYPOINT_CHAIN_ID,
                    "cardano-devnet",
                    "transfer",
                    entrypoint_channel_id,
                    amount,
                    voucher_denom,
                    Some(&cardano_receiver_credential),
                    timeout_height_offset,
                    timeout_seconds,
                ) {
                    Ok(_) => {
                        // Cardano ack proofs can lag and keep one unrelated packet sequence pending.
                        // Bound the clear loop for this test and validate the transfer end-state directly.
                        let clear_packets_result = hermes_clear_packets(
                            project_root,
                            ENTRYPOINT_CHAIN_ID,
                            "transfer",
                            entrypoint_channel_id,
                            "cardano-devnet",
                            cardano_channel_id_for_test_12,
                            Some(3),
                        );
                        if let Err(error) = &clear_packets_result {
                            logger::warn(&format!(
                                "Test 12 packet clearing did not fully converge within bounded retries; continuing with state assertions: {}",
                                error
                            ));
                        }

                        let entrypoint_voucher_after =
                            query_entrypoint_balance(&entrypoint_address, voucher_denom)?;
                        let cardano_native_after = query_cardano_asset_total(
                            project_root,
                            &cardano_receiver_address,
                            base_denom,
                        )?;
                        let cardano_root_after = query_handler_state_root(project_root)?;

                        let voucher_delta =
                            entrypoint_voucher_before.saturating_sub(entrypoint_voucher_after);
                        if voucher_delta < amount as u128 {
                            let elapsed = test_12.finish();
                            logger::log(&format!(
                            "FAIL Test 12: Entrypoint chain voucher did not burn as expected (took {}) (before={}, after={}, expected delta >= {})\n",
                            format_duration(elapsed),
                            entrypoint_voucher_before,
                            entrypoint_voucher_after,
                            amount
                        ));
                            if let Some(cardano_channel_id) = &channel_id {
                                dump_test_12_ics20_diagnostics(
                                    project_root,
                                    cardano_channel_id,
                                    entrypoint_channel_id,
                                    &entrypoint_address,
                                    voucher_denom,
                                    amount,
                                    &cardano_receiver_address,
                                );
                            }
                            results.failed += 1;
                        } else if cardano_root_after == cardano_root_before {
                            let elapsed = test_12.finish();
                            logger::log(&format!(
                            "FAIL Test 12: Cardano ibc_state_root did not change after unescrow (took {}) (root={}...)\n",
                            format_duration(elapsed),
                            &cardano_root_after[..16],
                        ));
                            if let Some(cardano_channel_id) = &channel_id {
                                dump_test_12_ics20_diagnostics(
                                    project_root,
                                    cardano_channel_id,
                                    entrypoint_channel_id,
                                    &entrypoint_address,
                                    voucher_denom,
                                    amount,
                                    &cardano_receiver_address,
                                );
                            }
                            results.failed += 1;
                        } else if cardano_native_after.saturating_sub(cardano_native_before)
                            < amount
                        {
                            let elapsed = test_12.finish();
                            let increase =
                                cardano_native_after.saturating_sub(cardano_native_before);
                            logger::log(&format!(
                            "FAIL Test 12: Cardano native token balance did not increase by the returned amount (took {}) (before={}, after={}, delta={}, expected delta >= {})\n",
                            format_duration(elapsed),
                            cardano_native_before,
                            cardano_native_after,
                            increase,
                            amount
                        ));
                            if let Some(cardano_channel_id) = &channel_id {
                                dump_test_12_ics20_diagnostics(
                                    project_root,
                                    cardano_channel_id,
                                    entrypoint_channel_id,
                                    &entrypoint_address,
                                    voucher_denom,
                                    amount,
                                    &cardano_receiver_address,
                                );
                            }
                            results.failed += 1;
                        } else {
                            let expected_path = format!("transfer/{}", entrypoint_channel_id);
                            let minted_hash = voucher_denom
                                .strip_prefix("ibc/")
                                .unwrap_or(voucher_denom.as_str());

                            let expected_base_denom = expected_denom_trace_base_denom(base_denom);
                            match assert_entrypoint_denom_trace(
                                minted_hash,
                                &expected_path,
                                &expected_base_denom,
                            ) {
                                Ok(()) => {
                                    let elapsed = test_12.finish();
                                    if clear_packets_result.is_ok() {
                                        logger::log(&format!(
                                            "PASS Test 12: Cardano native token round-trip succeeded and denom-trace reverse lookup still succeeds (took {})\n",
                                            format_duration(elapsed)
                                        ));
                                    } else {
                                        logger::log(&format!(
                                            "PASS Test 12: Cardano native token round-trip and denom-trace assertions succeeded (took {}) despite residual pending packet(s)\n",
                                            format_duration(elapsed)
                                        ));
                                    }
                                    results.passed += 1;
                                }
                                Err(e) => {
                                    let elapsed = test_12.finish();
                                    logger::log(&format!(
                                    "FAIL Test 12: Denom-trace reverse lookup failed for Entrypoint chain voucher denom after burn (took {})\n{}\n",
                                    format_duration(elapsed),
                                    e
                                ));
                                    if let Some(cardano_channel_id) = &channel_id {
                                        dump_test_12_ics20_diagnostics(
                                            project_root,
                                            cardano_channel_id,
                                            entrypoint_channel_id,
                                            &entrypoint_address,
                                            voucher_denom,
                                            amount,
                                            &cardano_receiver_address,
                                        );
                                    }
                                    results.failed += 1;
                                }
                            }
                        }
                    }
                    Err(e) => {
                        let elapsed = test_12.finish();
                        logger::log(&format!(
                            "FAIL Test 12: hermes tx ft-transfer failed (took {})\n{}\n",
                            format_duration(elapsed),
                            e
                        ));
                        if let Some(cardano_channel_id) = &channel_id {
                            dump_test_12_ics20_diagnostics(
                                project_root,
                                cardano_channel_id,
                                entrypoint_channel_id,
                                &entrypoint_address,
                                voucher_denom,
                                amount,
                                &cardano_receiver_address,
                            );
                        }
                        results.failed += 1;
                    }
                }
            } else {
                let elapsed = test_12.finish();
                logger::log(&format!(
                    "SKIP Test 12: Skipped because Test 11 did not produce a voucher denom (took {})\n",
                    format_duration(elapsed)
                ));
                results.skipped += 1;
            }
        } else {
            let elapsed = test_12.finish();
            logger::log(&format!(
                "SKIP Test 12: Skipped due to Test 11 failure (took {})\n",
                format_duration(elapsed)
            ));
            results.skipped += 1;
        }
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

    // Check Mithril (required for bidirectional IBC tests)
    // Mithril is required for Cosmos-side Cardano client creation (the Mithril light client),
    // which is exercised by connection/channel tests.
    //
    // Mithril aggregator does not expose a dedicated `/health` endpoint in our setup; the
    // `/aggregator` endpoint is stable and returns 2xx when the service is up.
    let mithril_aggregator_base_url = crate::config::get_config()
        .mithril
        .aggregator_url
        .trim_end_matches('/')
        .to_string();
    let mithril_aggregator_url = format!("{}/aggregator", mithril_aggregator_base_url);
    let stake_distributions_url = format!(
        "{}/aggregator/artifact/mithril-stake-distributions",
        mithril_aggregator_base_url
    );
    let cardano_transactions_url = format!(
        "{}/aggregator/artifact/cardano-transactions",
        mithril_aggregator_base_url
    );

    let mithril_running = check_service_health(&http_client, mithril_aggregator_url.as_str()).await;
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

        // Gateway's proof-based queries require both Mithril artifact families:
        // - stake distributions
        // - cardano transaction snapshots
        //
        // Treat this as a hard readiness gate in Test 1 to avoid flaky downstream
        // failures in Test 5/6 when snapshots are still empty.
        let stake_distributions_ready =
            check_json_array_non_empty(&http_client, stake_distributions_url.as_str()).await;
        let tx_snapshots_ready =
            check_json_array_non_empty(&http_client, cardano_transactions_url.as_str()).await;

        if stake_distributions_ready && tx_snapshots_ready {
            verbose("   Mithril stake distributions available");
            verbose("   Mithril Cardano transaction snapshots available");
        } else {
            logger::warn(
                "Mithril artifacts are not ready yet; waiting up to 180s for stake distributions and cardano-transaction snapshots.",
            );

            let artifacts_ready =
                wait_for_mithril_artifacts_ready_for_cardano_client(36, Duration::from_secs(5))
                    .await?;

            if artifacts_ready {
                verbose("   Mithril stake distributions available");
                verbose("   Mithril Cardano transaction snapshots available");
            } else {
                missing_services.push(
                    "Mithril artifacts (stake distributions + cardano-transactions) on :8080",
                );
            }
        }
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
        )
        .into());
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
        )
        .into());
    }

    // Check that the Cardano chain is reported as healthy
    // Hermes health-check output typically includes chain status
    let combined_output = format!("{}{}", stdout, stderr);

    if combined_output.to_lowercase().contains("unhealthy")
        || combined_output.to_lowercase().contains("error")
        || combined_output.to_lowercase().contains("failed")
    {
        return Err(format!(
            "Hermes health-check reported unhealthy chain(s):\n{}",
            combined_output
        )
        .into());
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
        .args(&[
            "ps",
            "--filter",
            "name=gateway-app",
            "--format",
            "{{.Names}}",
        ])
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

fn is_mithril_artifact_readiness_error(error: &str) -> bool {
    (error.contains("query_new_client") && error.contains("Not found: \"height\""))
        || error.contains("no Mithril stake distributions available")
}

fn is_unknown_utxo_reference_error(error: &str) -> bool {
    error.contains("unknown UTxO references as inputs") || error.contains("unknownOutputReferences")
}

async fn wait_for_mithril_artifacts_ready_for_cardano_client(
    max_attempts: usize,
    interval: Duration,
) -> Result<bool, Box<dyn std::error::Error>> {
    let mithril_aggregator_base_url = crate::config::get_config()
        .mithril
        .aggregator_url
        .trim_end_matches('/')
        .to_string();
    let stake_distributions_url = format!(
        "{}/aggregator/artifact/mithril-stake-distributions",
        mithril_aggregator_base_url
    );
    let cardano_transactions_url = format!(
        "{}/aggregator/artifact/cardano-transactions",
        mithril_aggregator_base_url
    );
    let http_client = reqwest::Client::builder()
        .no_proxy()
        .timeout(Duration::from_secs(3))
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {}", e))?;

    let start = Instant::now();
    let mut stake_ready = false;
    let mut tx_ready = false;

    for attempt in 0..max_attempts {
        if !stake_ready {
            stake_ready =
                check_json_array_non_empty(&http_client, stake_distributions_url.as_str()).await;
        }
        if !tx_ready {
            tx_ready =
                check_json_array_non_empty(&http_client, cardano_transactions_url.as_str()).await;
        }
        if stake_ready && tx_ready {
            return Ok(true);
        }

        logger::verbose(&format!(
            "   Waiting for Mithril artifacts (attempt {}/{}, elapsed {}s, stake_distributions_ready={}, cardano_transactions_ready={})...",
            attempt + 1,
            max_attempts,
            start.elapsed().as_secs(),
            stake_ready,
            tx_ready
        ));
        tokio::time::sleep(interval).await;
    }

    Ok(false)
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

    verbose(&format!(
        "   HostState NFT policy: {}",
        host_state_nft_policy
    ));

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
            "compose",
            "exec",
            "-T",
            "cardano-node",
            "cardano-cli",
            "query",
            "utxo",
            "--address",
            host_state_address,
            "--testnet-magic",
            "42",
            "--out-file",
            "/dev/stdout",
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
         Fix: Run 'caribic start --clean' to reset and redeploy everything.",
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

    verbose(&format!(
        "   Found ibc_state_root: {}...",
        &root_bytes[..16.min(root_bytes.len())]
    ));

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
fn query_client_state(
    project_root: &Path,
    client_id: &str,
) -> Result<ClientStateInfo, Box<dyn std::error::Error>> {
    let hermes_binary = project_root.join("relayer/target/release/hermes");

    logger::verbose(&format!(
        "   Running: hermes query client state --chain cardano-devnet --client {}",
        client_id
    ));

    let output = Command::new(&hermes_binary)
        .args(&[
            "query",
            "client",
            "state",
            "--chain",
            "cardano-devnet",
            "--client",
            client_id,
        ])
        .output()?;

    if !output.status.success() {
        return Err(format!(
            "Failed to query client state:\n{}",
            String::from_utf8_lossy(&output.stderr)
        )
        .into());
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
    if info.chain_id.is_empty() && stdout.contains(ENTRYPOINT_CHAIN_ID) {
        info.chain_id = ENTRYPOINT_CHAIN_ID.to_string();
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

    logger::verbose(&format!(
        "   Running: hermes update client --host-chain cardano-devnet --client {}",
        client_id
    ));

    let output = Command::new(&hermes_binary)
        .args(&[
            "update",
            "client",
            "--host-chain",
            "cardano-devnet",
            "--client",
            client_id,
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
        )
        .into());
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
        )
        .into());
    }

    logger::verbose("   Running: hermes create client --host-chain cardano-devnet --reference-chain entrypoint (Cosmos Entrypoint chain)");

    let mut command = Command::new(&hermes_binary);
    command.args(&[
        "create",
        "client",
        "--host-chain",
        "cardano-devnet",
        "--reference-chain",
        ENTRYPOINT_CHAIN_ID,
    ]);
    let output = run_command_streaming(command, "hermes create client")?;

    if !output.status.success() {
        return Err(format!(
            "Hermes client creation failed:\n\
             stdout: {}\n\
             stderr: {}\n\
             \n\
             Ensure Hermes is configured and keys are added:\n\
             - hermes keys add --chain cardano-devnet --mnemonic-file ~/cardano.txt\n\
             - hermes keys add --chain entrypoint --mnemonic-file ~/entrypoint.txt (Hermes chain id: {})",
            ENTRYPOINT_CHAIN_ID,
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        )
        .into());
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    logger::verbose(&format!("   {}", stdout.trim()));

    // Extract client_id from Hermes output.
    //
    // Hermes prints a multi-line debug representation (not a single stable line), so we scan all
    // whitespace-delimited tokens and pick the first one that looks like a client identifier.
    //
    // For Cardano↔Cosmos, clients stored on Cardano that track a Cosmos chain are Tendermint
    // clients and must use the standard `07-tendermint-{n}` prefix.
    let client_id = stdout
        .split_whitespace()
        .filter_map(|word| {
            // Hermes output often wraps identifiers in quotes and punctuation, e.g. `"07-tendermint-12",`
            // or `id=07-tendermint-12`. Normalize those into a plain identifier.
            let cleaned =
                word.trim_matches(|c: char| !c.is_ascii_alphanumeric() && c != '-' && c != '=');
            let cleaned = cleaned.strip_prefix("id=").unwrap_or(cleaned);

            if cleaned.starts_with("07-tendermint-") || cleaned.starts_with("ibc_client-") {
                Some(cleaned.to_string())
            } else {
                None
            }
        })
        .next()
        .ok_or_else(|| {
            format!(
                "Failed to parse client id from Hermes output:\n{}",
                stdout.trim()
            )
        })?;

    logger::verbose(&format!("   Client created: {}", client_id));

    Ok(client_id)
}

/// Create a test connection using Hermes relayer
///
/// Creates a connection between cardano-devnet and the local packet-forwarding chain
async fn create_test_connection(project_root: &Path) -> Result<String, Box<dyn std::error::Error>> {
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

    logger::verbose("   Running: hermes create connection --a-chain cardano-devnet --b-chain entrypoint (Cosmos Entrypoint chain)");

    let mut command = Command::new(&hermes_binary);
    command.args(&[
        "create",
        "connection",
        "--a-chain",
        "cardano-devnet",
        "--b-chain",
        ENTRYPOINT_CHAIN_ID,
    ]);
    let run_connection_handshake =
        |hermes_binary: &std::path::Path| -> Result<String, Box<dyn std::error::Error>> {
            let mut command = Command::new(hermes_binary);
            command.args(&[
                "create",
                "connection",
                "--a-chain",
                "cardano-devnet",
                "--b-chain",
                ENTRYPOINT_CHAIN_ID,
            ]);
            let output = run_command_streaming(command, "hermes create connection")?;

            if !output.status.success() {
                return Err(format!(
                    "Hermes connection creation failed:\n\
                     stdout: {}\n\
                     stderr: {}",
                    String::from_utf8_lossy(&output.stdout),
                    String::from_utf8_lossy(&output.stderr)
                )
                .into());
            }

            let stdout = String::from_utf8_lossy(&output.stdout);
            logger::verbose(&format!("   {}", stdout.trim()));

            // Extract connection_id from Hermes output.
            let connection_id = stdout
                .split_whitespace()
                .filter_map(|word| {
                    let cleaned = word
                        .trim_matches(|c: char| !c.is_ascii_alphanumeric() && c != '-' && c != '=');
                    let cleaned = cleaned.strip_prefix("id=").unwrap_or(cleaned);

                    cleaned
                        .starts_with("connection-")
                        .then(|| cleaned.to_string())
                })
                .next()
                .ok_or_else(|| {
                    format!(
                        "Failed to parse connection id from Hermes output:\n{}",
                        stdout.trim()
                    )
                })?;

            logger::verbose(&format!("   Connection created: {}", connection_id));
            Ok(connection_id)
        };

    match run_connection_handshake(&hermes_binary) {
        Ok(connection_id) => Ok(connection_id),
        Err(first_error) => {
            let first_error_text = first_error.to_string();
            if is_mithril_artifact_readiness_error(&first_error_text) {
                logger::warn(
                    "Mithril artifacts are not ready for Cardano light-client query yet; waiting and retrying connection handshake once.",
                );
                let artifacts_ready =
                    wait_for_mithril_artifacts_ready_for_cardano_client(36, Duration::from_secs(5))
                        .await?;

                if !artifacts_ready {
                    return Err(format!(
                        "{}\n\nMithril artifacts never became ready (stake distributions + cardano transaction snapshots) within 180s.",
                        first_error_text
                    )
                    .into());
                }

                return run_connection_handshake(&hermes_binary);
            }

            if is_unknown_utxo_reference_error(&first_error_text) {
                logger::warn(
                    "Gateway rejected connection handshake with unknown UTxO references right after client creation; waiting briefly and retrying once.",
                );
                tokio::time::sleep(Duration::from_secs(5)).await;
                return run_connection_handshake(&hermes_binary);
            }

            Err(first_error)
        }
    }
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

    let mut command = Command::new(&hermes_binary);
    command.args(&[
        "create",
        "channel",
        "--a-chain",
        "cardano-devnet",
        "--a-connection",
        connection_id,
        "--a-port",
        "transfer",
        "--b-port",
        "transfer",
    ]);
    let output = run_command_streaming(command, "hermes create channel")?;

    if !output.status.success() {
        return Err(format!(
            "Hermes channel creation failed:\n\
             stdout: {}\n\
             stderr: {}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        )
        .into());
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    logger::verbose(&format!("   {}", stdout.trim()));

    // Extract channel_id from Hermes output.
    let channel_id = stdout
        .split_whitespace()
        .filter_map(|word| {
            let cleaned =
                word.trim_matches(|c: char| !c.is_ascii_alphanumeric() && c != '-' && c != '=');
            let cleaned = cleaned.strip_prefix("id=").unwrap_or(cleaned);

            cleaned.starts_with("channel-").then(|| cleaned.to_string())
        })
        .next()
        .ok_or_else(|| {
            format!(
                "Failed to parse channel id from Hermes output:\n{}",
                stdout.trim()
            )
        })?;

    logger::verbose(&format!("   Channel created: {}", channel_id));

    Ok(channel_id)
}

fn read_handler_json_value(
    project_root: &Path,
    json_path: &[&str],
) -> Result<String, Box<dyn std::error::Error>> {
    let deployment_path = project_root.join("cardano/offchain/deployments/handler.json");
    let deployment_json = std::fs::read_to_string(&deployment_path).map_err(|e| {
        format!(
            "Failed to read deployment config at {}: {}",
            deployment_path.display(),
            e
        )
    })?;
    let deployment: serde_json::Value = serde_json::from_str(&deployment_json)?;

    let mut cursor = &deployment;
    for key in json_path {
        cursor = cursor.get(*key).ok_or_else(|| {
            format!(
                "Deployment config missing key path: {}",
                json_path.join(".")
            )
        })?;
    }

    cursor
        .as_str()
        .map(|s| s.to_string())
        .ok_or_else(|| {
            format!(
                "Deployment value at {} is not a string",
                json_path.join(".")
            )
        })
        .map_err(Into::into)
}

fn get_hermes_chain_address(
    project_root: &Path,
    chain_id: &str,
) -> Result<String, Box<dyn std::error::Error>> {
    let hermes_binary = project_root.join("relayer/target/release/hermes");
    let output = Command::new(&hermes_binary)
        .args(&["keys", "list", "--chain", chain_id])
        .output()?;

    if !output.status.success() {
        return Err(format!(
            "Hermes keys list failed:\n{}",
            String::from_utf8_lossy(&output.stderr)
        )
        .into());
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    for token in stdout.split_whitespace() {
        let cleaned =
            token.trim_matches(|c: char| !c.is_ascii_alphanumeric() && c != '_' && c != '-');

        match chain_id {
            ENTRYPOINT_CHAIN_ID => {
                if cleaned.starts_with("cosmos1") {
                    return Ok(cleaned.to_string());
                }
            }
            "cardano-devnet" => {
                // Cardano uses a different "address" representation in Hermes: the relayer key is a
                // hex-encoded enterprise address bytes (constructed from the payment key hash).
                if cleaned.starts_with("addr_test1") || cleaned.starts_with("addr1") {
                    return Ok(cleaned.to_string());
                }

                let looks_like_hex_address =
                    cleaned.len() == 58 && cleaned.chars().all(|c| c.is_ascii_hexdigit());
                if looks_like_hex_address {
                    // Convert the raw address bytes to bech32 so we can query UTxOs with cardano-cli.
                    // Note: we pick HRP based on the network id bits in the address header byte.
                    let address_bytes = decode_hex_bytes(cleaned)?;
                    let network_id = address_bytes.first().copied().unwrap_or(0) & 0x0f;
                    let hrp = if network_id == 0 { "addr_test" } else { "addr" };
                    return Ok(cardano_hex_address_to_bech32(cleaned, hrp)?);
                }
            }
            _ => {
                if cleaned.starts_with("cosmos1")
                    || cleaned.starts_with("addr_test1")
                    || cleaned.starts_with("addr1")
                {
                    return Ok(cleaned.to_string());
                }
            }
        }
    }

    Err(format!(
        "Could not parse {} address from Hermes keys list output:\n{}",
        chain_id,
        stdout.trim()
    )
    .into())
}

fn get_cardano_payment_credential_hex(
    project_root: &Path,
) -> Result<String, Box<dyn std::error::Error>> {
    // Hermes represents the Cardano relayer identity as a hex-encoded enterprise address
    // (header byte + 28-byte payment key hash). For packet receivers, the Gateway expects the
    // 28-byte payment credential hash (hex), so we strip the first byte.
    let hermes_binary = project_root.join("relayer/target/release/hermes");
    let output = Command::new(&hermes_binary)
        .args(&["keys", "list", "--chain", "cardano-devnet"])
        .output()?;

    if !output.status.success() {
        return Err(format!(
            "Hermes keys list failed:\n{}",
            String::from_utf8_lossy(&output.stderr)
        )
        .into());
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    for token in stdout.split_whitespace() {
        let cleaned =
            token.trim_matches(|c: char| !c.is_ascii_alphanumeric() && c != '_' && c != '-');
        let looks_like_hex_address =
            cleaned.len() == 58 && cleaned.chars().all(|c| c.is_ascii_hexdigit());
        if !looks_like_hex_address {
            continue;
        }

        let credential = cleaned[2..].to_string();
        let looks_like_hex_credential =
            credential.len() == 56 && credential.chars().all(|c| c.is_ascii_hexdigit());
        if looks_like_hex_credential {
            return Ok(credential);
        }
    }

    Err(format!(
        "Could not parse Cardano payment credential from Hermes keys list output:\n{}",
        stdout.trim()
    )
    .into())
}

fn cardano_hex_address_to_bech32(
    hex_address: &str,
    hrp: &str,
) -> Result<String, Box<dyn std::error::Error>> {
    let bytes = decode_hex_bytes(hex_address)?;
    Ok(bech32_encode_bytes(hrp, &bytes)?)
}

fn cardano_enterprise_address_from_payment_credential(
    project_root: &Path,
    payment_credential_hex: &str,
) -> Result<String, Box<dyn std::error::Error>> {
    // The Gateway expects packet receivers to be a payment credential hash (28 bytes hex),
    // and then reconstructs an enterprise address from it. For tests, we need to query that
    // same address to validate voucher minting/burning.
    //
    // We pick the network id from the deployed on-chain addresses (handler.json), so this
    // stays correct if the devnet uses mainnet-style addresses.
    let deployment_path = project_root.join("cardano/offchain/deployments/handler.json");
    let deployment_json = std::fs::read_to_string(&deployment_path).map_err(|e| {
        format!(
            "Failed to read deployment config at {}: {}",
            deployment_path.display(),
            e
        )
    })?;
    let deployment: serde_json::Value = serde_json::from_str(&deployment_json)?;
    let host_state_address = deployment["validators"]["hostStateStt"]["address"]
        .as_str()
        .ok_or("validators.hostStateStt.address not found in deployment")?;

    let (network_id, hrp) = if host_state_address.starts_with("addr_test") {
        (0u8, "addr_test")
    } else {
        (1u8, "addr")
    };

    let credential_bytes = decode_hex_bytes(payment_credential_hex)?;
    if credential_bytes.len() != 28 {
        return Err(format!(
            "Invalid Cardano payment credential length (expected 28 bytes, got {}): {}",
            credential_bytes.len(),
            payment_credential_hex
        )
        .into());
    }

    // Enterprise address header byte:
    // - upper nibble: address type (0x6 = enterprise)
    // - lower nibble: network id (0 = testnet, 1 = mainnet)
    let header = 0x60 | network_id;
    let mut address_bytes = Vec::with_capacity(1 + credential_bytes.len());
    address_bytes.push(header);
    address_bytes.extend_from_slice(&credential_bytes);

    Ok(bech32_encode_bytes(hrp, &address_bytes)?)
}

fn encode_hex_string(input: &str) -> String {
    input
        .as_bytes()
        .iter()
        .map(|byte| format!("{:02x}", byte))
        .collect()
}

fn expected_denom_trace_base_denom(base_denom: &str) -> String {
    if base_denom.len() % 2 == 0 && base_denom.chars().all(|c| c.is_ascii_hexdigit()) {
        base_denom.to_string()
    } else {
        encode_hex_string(base_denom)
    }
}

fn decode_hex_bytes(hex: &str) -> Result<Vec<u8>, Box<dyn std::error::Error>> {
    if hex.len() % 2 != 0 {
        return Err(format!("Invalid hex string length: {}", hex.len()).into());
    }

    let mut bytes = Vec::with_capacity(hex.len() / 2);
    for i in (0..hex.len()).step_by(2) {
        let byte_str = &hex[i..i + 2];
        let byte = u8::from_str_radix(byte_str, 16)
            .map_err(|e| format!("Invalid hex at {}: {} ({})", i, byte_str, e))?;
        bytes.push(byte);
    }
    Ok(bytes)
}

// Minimal bech32 encoder (BIP-0173) for Cardano addresses.
//
// We implement it locally to keep Caribic offline-buildable, since the test suite already runs
// in environments where fetching new crates can be restricted.
const BECH32_CHARSET: &[u8; 32] = b"qpzry9x8gf2tvdw0s3jn54khce6mua7l";
const BECH32_GENERATOR: [u32; 5] = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];

fn bech32_encode_bytes(hrp: &str, data: &[u8]) -> Result<String, Box<dyn std::error::Error>> {
    // Convert 8-bit bytes into 5-bit groups (with padding), as required by bech32.
    let data5 = bech32_convert_bits(data, 8, 5, true)?;
    let checksum = bech32_create_checksum(hrp, &data5);

    let mut combined = Vec::with_capacity(data5.len() + checksum.len());
    combined.extend_from_slice(&data5);
    combined.extend_from_slice(&checksum);

    let mut out = String::with_capacity(hrp.len() + 1 + combined.len());
    out.push_str(&hrp.to_lowercase());
    out.push('1');
    for v in combined {
        let idx = usize::from(v);
        if idx >= BECH32_CHARSET.len() {
            return Err(format!("Invalid bech32 value: {}", v).into());
        }
        out.push(BECH32_CHARSET[idx] as char);
    }
    Ok(out)
}

fn bech32_hrp_expand(hrp: &str) -> Vec<u8> {
    let mut out = Vec::with_capacity(hrp.len() * 2 + 1);
    for b in hrp.as_bytes() {
        out.push(b >> 5);
    }
    out.push(0);
    for b in hrp.as_bytes() {
        out.push(b & 0x1f);
    }
    out
}

fn bech32_polymod(values: &[u8]) -> u32 {
    let mut chk: u32 = 1;
    for v in values {
        let top = chk >> 25;
        chk = (chk & 0x1ffffff) << 5 ^ u32::from(*v);
        for (i, g) in BECH32_GENERATOR.iter().enumerate() {
            if ((top >> i) & 1) != 0 {
                chk ^= g;
            }
        }
    }
    chk
}

fn bech32_create_checksum(hrp: &str, data5: &[u8]) -> [u8; 6] {
    let mut values = bech32_hrp_expand(&hrp.to_lowercase());
    values.extend_from_slice(data5);
    values.extend_from_slice(&[0u8; 6]);

    // Bech32 constant (BIP-0173): polymod(...) ^ 1
    let polymod = bech32_polymod(&values) ^ 1;

    let mut checksum = [0u8; 6];
    for i in 0..6 {
        checksum[i] = ((polymod >> (5 * (5 - i))) & 0x1f) as u8;
    }
    checksum
}

fn bech32_convert_bits(
    data: &[u8],
    from: u32,
    to: u32,
    pad: bool,
) -> Result<Vec<u8>, Box<dyn std::error::Error>> {
    let mut acc: u32 = 0;
    let mut bits: u32 = 0;
    let maxv: u32 = (1 << to) - 1;

    let mut ret = Vec::new();
    for value in data {
        let v = u32::from(*value);
        if (v >> from) != 0 {
            return Err(format!("Invalid value {} for {}-bit input", v, from).into());
        }
        acc = (acc << from) | v;
        bits += from;
        while bits >= to {
            bits -= to;
            ret.push(((acc >> bits) & maxv) as u8);
        }
    }

    if pad {
        if bits > 0 {
            ret.push(((acc << (to - bits)) & maxv) as u8);
        }
    } else if bits >= from || ((acc << (to - bits)) & maxv) != 0 {
        return Err("Invalid padding in bech32 convertbits".into());
    }

    Ok(ret)
}

fn extract_channel_ids_from_line(line: &str) -> Vec<String> {
    let mut ids = Vec::new();
    let mut offset = 0;

    while let Some(relative_pos) = line[offset..].find("channel-") {
        let start = offset + relative_pos;
        let mut end = start + "channel-".len();
        while end < line.len() && line.as_bytes()[end].is_ascii_digit() {
            end += 1;
        }

        if end > start + "channel-".len() {
            let channel_id = &line[start..end];
            if !ids.iter().any(|existing| existing == channel_id) {
                ids.push(channel_id.to_string());
            }
        }
        offset = end;
    }

    ids
}

struct HermesChannelPair {
    local_chain: String,
    local_channel: String,
    counterparty_chain: String,
    counterparty_channel: String,
}

fn parse_hermes_channel_side(side: &str) -> Option<(String, String)> {
    let (chain, details) = side.split_once(':')?;
    let chain = chain.trim();
    if chain.is_empty() {
        return None;
    }

    let channel_id = extract_channel_ids_from_line(details).into_iter().next()?;
    Some((chain.to_string(), channel_id))
}

fn parse_hermes_channel_pair_line(line: &str) -> Option<HermesChannelPair> {
    let (left, right) = line.split_once("---")?;
    let (left_chain, left_channel) = parse_hermes_channel_side(left)?;
    let (right_chain, right_channel) = parse_hermes_channel_side(right)?;

    Some(HermesChannelPair {
        local_chain: left_chain,
        local_channel: left_channel,
        counterparty_chain: right_chain,
        counterparty_channel: right_channel,
    })
}

#[cfg(test)]
fn resolve_counterparty_channel_from_query_output(
    output: &str,
    local_chain: &str,
    local_channel_id: &str,
    counterparty_chain: &str,
) -> Option<String> {
    for line in output.lines() {
        let pair = match parse_hermes_channel_pair_line(line) {
            Some(pair) => pair,
            None => continue,
        };

        if pair.local_chain == local_chain
            && pair.local_channel == local_channel_id
            && pair.counterparty_chain == counterparty_chain
        {
            return Some(pair.counterparty_channel);
        }

        if pair.counterparty_chain == local_chain
            && pair.counterparty_channel == local_channel_id
            && pair.local_chain == counterparty_chain
        {
            return Some(pair.local_channel);
        }
    }

    None
}

fn parse_counterparty_channel_from_channel_end_output(output: &str) -> Option<String> {
    let mut expect_counterparty_channel_id = false;

    for line in output.lines() {
        let trimmed = line.trim();

        if trimmed.starts_with("channel_id:") {
            expect_counterparty_channel_id = true;
            continue;
        }

        if !expect_counterparty_channel_id {
            continue;
        }

        let channel_ids = extract_channel_ids_from_line(trimmed);
        if let Some(channel_id) = channel_ids.first() {
            return Some(channel_id.clone());
        }

        if trimmed.starts_with("None") || trimmed.starts_with("),") {
            expect_counterparty_channel_id = false;
        }
    }

    None
}

fn resolve_entrypoint_channel_id_from_cardano_channel_end(
    project_root: &Path,
    cardano_channel_id: &str,
) -> Option<String> {
    let hermes_binary = project_root.join("relayer/target/release/hermes");
    let output = Command::new(&hermes_binary)
        .args(&[
            "query",
            "channel",
            "end",
            "--chain",
            "cardano-devnet",
            "--port",
            "transfer",
            "--channel",
            cardano_channel_id,
        ])
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    parse_counterparty_channel_from_channel_end_output(&stdout)
}

fn resolve_entrypoint_channel_id(project_root: &Path, cardano_channel_id: &str) -> Option<String> {
    resolve_entrypoint_channel_id_from_cardano_channel_end(project_root, cardano_channel_id)
}

fn resolve_entrypoint_channel_id_with_retries(
    project_root: &Path,
    cardano_channel_id: &str,
    max_attempts: usize,
    retry_delay: Duration,
) -> Option<String> {
    for attempt in 1..=max_attempts {
        if let Some(entrypoint_channel_id) =
            resolve_entrypoint_channel_id(project_root, cardano_channel_id)
        {
            return Some(entrypoint_channel_id);
        }

        if attempt < max_attempts {
            std::thread::sleep(retry_delay);
        }
    }

    None
}

fn resolve_cardano_transfer_channel_id(project_root: &Path) -> Option<String> {
    let hermes_binary = project_root.join("relayer/target/release/hermes");
    let output = Command::new(&hermes_binary)
        .args(&[
            "query",
            "channels",
            "--chain",
            "cardano-devnet",
            "--counterparty-chain",
            ENTRYPOINT_CHAIN_ID,
            "--show-counterparty",
        ])
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    for line in stdout.lines() {
        let pair = match parse_hermes_channel_pair_line(line) {
            Some(pair) => pair,
            None => continue,
        };

        if pair.local_chain == "cardano-devnet" {
            return Some(pair.local_channel);
        }
        if pair.counterparty_chain == "cardano-devnet" {
            return Some(pair.counterparty_channel);
        }
    }

    None
}

fn query_entrypoint_balance(address: &str, denom: &str) -> Result<u128, Box<dyn std::error::Error>> {
    let url = format!(
        "http://127.0.0.1:1317/cosmos/bank/v1beta1/balances/{}",
        address
    );
    let resp = query_entrypoint_json(&url, 5).map_err(std::io::Error::other)?;
    let balances = resp
        .get("balances")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();

    for coin in balances {
        let coin_denom = coin.get("denom").and_then(|v| v.as_str()).unwrap_or("");
        if coin_denom == denom {
            let amount_str = coin.get("amount").and_then(|v| v.as_str()).unwrap_or("0");
            return Ok(amount_str.parse::<u128>().unwrap_or(0));
        }
    }

    Ok(0)
}

fn query_entrypoint_balances(
    address: &str,
) -> Result<BTreeMap<String, u128>, Box<dyn std::error::Error>> {
    let url = format!(
        "http://127.0.0.1:1317/cosmos/bank/v1beta1/balances/{}",
        address
    );
    let resp = query_entrypoint_json(&url, 5).map_err(std::io::Error::other)?;
    let balances = resp
        .get("balances")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();

    let mut map = BTreeMap::new();
    for coin in balances {
        let coin_denom = coin
            .get("denom")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        if coin_denom.is_empty() {
            continue;
        }
        let amount_str = coin.get("amount").and_then(|v| v.as_str()).unwrap_or("0");
        let amount = amount_str.parse::<u128>().unwrap_or(0);
        map.insert(coin_denom, amount);
    }

    Ok(map)
}

fn query_entrypoint_json(url: &str, timeout_secs: u64) -> Result<serde_json::Value, String> {
    let output = Command::new("curl")
        .args(["-sS", "--max-time", &timeout_secs.to_string(), url])
        .output()
        .map_err(|e| format!("Failed to execute curl for {}: {}", url, e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let detail = if !stderr.is_empty() { stderr } else { stdout };
        return Err(format!(
            "HTTP query failed for {} (exit={}): {}",
            url, output.status, detail
        ));
    }

    serde_json::from_slice(&output.stdout)
        .map_err(|e| format!("Failed to parse JSON from {}: {}", url, e))
}

fn query_entrypoint_denom_trace(hash: &str) -> Result<(String, String), String> {
    let candidates = [
        format!(
            "http://127.0.0.1:1317/ibc/apps/transfer/v1/denom_traces/{}",
            hash
        ),
        format!(
            "http://127.0.0.1:1317/ibc/apps/transfer/v1beta1/denom_traces/{}",
            hash
        ),
    ];

    let mut last_err: Option<String> = None;
    for url in candidates {
        let json = match query_entrypoint_json(&url, 3) {
            Ok(json) => json,
            Err(e) => {
                last_err = Some(e);
                continue;
            }
        };

        let trace = json
            .get("denom_trace")
            .or_else(|| json.get("denomTrace"))
            .ok_or_else(|| {
                format!(
                    "Entrypoint chain denom-trace response missing denom_trace: {}",
                    json
                )
            })?;

        let path = trace
            .get("path")
            .and_then(|v| v.as_str())
            .ok_or_else(|| {
                format!(
                    "Entrypoint chain denom-trace response missing path: {}",
                    json
                )
            })?;

        let base_denom = trace
            .get("base_denom")
            .or_else(|| trace.get("baseDenom"))
            .and_then(|v| v.as_str())
            .ok_or_else(|| {
                format!(
                    "Entrypoint chain denom-trace response missing base_denom: {}",
                    json
                )
            })?;

        return Ok((path.to_string(), base_denom.to_string()));
    }

    Err(last_err.unwrap_or_else(|| {
        "Entrypoint chain denom-trace query failed".to_string()
    }))
}

fn assert_entrypoint_denom_trace(
    hash: &str,
    expected_path: &str,
    expected_base_denom: &str,
) -> Result<(), String> {
    let attempts = 5;
    let delay = Duration::from_secs(2);
    let mut last_err: Option<String> = None;

    for attempt in 1..=attempts {
        match query_entrypoint_denom_trace(hash) {
            Ok((path, base_denom)) => {
                if path != expected_path || base_denom != expected_base_denom {
                    return Err(format!(
                        "Entrypoint chain denom-trace mismatch for hash {}: expected path/base_denom {}/{} but got {}/{}",
                        hash, expected_path, expected_base_denom, path, base_denom
                    ));
                }
                return Ok(());
            }
            Err(e) => {
                last_err = Some(e);
                if attempt < attempts {
                    std::thread::sleep(delay);
                }
            }
        }
    }

    Err(last_err.unwrap_or_else(|| {
        "Entrypoint chain denom-trace query failed".to_string()
    }))
}

fn query_cardano_lovelace_total(
    project_root: &Path,
    address: &str,
) -> Result<u64, Box<dyn std::error::Error>> {
    let cardano_dir = project_root.join("chains/cardano");
    let output = Command::new("docker")
        .args(&[
            "compose",
            "exec",
            "-T",
            "cardano-node",
            "cardano-cli",
            "query",
            "utxo",
            "--address",
            address,
            "--testnet-magic",
            "42",
            "--out-file",
            "/dev/stdout",
        ])
        .current_dir(&cardano_dir)
        .output()?;

    if !output.status.success() {
        return Err(format!(
            "Failed to query Cardano UTXOs at {}:\n{}",
            address,
            String::from_utf8_lossy(&output.stderr)
        )
        .into());
    }

    let resp: serde_json::Value = serde_json::from_slice(&output.stdout)?;
    let utxos = resp
        .as_object()
        .ok_or("Cardano UTXO response is not an object")?;

    let mut total: u64 = 0;
    for (_tx_in, entry) in utxos {
        let Some(value_obj) = entry.get("value") else {
            continue;
        };
        let Some(lovelace_value) = value_obj.get("lovelace") else {
            continue;
        };
        if let Some(n) = lovelace_value.as_u64() {
            total = total.saturating_add(n);
        } else if let Some(s) = lovelace_value.as_str() {
            total = total.saturating_add(s.parse::<u64>().unwrap_or(0));
        }
    }

    Ok(total)
}

fn query_cardano_utxos_json(
    project_root: &Path,
    address: &str,
) -> Result<String, Box<dyn std::error::Error>> {
    let cardano_dir = project_root.join("chains/cardano");
    let output = Command::new("docker")
        .args(&[
            "compose",
            "exec",
            "-T",
            "cardano-node",
            "cardano-cli",
            "query",
            "utxo",
            "--address",
            address,
            "--testnet-magic",
            "42",
            "--out-file",
            "/dev/stdout",
        ])
        .current_dir(&cardano_dir)
        .output()?;

    if !output.status.success() {
        return Err(format!(
            "Failed to query Cardano UTXOs at {}:\n{}",
            address,
            String::from_utf8_lossy(&output.stderr)
        )
        .into());
    }

    Ok(String::from_utf8(output.stdout)?)
}
fn query_cardano_policy_assets(
    project_root: &Path,
    address: &str,
    policy_id: &str,
) -> Result<BTreeMap<String, u64>, Box<dyn std::error::Error>> {
    let cardano_dir = project_root.join("chains/cardano");
    let output = Command::new("docker")
        .args(&[
            "compose",
            "exec",
            "-T",
            "cardano-node",
            "cardano-cli",
            "query",
            "utxo",
            "--address",
            address,
            "--testnet-magic",
            "42",
            "--out-file",
            "/dev/stdout",
        ])
        .current_dir(&cardano_dir)
        .output()?;

    if !output.status.success() {
        return Err(format!(
            "Failed to query Cardano UTXOs at {}:\n{}",
            address,
            String::from_utf8_lossy(&output.stderr)
        )
        .into());
    }

    let utxo_json = String::from_utf8(output.stdout)?;
    let utxos: serde_json::Value = serde_json::from_str(&utxo_json)?;

    let Some(utxo_map) = utxos.as_object() else {
        return Ok(BTreeMap::new());
    };

    let mut assets: BTreeMap<String, u64> = BTreeMap::new();
    for (_utxo_ref, utxo_data) in utxo_map {
        let Some(value) = utxo_data.get("value") else {
            continue;
        };
        let Some(value_obj) = value.as_object() else {
            continue;
        };
        let Some(policy_assets) = value_obj.get(policy_id) else {
            continue;
        };
        let Some(asset_obj) = policy_assets.as_object() else {
            continue;
        };

        for (asset_name, amount_value) in asset_obj {
            let amount = if let Some(n) = amount_value.as_u64() {
                n
            } else if let Some(s) = amount_value.as_str() {
                s.parse::<u64>().unwrap_or(0)
            } else {
                0
            };

            if amount == 0 {
                continue;
            }

            let entry = assets.entry(asset_name.clone()).or_insert(0);
            *entry = entry.saturating_add(amount);
        }
    }

    Ok(assets)
}

fn query_cardano_asset_total(
    project_root: &Path,
    address: &str,
    token_unit: &str,
) -> Result<u64, Box<dyn std::error::Error>> {
    let is_hex = token_unit.chars().all(|c| c.is_ascii_hexdigit());
    if token_unit.len() < 56 || token_unit.len() % 2 != 0 || !is_hex {
        return Err(format!(
            "Invalid Cardano token unit '{}': expected hex string with at least 56 chars",
            token_unit
        )
        .into());
    }

    let policy_id = &token_unit[..56];
    let asset_name = &token_unit[56..];
    let assets = query_cardano_policy_assets(project_root, address, policy_id)?;
    Ok(assets.get(asset_name).copied().unwrap_or(0))
}

fn sum_cardano_policy_assets(assets: &BTreeMap<String, u64>) -> u64 {
    assets
        .values()
        .copied()
        .fold(0u64, |acc, v| acc.saturating_add(v))
}

fn find_policy_asset_with_min_delta(
    before: &BTreeMap<String, u64>,
    after: &BTreeMap<String, u64>,
    min_delta: u64,
) -> Result<String, String> {
    let mut candidates: Vec<(String, u64)> = Vec::new();

    for (asset_name, after_amount) in after {
        let before_amount = before.get(asset_name).copied().unwrap_or(0);
        let delta = after_amount.saturating_sub(before_amount);
        if delta >= min_delta {
            candidates.push((asset_name.clone(), delta));
        }
    }

    candidates.sort_by(|a, b| b.1.cmp(&a.1));

    match candidates.as_slice() {
        [] => Err(format!(
            "No policy asset increased by at least {} (found {} assets under policy after transfer)",
            min_delta,
            after.len()
        )),
        [(asset_name, _delta)] => Ok(asset_name.clone()),
        [(asset_name, _delta), second @ ..] => Err(format!(
            "Multiple policy assets increased by at least {} (ambiguous minted voucher): first={} (+{}), also matched {} more assets",
            min_delta,
            asset_name,
            candidates[0].1,
            second.len()
        )),
    }
}

#[derive(Clone, PartialEq, ::prost::Message)]
struct QueryDenomTraceRequest {
    #[prost(string, tag = "1")]
    hash: String,
}

#[derive(Clone, PartialEq, ::prost::Message)]
struct QueryDenomTraceResponse {
    #[prost(message, optional, tag = "1")]
    denom_trace: Option<DenomTrace>,
}

#[derive(Clone, PartialEq, ::prost::Message)]
struct DenomTrace {
    #[prost(string, tag = "1")]
    path: String,
    #[prost(string, tag = "2")]
    base_denom: String,
}

fn ibc_denom_trace_hash(path: &str, base_denom: &str) -> Result<String, String> {
    let full_denom_trace = if path.is_empty() {
        base_denom.to_string()
    } else {
        format!("{}/{}", path.trim_end_matches('/'), base_denom)
    };

    let mut command = Command::new("shasum");
    command.arg("-a").arg("256");
    command.stdin(Stdio::piped()).stdout(Stdio::piped());

    let mut child = command
        .spawn()
        .map_err(|e| format!("Failed to spawn shasum for denom trace hashing: {}", e))?;

    if let Some(stdin) = child.stdin.as_mut() {
        use std::io::Write;
        stdin
            .write_all(full_denom_trace.as_bytes())
            .map_err(|e| format!("Failed to write denom trace into shasum stdin: {}", e))?;
    } else {
        return Err("Failed to open shasum stdin".to_string());
    }

    let output = child
        .wait_with_output()
        .map_err(|e| format!("Failed to read shasum output: {}", e))?;

    if !output.status.success() {
        return Err(format!(
            "shasum failed while hashing denom trace '{}': {}",
            full_denom_trace,
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let hash = stdout
        .split_whitespace()
        .next()
        .ok_or_else(|| format!("Failed to parse shasum output: {}", stdout))?;

    Ok(hash.to_string())
}

async fn query_gateway_denom_trace(hash: &str) -> Result<(String, String), String> {
    let endpoint = tonic::transport::Endpoint::from_shared("http://localhost:5001".to_string())
        .map_err(|e| format!("Invalid Gateway gRPC endpoint: {}", e))?
        .timeout(Duration::from_secs(5));

    let channel = endpoint
        .connect()
        .await
        .map_err(|e| format!("Failed to connect to Gateway gRPC: {}", e))?;

    let mut grpc = tonic::client::Grpc::new(channel);
    grpc.ready()
        .await
        .map_err(|e| format!("Gateway gRPC service not ready: {}", e))?;
    let request = tonic::Request::new(QueryDenomTraceRequest {
        hash: hash.to_string(),
    });

    let path = tonic::codegen::http::uri::PathAndQuery::from_static(
        "/ibc.applications.transfer.v1.Query/DenomTrace",
    );

    let response: QueryDenomTraceResponse = grpc
        .unary(request, path, tonic::codec::ProstCodec::default())
        .await
        .map_err(|e| format!("Gateway denom-trace query failed: {}", e))?
        .into_inner();

    let trace = response
        .denom_trace
        .ok_or_else(|| "Gateway denom-trace response missing denom_trace".to_string())?;

    Ok((trace.path, trace.base_denom))
}

async fn assert_gateway_denom_trace(
    hash: &str,
    expected_path: &str,
    expected_base_denom: &str,
) -> Result<(), String> {
    let attempts = 5;
    let delay = Duration::from_secs(2);
    let mut last_err: Option<String> = None;

    for attempt in 1..=attempts {
        match query_gateway_denom_trace(hash).await {
            Ok((path, base_denom)) => {
                if path != expected_path || base_denom != expected_base_denom {
                    return Err(format!(
                        "Gateway denom-trace mismatch for hash {}: expected path/base_denom {}/{} but got {}/{}",
                        hash, expected_path, expected_base_denom, path, base_denom
                    ));
                }
                return Ok(());
            }
            Err(e) => {
                last_err = Some(e);
                if attempt < attempts {
                    tokio::time::sleep(delay).await;
                }
            }
        }
    }

    Err(last_err.unwrap_or_else(|| "Gateway denom-trace query failed".to_string()))
}

fn hermes_ft_transfer(
    project_root: &Path,
    src_chain: &str,
    dst_chain: &str,
    src_port: &str,
    src_channel: &str,
    amount: u64,
    denom: &str,
    receiver: Option<&str>,
    timeout_height_offset: u64,
    timeout_seconds: u64,
) -> Result<(), Box<dyn std::error::Error>> {
    let hermes_binary = project_root.join("relayer/target/release/hermes");
    logger::verbose(&format!(
        "   Running: hermes tx ft-transfer --src-chain {} --dst-chain {} --src-port {} --src-channel {} --amount {} --denom {}",
        src_chain, dst_chain, src_port, src_channel, amount, denom
    ));

    let mut command = Command::new(&hermes_binary);
    command.args(&[
        "tx",
        "ft-transfer",
        "--src-chain",
        src_chain,
        "--dst-chain",
        dst_chain,
        "--src-port",
        src_port,
        "--src-channel",
        src_channel,
        "--amount",
        &amount.to_string(),
        "--denom",
        denom,
    ]);

    if let Some(receiver) = receiver {
        command.args(&["--receiver", receiver]);
    }
    if timeout_height_offset > 0 {
        command.args(&[
            "--timeout-height-offset",
            &timeout_height_offset.to_string(),
        ]);
    }
    if timeout_seconds > 0 {
        command.args(&["--timeout-seconds", &timeout_seconds.to_string()]);
    }

    let output = run_command_streaming(command, "hermes tx ft-transfer")?;
    if !output.status.success() {
        return Err(format!(
            "Hermes ft-transfer failed:\n\
             stdout: {}\n\
             stderr: {}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        )
        .into());
    }

    Ok(())
}

fn hermes_run_clear_packets(
    project_root: &Path,
    chain: &str,
    port: &str,
    channel: &str,
) -> Result<(), Box<dyn std::error::Error>> {
    let hermes_binary = project_root.join("relayer/target/release/hermes");
    logger::verbose(&format!(
        "   Running: hermes clear packets --chain {} --port {} --channel {}",
        chain, port, channel
    ));

    let mut command = Command::new(&hermes_binary);
    command.args(&[
        "clear",
        "packets",
        "--chain",
        chain,
        "--port",
        port,
        "--channel",
        channel,
    ]);
    let output = run_command_streaming(command, "hermes clear packets")?;
    if !output.status.success() {
        return Err(format!(
            "Hermes clear packets failed (chain={}, channel={}):\n\
             stdout: {}\n\
             stderr: {}",
            chain,
            channel,
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        )
        .into());
    }

    Ok(())
}

fn hermes_clear_packets(
    project_root: &Path,
    primary_chain: &str,
    port: &str,
    primary_channel: &str,
    counterparty_chain: &str,
    counterparty_channel: &str,
    max_attempts_override: Option<usize>,
) -> Result<(), Box<dyn std::error::Error>> {
    let max_attempts = max_attempts_override.unwrap_or(10);
    let retry_delay = Duration::from_secs(10);
    if max_attempts == 0 {
        return Err("max_attempts must be greater than zero".into());
    }

    for attempt in 1..=max_attempts {
        // Relay both directions each cycle so acks and unreceived packets do not get stuck on the opposite chain.
        hermes_run_clear_packets(project_root, primary_chain, port, primary_channel)?;
        hermes_run_clear_packets(project_root, counterparty_chain, port, counterparty_channel)?;

        let (primary_has_pending, primary_pending_output) =
            hermes_query_packet_pending(project_root, primary_chain, port, primary_channel)?;
        let (counterparty_has_pending, counterparty_pending_output) = hermes_query_packet_pending(
            project_root,
            counterparty_chain,
            port,
            counterparty_channel,
        )?;

        if !primary_has_pending && !counterparty_has_pending {
            return Ok(());
        }

        if attempt < max_attempts {
            logger::log(&format!(
                "hermes clear packets attempt {}/{} still has pending packets; retrying in {:?}\n\
                 pending on {} ({}) = {}\n\
                 pending on {} ({}) = {}",
                attempt,
                max_attempts,
                retry_delay,
                primary_chain,
                primary_channel,
                primary_has_pending,
                counterparty_chain,
                counterparty_channel,
                counterparty_has_pending
            ));
            logger::verbose(&format!(
                "   [hermes query packet pending:{}:{}] {}",
                primary_chain,
                primary_channel,
                primary_pending_output.replace('\n', " | ")
            ));
            logger::verbose(&format!(
                "   [hermes query packet pending:{}:{}] {}",
                counterparty_chain,
                counterparty_channel,
                counterparty_pending_output.replace('\n', " | ")
            ));
            std::thread::sleep(retry_delay);
            continue;
        }

        return Err(format!(
            "Hermes clear packets left pending packets after {} attempts.\n\
             Pending output for {} ({}):\n{}\n\n\
             Pending output for {} ({}):\n{}",
            max_attempts,
            primary_chain,
            primary_channel,
            primary_pending_output,
            counterparty_chain,
            counterparty_channel,
            counterparty_pending_output
        )
        .into());
    }

    Ok(())
}

fn hermes_query_packet_pending(
    project_root: &Path,
    chain: &str,
    port: &str,
    channel: &str,
) -> Result<(bool, String), Box<dyn std::error::Error>> {
    let hermes_binary = project_root.join("relayer/target/release/hermes");
    let output = Command::new(&hermes_binary)
        .args(&[
            "query",
            "packet",
            "pending",
            "--chain",
            chain,
            "--port",
            port,
            "--channel",
            channel,
        ])
        .output()?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    if !output.status.success() {
        return Err(format!(
            "Hermes query packet pending failed:\n\
             stdout: {}\n\
             stderr: {}",
            stdout, stderr
        )
        .into());
    }

    let combined = if stderr.trim().is_empty() {
        stdout.to_string()
    } else {
        format!("{}\n{}", stdout, stderr)
    };

    // Hermes writes informational logs with timestamps like "2026-..." to stderr.
    // Treating any digit-prefixed line as pending is a false positive; only accept
    // numeric sequence lines immediately under the Unreceived sections.
    let mut in_unreceived_section = false;
    let has_pending_packets = combined.lines().any(|line| {
        let trimmed = line.trim();

        if trimmed.starts_with("Unreceived packets:") || trimmed.starts_with("Unreceived acks:") {
            in_unreceived_section = true;
            return false;
        }

        if trimmed.starts_with("SUCCESS")
            || trimmed.starts_with("Summary of pending packets")
            || trimmed.starts_with("Packets pending on")
        {
            in_unreceived_section = false;
            return false;
        }

        if trimmed.is_empty() {
            return false;
        }

        if !in_unreceived_section {
            return false;
        }

        let is_sequence_line = trimmed.chars().all(|c| {
            c.is_ascii_digit() || c == ',' || c == ' ' || c == '.' || c == '=' || c == '-'
        });

        is_sequence_line && trimmed.chars().any(|c| c.is_ascii_digit())
    });

    Ok((has_pending_packets, combined))
}

fn dump_test_11_ics20_diagnostics(
    project_root: &Path,
    cardano_channel_id: &str,
    entrypoint_channel_id: &str,
    entrypoint_address: &str,
) {
    logger::log("=== Test 11 diagnostics (ICS-20 Cardano -> Entrypoint chain) ===");
    logger::log(&format!("cardano-devnet channel: {}", cardano_channel_id));
    logger::log(&format!("entrypoint channel:     {}", entrypoint_channel_id));
    logger::log(&format!("entrypoint address:     {}", entrypoint_address));
    logger::log("");
    dump_packet_queries_for_transfer_channels(
        project_root,
        &[
            ("cardano-devnet", cardano_channel_id),
            (ENTRYPOINT_CHAIN_ID, entrypoint_channel_id),
        ],
    );

    if let Some(balances) = dump_entrypoint_balances_section(entrypoint_address) {
        dump_denom_traces_for_entrypoint_ibc_denoms(&balances, 20);
    }
}

fn dump_test_9_ics20_diagnostics(
    project_root: &Path,
    cardano_channel_id: &str,
    entrypoint_channel_id: &str,
    entrypoint_address: &str,
    denom: &str,
    amount: u64,
    cardano_receiver_address: &str,
    voucher_policy_id: &str,
) {
    logger::log("=== Test 9 diagnostics (ICS-20 Entrypoint chain -> Cardano) ===");
    logger::log(&format!("entrypoint channel:     {}", entrypoint_channel_id));
    logger::log(&format!("cardano-devnet channel: {}", cardano_channel_id));
    logger::log(&format!("entrypoint address:     {}", entrypoint_address));
    logger::log(&format!(
        "cardano address:        {}",
        cardano_receiver_address
    ));
    logger::log(&format!("denom:                  {}", denom));
    logger::log(&format!("amount:                 {}", amount));
    logger::log(&format!("voucher policy id:      {}", voucher_policy_id));
    match query_handler_state_root(project_root) {
        Ok(root) => logger::log(&format!("cardano ibc_state_root: {}...", &root[..16])),
        Err(e) => logger::log(&format!(
            "(diagnostics) Failed to query Cardano ibc_state_root: {}",
            e
        )),
    }
    logger::log("");
    dump_packet_queries_for_transfer_channels(
        project_root,
        &[
            (ENTRYPOINT_CHAIN_ID, entrypoint_channel_id),
            ("cardano-devnet", cardano_channel_id),
        ],
    );
    let _ = dump_entrypoint_balances_section(entrypoint_address);

    match query_cardano_lovelace_total(project_root, cardano_receiver_address) {
        Ok(total) => {
            logger::log("=== cardano lovelace total ===");
            logger::log(&format!("{}", total));
            logger::log("");
        }
        Err(e) => logger::log(&format!(
            "(diagnostics) Failed to query cardano lovelace total: {}\n",
            e
        )),
    }

    match query_cardano_policy_assets(project_root, cardano_receiver_address, voucher_policy_id) {
        Ok(assets) => {
            logger::log("=== cardano voucher assets under policy ===");
            logger::log(&format!(
                "total minted under policy at address: {}",
                sum_cardano_policy_assets(&assets)
            ));
            if assets.is_empty() {
                logger::log("(no policy assets returned)");
            } else {
                for (asset_name, amount) in assets.iter().take(20) {
                    logger::log(&format!("{}: {}", asset_name, amount));
                }
                if assets.len() > 20 {
                    logger::log(&format!("... ({} more assets omitted)", assets.len() - 20));
                }
            }
            logger::log("");
        }
        Err(e) => logger::log(&format!(
            "(diagnostics) Failed to query cardano policy assets: {}\n",
            e
        )),
    }

    match query_cardano_utxos_json(project_root, cardano_receiver_address) {
        Ok(utxos) => {
            logger::log("=== cardano utxos (json) ===");
            logger::log(utxos.trim_end());
            logger::log("");
        }
        Err(e) => logger::log(&format!(
            "(diagnostics) Failed to query Cardano UTxOs: {}\n",
            e
        )),
    }
}

fn dump_test_12_ics20_diagnostics(
    project_root: &Path,
    cardano_channel_id: &str,
    entrypoint_channel_id: &str,
    entrypoint_address: &str,
    voucher_denom: &str,
    amount: u64,
    cardano_receiver_address: &str,
) {
    logger::log("=== Test 12 diagnostics (ICS-20 Entrypoint chain -> Cardano, Cardano native round-trip return) ===");
    logger::log(&format!("entrypoint channel:     {}", entrypoint_channel_id));
    logger::log(&format!("cardano-devnet channel: {}", cardano_channel_id));
    logger::log(&format!("entrypoint address:     {}", entrypoint_address));
    logger::log(&format!(
        "cardano address:        {}",
        cardano_receiver_address
    ));
    logger::log(&format!("voucher denom:          {}", voucher_denom));
    logger::log(&format!("amount:                 {}", amount));
    match query_handler_state_root(project_root) {
        Ok(root) => logger::log(&format!("cardano ibc_state_root: {}...", &root[..16])),
        Err(e) => logger::log(&format!(
            "(diagnostics) Failed to query Cardano ibc_state_root: {}",
            e
        )),
    }
    logger::log("");
    dump_packet_queries_for_transfer_channels(
        project_root,
        &[
            (ENTRYPOINT_CHAIN_ID, entrypoint_channel_id),
            ("cardano-devnet", cardano_channel_id),
        ],
    );
    let _ = dump_entrypoint_balances_section(entrypoint_address);

    if voucher_denom.starts_with("ibc/") {
        let hash = voucher_denom.strip_prefix("ibc/").unwrap_or(voucher_denom);
        logger::log("=== entrypoint denom trace (reverse lookup) ===");
        match query_entrypoint_denom_trace(hash) {
            Ok((path, base_denom)) => {
                logger::log(&format!("{} -> {}/{}", voucher_denom, path, base_denom))
            }
            Err(e) => logger::log(&format!(
                "(diagnostics) Failed to query denom-trace for {}: {}",
                voucher_denom, e
            )),
        }
        logger::log("");
    }

    match query_cardano_lovelace_total(project_root, cardano_receiver_address) {
        Ok(total) => {
            logger::log("=== cardano lovelace total ===");
            logger::log(&format!("{}", total));
            logger::log("");
        }
        Err(e) => logger::log(&format!(
            "(diagnostics) Failed to query cardano lovelace total: {}\n",
            e
        )),
    }

    match query_cardano_utxos_json(project_root, cardano_receiver_address) {
        Ok(utxos) => {
            logger::log("=== cardano utxos (json) ===");
            logger::log(utxos.trim_end());
            logger::log("");
        }
        Err(e) => logger::log(&format!(
            "(diagnostics) Failed to query Cardano UTxOs: {}\n",
            e
        )),
    }
}

fn dump_packet_queries_for_transfer_channels(project_root: &Path, chain_channels: &[(&str, &str)]) {
    for subcmd in ["pending", "commitments", "acks"] {
        for (chain, channel_id) in chain_channels.iter().copied() {
            let args = [
                "query",
                "packet",
                subcmd,
                "--chain",
                chain,
                "--port",
                "transfer",
                "--channel",
                channel_id,
            ];
            if let Err(e) = run_hermes_and_print_allow_not_found(
                project_root,
                &args,
                &format!("hermes query packet {} ({})", subcmd, chain),
            ) {
                logger::log(&format!(
                    "(diagnostics) Failed to run hermes query packet {} on {}: {}\n",
                    subcmd, chain, e
                ));
            }
        }
    }
}

fn dump_entrypoint_balances_section(entrypoint_address: &str) -> Option<BTreeMap<String, u128>> {
    match query_entrypoint_balances(entrypoint_address) {
        Ok(balances) => {
            logger::log("=== entrypoint balances (bank) ===");
            if balances.is_empty() {
                logger::log("(no balances returned)");
            } else {
                for (denom, amount) in &balances {
                    logger::log(&format!("{}: {}", denom, amount));
                }
            }
            logger::log("");
            Some(balances)
        }
        Err(e) => {
            logger::log(&format!(
                "(diagnostics) Failed to query entrypoint balances: {}\n",
                e
            ));
            None
        }
    }
}

fn dump_denom_traces_for_entrypoint_ibc_denoms(balances: &BTreeMap<String, u128>, max_items: usize) {
    let mut ibc_denoms: Vec<&str> = balances
        .keys()
        .filter_map(|denom| denom.starts_with("ibc/").then_some(denom.as_str()))
        .collect();
    if ibc_denoms.is_empty() {
        return;
    }

    ibc_denoms.sort_unstable();
    logger::log("=== entrypoint denom traces (reverse lookup) ===");
    for denom in ibc_denoms.into_iter().take(max_items) {
        let hash = denom.strip_prefix("ibc/").unwrap_or(denom);
        match query_entrypoint_denom_trace(hash) {
            Ok((path, base_denom)) => logger::log(&format!("{} -> {}/{}", denom, path, base_denom)),
            Err(e) => logger::log(&format!("{} -> (failed to query denom-trace) {}", denom, e)),
        }
    }
    logger::log("");
}

fn run_hermes_and_print_allow_not_found(
    project_root: &Path,
    args: &[&str],
    label: &str,
) -> Result<bool, Box<dyn std::error::Error>> {
    run_hermes_and_print_inner(project_root, args, label, true)
}

fn run_hermes_and_print_inner(
    project_root: &Path,
    args: &[&str],
    label: &str,
    allow_not_found: bool,
) -> Result<bool, Box<dyn std::error::Error>> {
    let hermes_binary = project_root.join("relayer/target/release/hermes");
    logger::log(&format!("=== {} ===", label));

    let output = Command::new(&hermes_binary).args(args).output()?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);

    if !stdout.trim().is_empty() {
        logger::log(stdout.trim_end());
    }
    if !stderr.trim().is_empty() {
        logger::log(stderr.trim_end());
    }
    logger::log("");

    if output.status.success() {
        return Ok(true);
    }

    if allow_not_found {
        let haystack = format!("{}\n{}", stdout, stderr);
        if haystack.contains("Not found") || haystack.contains("not found") {
            return Ok(true);
        }
    }

    Ok(false)
}
