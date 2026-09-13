use std::{
    fs::{self, OpenOptions},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::atomic::{AtomicU64, Ordering},
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

static NEXT_DIRECTORY: AtomicU64 = AtomicU64::new(0);

use crate::{
    chains::hermes_support,
    process::{docker::DockerCli, hermes::HermesCli, system::SystemChecks},
};

pub(crate) fn with_devkit_heartbeat<T>(
    root: &Path,
    operation: impl FnOnce() -> Result<T, String>,
) -> Result<T, String> {
    if !crate::local_runtime::is_devkit(root) {
        return operation();
    }
    let gateway_url = gateway_readiness_url(root)?;
    let health = crate::config::get_config().health;
    if health.gateway_max_retries == 0 || health.gateway_retry_interval_ms == 0 {
        return Err("Gateway readiness retry count and interval must be positive".into());
    }
    let binary = super::hermes::require_relayer_hermes_binary().map_err(|e| e.to_string())?;
    let config = hermes_support::hermes_config_path().ok_or("Hermes configuration is missing")?;
    let was_running = crate::stop::relayer_is_running(root);
    if was_running {
        crate::stop::stop_relayer(&root.join("relayer"));
        if crate::stop::relayer_is_running(root) {
            return Err("Hermes is still running, cannot safely start the manual operation".into());
        }
    }

    let mut heartbeat = None;
    let result = (|| {
        heartbeat = Some(HeartbeatProcess::spawn(&binary, &config)?);
        heartbeat.as_mut().unwrap().wait_ready()?;
        heartbeat.as_mut().unwrap().run_when_proof_ready(
            health.gateway_max_retries,
            Duration::from_millis(
                health
                    .gateway_retry_interval_ms
                    .max(super::GATEWAY_HTTP_READINESS_RETRY_INTERVAL_MILLIS),
            ),
            || super::check_gateway_http_readiness_at(&gateway_url),
            operation,
        )
    })();
    let cleanup = heartbeat.as_mut().map_or(Ok(()), HeartbeatProcess::stop);
    drop(heartbeat);
    finish_operation(result, cleanup, || {
        if was_running {
            super::start_hermes_daemon().map_err(|e| format!("Could not restore Hermes: {e}"))?;
        }
        Ok(())
    })
}

fn gateway_readiness_url(root: &Path) -> Result<String, String> {
    if !crate::stop::gateway_is_running(root) {
        return Err("Gateway is not running in this checkout".into());
    }
    let output =
        DockerCli::new(&root.join("cardano/gateway")).compose_output(&["port", "app", "8000"])?;
    published_gateway_url(String::from_utf8_lossy(&output.stdout).trim())
}

fn published_gateway_url(address: &str) -> Result<String, String> {
    let (host, port) = address
        .rsplit_once(':')
        .ok_or("Gateway has no published HTTP port")?;
    let port = port
        .parse::<u16>()
        .ok()
        .filter(|port| *port > 0)
        .ok_or("Gateway has an invalid published HTTP port")?;
    let host = host.trim_matches(['[', ']']);
    let host = host
        .parse::<std::net::IpAddr>()
        .map_err(|_| "Gateway has an invalid published HTTP address")?;
    let host = if host.is_unspecified() {
        if host.is_ipv4() {
            "127.0.0.1".into()
        } else {
            "[::1]".into()
        }
    } else if host.is_ipv6() {
        format!("[{host}]")
    } else {
        host.to_string()
    };
    Ok(format!("http://{host}:{port}/health/ready"))
}

fn completed_heartbeat_check(log: &str) -> bool {
    log.lines().any(|line| {
        let Ok(event) = serde_json::from_str::<serde_json::Value>(line) else {
            return false;
        };
        let span = &event["span"];
        if span["name"] != "worker.cardano.host_state_heartbeat"
            || span["chain"] != "cardano-devnet"
        {
            return false;
        }
        let fields = &event["fields"];
        let Some(epoch) = fields["current_epoch"].as_u64() else {
            return false;
        };
        match fields["message"].as_str() {
            Some("submitted Cardano HostState epoch heartbeat") => true,
            Some("Cardano HostState heartbeat is not required") => {
                fields["host_state_epoch"].as_u64() == Some(epoch)
            }
            _ => false,
        }
    })
}

fn heartbeat_log_filter(source: &str, inherited: Option<&str>) -> String {
    let mut section = "";
    let level = source
        .lines()
        .find_map(|line| {
            let line = line.trim();
            if line.starts_with('[') {
                section = line;
            }
            let (key, value) = line.split_once('=')?;
            (section == "[global]" && key.trim() == "log_level").then(|| {
                value
                    .split('#')
                    .next()
                    .unwrap_or(value)
                    .trim()
                    .trim_matches(['\'', '"'])
            })
        })
        .unwrap_or("info");
    let default = format!("ibc_relayer={level},ibc_relayer_cli={level}");
    format!(
        "{},ibc_relayer::supervisor::spawn=info,ibc_relayer::worker::heartbeat=debug",
        inherited.unwrap_or(&default)
    )
}

fn finish_operation<T>(
    result: Result<T, String>,
    cleanup: Result<(), String>,
    restore: impl FnOnce() -> Result<(), String>,
) -> Result<T, String> {
    // Do not start another daemon when the owned heartbeat could still be running.
    let cleanup = cleanup.and_then(|()| restore());
    match (result, cleanup) {
        (Ok(value), Ok(())) => Ok(value),
        (Err(error), Ok(())) | (Ok(_), Err(error)) => Err(error),
        (Err(error), Err(cleanup)) => {
            Err(format!("{error}. Hermes cleanup also failed: {cleanup}"))
        }
    }
}

fn heartbeat_config(source: &str) -> Result<String, String> {
    let cardano = hermes_support::extract_chain_block(source, "cardano-devnet")
        .ok_or("Heartbeat configuration has no cardano-devnet chain")?;
    if !cardano.lines().any(|line| {
        line.trim().split_once('=').is_some_and(|(key, value)| {
            key.trim() == "host_state_heartbeat_interval" && !value.trim().is_empty()
        })
    }) {
        return Err(
            "Cardano host_state_heartbeat_interval must be configured for DevKit routes".into(),
        );
    }
    let flags = [
        ("mode.clients", "enabled"),
        ("mode.clients", "refresh"),
        ("mode.clients", "misbehaviour"),
        ("mode.connections", "enabled"),
        ("mode.channels", "enabled"),
        ("mode.packets", "enabled"),
        ("mode.packets", "clear_on_start"),
    ];
    let mut seen = [0; 7];
    let mut section = "";
    let mut result = String::new();
    for line in source.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with('[') {
            section = trimmed.trim_matches(['[', ']']);
        }
        if let Some((key, _)) = trimmed.split_once('=') {
            if let Some(index) = flags.iter().position(|flag| *flag == (section, key.trim())) {
                seen[index] += 1;
                result.push_str(&format!("{} = false\n", key.trim()));
                continue;
            }
        }
        result.push_str(line);
        result.push('\n');
    }
    if seen.iter().any(|count| *count != 1) {
        return Err(
            "Expected the Caribic Hermes mode sections before starting a DevKit heartbeat".into(),
        );
    }
    Ok(result)
}

struct HeartbeatProcess {
    child: Option<Child>,
    directory: PathBuf,
}

impl HeartbeatProcess {
    fn spawn(binary: &Path, source: &Path) -> Result<Self, String> {
        let directory = std::env::temp_dir().join(format!(
            "caribic-heartbeat-{}-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map_err(|e| e.to_string())?
                .as_nanos(),
            NEXT_DIRECTORY.fetch_add(1, Ordering::Relaxed)
        ));
        let mut owned = Self {
            child: None,
            directory,
        };
        let config = owned.directory.join("config.toml");
        let log = owned.directory.join("hermes.log");
        let original = fs::read_to_string(source).map_err(|e| e.to_string())?;
        super::write_owner_only_file(&config, original.as_bytes()).map_err(|e| e.to_string())?;
        let config_path = config
            .to_str()
            .ok_or("Invalid temporary Hermes config path")?;
        HermesCli::new(binary).output(None, &["--config", config_path, "config", "validate"])?;
        let modified = heartbeat_config(&original)?;
        super::write_owner_only_file(&config, modified.as_bytes()).map_err(|e| e.to_string())?;
        super::write_owner_only_file(&log, b"").map_err(|e| e.to_string())?;
        let stdout = OpenOptions::new()
            .append(true)
            .open(&log)
            .map_err(|e| e.to_string())?;
        let stderr = stdout.try_clone().map_err(|e| e.to_string())?;
        // The validated config changes only the modes above. Hermes start accepts
        // their all-disabled warning, while `config validate` reports it as failure.
        // --full-scan is required to create its Cardano Wallet/heartbeat worker.
        owned.child = Some(
            Command::new(binary)
                .args(["--config", config_path, "--json", "start", "--full-scan"])
                // Preserve configured logging and make the first successful no-op
                // heartbeat check visible without enabling unrelated DEBUG output.
                .env(
                    "RUST_LOG",
                    heartbeat_log_filter(&original, std::env::var("RUST_LOG").ok().as_deref()),
                )
                .stdin(Stdio::null())
                .stdout(stdout)
                .stderr(stderr)
                .spawn()
                .map_err(|e| format!("Failed to start DevKit heartbeat: {e}"))?,
        );
        Ok(owned)
    }

    fn run_when_proof_ready<T>(
        &mut self,
        attempts: u32,
        interval: Duration,
        mut probe: impl FnMut() -> (bool, String),
        operation: impl FnOnce() -> Result<T, String>,
    ) -> Result<T, String> {
        let mut last_status =
            "Waiting for the first completed HostState heartbeat check".to_string();
        for attempt in 0..attempts {
            let child = self.child.as_mut().ok_or("Heartbeat process is missing")?;
            if child
                .try_wait()
                .map_err(|error| error.to_string())?
                .is_some()
            {
                return Err(format!(
                    "DevKit heartbeat exited before proof readiness:\n{}",
                    self.log_tail()
                ));
            }
            let log = fs::read_to_string(self.directory.join("hermes.log")).unwrap_or_default();
            // A ready old root can precede the worker's initial submission. Its
            // completed check must come first, then the Gateway accepts the root.
            if completed_heartbeat_check(&log) {
                let (ready, status) = probe();
                last_status = status;
                if ready
                    && child
                        .try_wait()
                        .map_err(|error| error.to_string())?
                        .is_none()
                {
                    return operation();
                }
            }
            if attempt + 1 < attempts {
                thread::sleep(interval);
            }
        }
        Err(format!(
            "DevKit Gateway did not become proof-ready: {last_status}\n{}",
            self.log_tail()
        ))
    }

    fn log_tail(&self) -> String {
        fs::read_to_string(self.directory.join("hermes.log"))
            .unwrap_or_default()
            .lines()
            .rev()
            .take(8)
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect::<Vec<_>>()
            .join("\n")
    }

    fn wait_ready(&mut self) -> Result<(), String> {
        let deadline = Instant::now() + Duration::from_secs(60);
        loop {
            let child = self.child.as_mut().ok_or("Heartbeat process is missing")?;
            let exited = child.try_wait().map_err(|e| e.to_string())?.is_some();
            let log = fs::read_to_string(self.directory.join("hermes.log")).unwrap_or_default();
            if !exited
                && log
                    .lines()
                    .any(|line| line.contains("spawning Wallet worker: wallet::cardano-devnet"))
            {
                return Ok(());
            }
            if exited || Instant::now() >= deadline {
                let tail = log
                    .lines()
                    .rev()
                    .take(8)
                    .collect::<Vec<_>>()
                    .into_iter()
                    .rev()
                    .collect::<Vec<_>>()
                    .join("\n");
                return Err(format!(
                    "DevKit heartbeat did not start its Cardano worker:\n{tail}"
                ));
            }
            thread::sleep(Duration::from_millis(200));
        }
    }

    fn stop(&mut self) -> Result<(), String> {
        let Some(child) = self.child.as_mut() else {
            return Ok(());
        };
        if child.try_wait().map_err(|e| e.to_string())?.is_some() {
            return Ok(());
        }
        let _ = SystemChecks::send_signal(child.id(), "-TERM");
        let deadline = Instant::now() + Duration::from_secs(20);
        while Instant::now() < deadline {
            if child.try_wait().map_err(|e| e.to_string())?.is_some() {
                return Ok(());
            }
            thread::sleep(Duration::from_millis(100));
        }
        child
            .kill()
            .map_err(|e| format!("Could not stop owned heartbeat process {}: {e}", child.id()))?;
        child.wait().map_err(|e| e.to_string())?;
        Ok(())
    }
}

impl Drop for HeartbeatProcess {
    fn drop(&mut self) {
        if self.stop().is_ok() {
            let _ = fs::remove_dir_all(&self.directory);
        }
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::{cell::Cell, io::Write, os::unix::fs::PermissionsExt};

    const TEMPLATE: &str = include_str!("../../config/hermes-config.example.toml");
    const CHECK_COMPLETE: &str = r#"{"fields":{"message":"Cardano HostState heartbeat is not required","current_epoch":4,"host_state_epoch":4},"span":{"chain":"cardano-devnet","name":"worker.cardano.host_state_heartbeat"}}"#;

    fn append_completed_check(path: &Path) {
        writeln!(
            OpenOptions::new().append(true).open(path).unwrap(),
            "{CHECK_COMPLETE}"
        )
        .unwrap();
    }

    struct Fixture(PathBuf);

    impl Fixture {
        fn new(fail_start: bool) -> Self {
            let directory = std::env::temp_dir().join(format!(
                "caribic-heartbeat-test-{}-{}-{}",
                std::process::id(),
                SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap()
                    .as_nanos(),
                NEXT_DIRECTORY.fetch_add(1, Ordering::Relaxed)
            ));
            super::super::write_owner_only_file(
                &directory.join("source.toml"),
                TEMPLATE.as_bytes(),
            )
            .unwrap();
            let script = format!(
                r#"#!/usr/bin/env python3
import pathlib, sys, time
assert sys.argv[1] == '--config'
config = pathlib.Path(sys.argv[2]).read_text()
if sys.argv[3:] == ['config', 'validate']:
    assert 'refresh = true' in config
    sys.exit(0)
assert sys.argv[3:] == ['--json', 'start', '--full-scan']
assert 'refresh = false' in config
if {fail_start}:
    print('fixture startup failure', flush=True)
    sys.exit(4)
print('spawning Wallet worker: wallet::cardano-devnet', flush=True)
while True:
    time.sleep(1)
"#,
                fail_start = if fail_start { "True" } else { "False" }
            );
            let binary = directory.join("hermes");
            super::super::write_owner_only_file(&binary, script.as_bytes()).unwrap();
            fs::set_permissions(&binary, fs::Permissions::from_mode(0o700)).unwrap();
            Self(directory)
        }

        fn spawn(&self) -> HeartbeatProcess {
            HeartbeatProcess::spawn(&self.0.join("hermes"), &self.0.join("source.toml")).unwrap()
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            fs::remove_dir_all(&self.0).unwrap();
        }
    }

    #[test]
    fn heartbeat_modes_preserve_chain_trust_and_reject_missing_heartbeat() {
        let modified = heartbeat_config(TEMPLATE).unwrap();
        let original_chains = TEMPLATE.split_once("[[chains]]").unwrap().1;
        assert_eq!(
            modified.split_once("[[chains]]").unwrap().1,
            original_chains
        );
        for section in ["clients", "connections", "channels", "packets"] {
            assert!(modified.contains(&format!("[mode.{section}]\nenabled = false")));
        }
        assert!(modified.contains("refresh = false\nmisbehaviour = false"));
        assert!(modified.contains("clear_on_start = false"));
        assert!(
            heartbeat_config(&TEMPLATE.replace("host_state_heartbeat_interval = '60s'", ""))
                .is_err()
        );
        assert!(heartbeat_config(&TEMPLATE.replace("clear_on_start = true", "")).is_err());
    }

    #[test]
    fn proof_gate_waits_for_completed_check_then_gateway_acceptance() {
        let fixture = Fixture::new(false);
        let mut process = fixture.spawn();
        process.wait_ready().unwrap();
        let pid = process.child.as_ref().unwrap().id();
        let log = process.directory.join("hermes.log");
        let completed = log.clone();
        let writer = thread::spawn(move || {
            thread::sleep(Duration::from_millis(50));
            append_completed_check(&completed);
        });
        let probes = Cell::new(0);
        let entered = Cell::new(false);
        process
            .run_when_proof_ready(
                100,
                Duration::from_millis(10),
                || {
                    assert!(completed_heartbeat_check(
                        &fs::read_to_string(&log).unwrap()
                    ));
                    probes.set(probes.get() + 1);
                    (probes.get() >= 3, "waiting_for_stability".into())
                },
                || {
                    assert_eq!(probes.get(), 3);
                    assert!(SystemChecks::process_command(pid).is_some());
                    entered.set(true);
                    Ok(())
                },
            )
            .unwrap();
        writer.join().unwrap();
        assert!(entered.get());
        assert_eq!(process.child.as_ref().unwrap().id(), pid);
    }

    #[test]
    fn failed_proof_gate_never_enters_operation_and_reaps_only_owned_child() {
        let fixture = Fixture::new(false);
        let mut other = fixture.spawn();
        other.wait_ready().unwrap();
        for completed in [false, true] {
            let mut process = fixture.spawn();
            process.wait_ready().unwrap();
            if completed {
                append_completed_check(&process.directory.join("hermes.log"));
            }
            let pid = process.child.as_ref().unwrap().id();
            let directory = process.directory.clone();
            let result = process.run_when_proof_ready(
                2,
                Duration::ZERO,
                || {
                    // Before a completed check an old accepted root must not be consulted.
                    assert!(completed);
                    (false, "HEIGHT_NOT_ACCEPTED: depth 5 < 24".into())
                },
                || -> Result<(), String> { panic!("operation entered before readiness") },
            );
            let error = result.unwrap_err();
            assert!(error.contains(if completed {
                "HEIGHT_NOT_ACCEPTED"
            } else {
                "first completed"
            }));
            drop(process);
            assert!(!directory.exists());
            assert!(SystemChecks::process_command(pid).is_none());
            assert!(other.child.as_mut().unwrap().try_wait().unwrap().is_none());
        }
    }

    #[test]
    fn heartbeat_readiness_uses_owned_port_and_completed_cardano_checks() {
        assert_eq!(
            published_gateway_url("0.0.0.0:18000").unwrap(),
            "http://127.0.0.1:18000/health/ready"
        );
        assert_eq!(
            published_gateway_url("[::]:8000").unwrap(),
            "http://[::1]:8000/health/ready"
        );
        assert!(published_gateway_url("8000").is_err());
        assert!(completed_heartbeat_check(CHECK_COMPLETE));
        for event in [
            CHECK_COMPLETE.replace("cardano-devnet", "another-chain"),
            CHECK_COMPLETE.replace("\"host_state_epoch\":4", "\"host_state_epoch\":3"),
            "spawning Wallet worker: wallet::cardano-devnet".into(),
        ] {
            assert!(!completed_heartbeat_check(&event));
        }
        assert!(completed_heartbeat_check(&CHECK_COMPLETE.replace(
            "Cardano HostState heartbeat is not required",
            "submitted Cardano HostState epoch heartbeat"
        )));
        let inherited = heartbeat_log_filter(TEMPLATE, Some("ibc_relayer=trace,other=warn"));
        assert!(inherited.starts_with("ibc_relayer=trace,other=warn,"));
        assert!(inherited.ends_with("ibc_relayer::worker::heartbeat=debug"));
        assert!(inherited.contains("ibc_relayer::supervisor::spawn=info"));
        assert!(heartbeat_log_filter(
            &TEMPLATE.replace("log_level = 'info'", "log_level = 'warn'"),
            None
        )
        .starts_with("ibc_relayer=warn,ibc_relayer_cli=warn,"));
    }

    #[test]
    fn owned_process_cleanup_preserves_other_process_and_source_config() {
        let fixture = Fixture::new(false);
        let mut first = fixture.spawn();
        let mut other = fixture.spawn();
        first.wait_ready().unwrap();
        other.wait_ready().unwrap();
        let directory = first.directory.clone();
        assert_eq!(
            fs::metadata(directory.join("config.toml"))
                .unwrap()
                .permissions()
                .mode()
                & 0o777,
            0o600
        );
        first.stop().unwrap();
        assert!(first.child.as_mut().unwrap().try_wait().unwrap().is_some());
        drop(first);
        assert!(!directory.exists());
        assert!(other.child.as_mut().unwrap().try_wait().unwrap().is_none());
        assert_eq!(
            fs::read_to_string(fixture.0.join("source.toml")).unwrap(),
            TEMPLATE
        );
    }

    #[test]
    fn failed_operation_drops_and_reaps_owned_process() {
        let fixture = Fixture::new(false);
        let mut process = fixture.spawn();
        process.wait_ready().unwrap();
        let directory = process.directory.clone();
        let pid = process.child.as_ref().unwrap().id();
        let result: Result<(), String> = {
            let _owned = process;
            Err("operation failed".into())
        };
        assert!(result.is_err());
        assert!(!directory.exists());
        assert!(SystemChecks::process_command(pid).is_none());
    }

    #[test]
    fn early_process_exit_is_reported_and_cleaned_up() {
        let fixture = Fixture::new(true);
        let mut process = fixture.spawn();
        let directory = process.directory.clone();
        assert!(process
            .wait_ready()
            .unwrap_err()
            .contains("fixture startup failure"));
        drop(process);
        assert!(!directory.exists());
    }

    #[test]
    fn failed_cleanup_never_restores_a_competing_daemon() {
        let restored = Cell::new(false);
        let result = finish_operation::<()>(
            Err("route failed".into()),
            Err("heartbeat is still running".into()),
            || {
                restored.set(true);
                Ok(())
            },
        );
        assert!(!restored.get());
        let error = result.unwrap_err();
        assert!(error.contains("route failed"));
        assert!(error.contains("heartbeat is still running"));
        assert!(
            finish_operation::<()>(Err("route failed".into()), Ok(()), || {
                restored.set(true);
                Ok(())
            })
            .is_err()
        );
        assert!(restored.get());
    }

    #[test]
    #[ignore = "requires explicit isolated Hermes fixture paths and no competing heartbeat daemon"]
    fn live_owned_heartbeat_lifecycle() {
        let binary = PathBuf::from(
            std::env::var("CARIBIC_TEST_HERMES_BINARY").expect("explicit fixture binary required"),
        );
        let config = PathBuf::from(
            std::env::var("CARIBIC_TEST_HERMES_CONFIG").expect("explicit fixture config required"),
        );
        assert!(binary.is_absolute() && config.is_absolute());
        let original = fs::read(&config).unwrap();
        let gateway_url = std::env::var("CARIBIC_TEST_GATEWAY_READY_URL")
            .expect("explicit isolated Gateway readiness URL required");
        let mut process = HeartbeatProcess::spawn(&binary, &config).unwrap();
        let directory = process.directory.clone();
        process.wait_ready().unwrap();
        process
            .run_when_proof_ready(
                60,
                Duration::from_secs(5),
                || super::super::check_gateway_http_readiness_at(&gateway_url),
                || Ok(()),
            )
            .unwrap();
        process.stop().unwrap();
        assert!(process
            .child
            .as_mut()
            .unwrap()
            .try_wait()
            .unwrap()
            .is_some());
        println!(
            "{}",
            fs::read_to_string(directory.join("hermes.log")).unwrap()
        );
        drop(process);
        assert!(!directory.exists());
        assert_eq!(fs::read(&config).unwrap(), original);
    }
}
