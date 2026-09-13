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
    process::{hermes::HermesCli, system::SystemChecks},
};

pub(crate) fn with_devkit_heartbeat<T>(
    root: &Path,
    operation: impl FnOnce() -> Result<T, String>,
) -> Result<T, String> {
    if !crate::local_runtime::is_devkit(root) {
        return operation();
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
        operation()
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
                .stdin(Stdio::null())
                .stdout(stdout)
                .stderr(stderr)
                .spawn()
                .map_err(|e| format!("Failed to start DevKit heartbeat: {e}"))?,
        );
        Ok(owned)
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
    use std::{cell::Cell, os::unix::fs::PermissionsExt};

    const TEMPLATE: &str = include_str!("../../config/hermes-config.example.toml");

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
        let mut process = HeartbeatProcess::spawn(&binary, &config).unwrap();
        let directory = process.directory.clone();
        process.wait_ready().unwrap();
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
