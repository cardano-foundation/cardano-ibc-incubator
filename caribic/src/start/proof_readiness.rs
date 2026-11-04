use std::{path::Path, process::Command, thread, time::Duration};

use crate::process::docker::DockerCli;

pub(crate) fn with_local_proof_readiness<T>(
    root: &Path,
    operation: impl FnOnce() -> Result<T, String>,
) -> Result<T, String> {
    if !crate::local_network::is_local(root) {
        return operation();
    }
    let gateway_url = gateway_readiness_url(root)?;
    let health = crate::config::get_config().health;
    if health.gateway_max_retries == 0 || health.gateway_retry_interval_ms == 0 {
        return Err("Gateway readiness retry count and interval must be positive".into());
    }
    // Manual route commands must not race the daemon for account sequences.
    // Proof readiness comes from authenticated history and needs no heartbeat.
    let was_running = crate::stop::relayer_is_running(root);
    if was_running {
        crate::stop::stop_relayer(&root.join("relayer"));
        if crate::stop::relayer_is_running(root) {
            return Err("Hermes is still running, cannot safely start the manual operation".into());
        }
    }
    let result = run_when_proof_ready(
        health.gateway_max_retries,
        Duration::from_millis(
            health
                .gateway_retry_interval_ms
                .max(super::GATEWAY_HTTP_READINESS_RETRY_INTERVAL_MILLIS),
        ),
        || super::check_gateway_http_readiness_at(&gateway_url),
        operation,
    );
    finish_operation(result, || {
        if was_running {
            super::start_hermes_daemon().map_err(|e| format!("Could not restore Hermes: {e}"))?;
        }
        Ok(())
    })
}

fn run_when_proof_ready<T>(
    attempts: u32,
    interval: Duration,
    mut probe: impl FnMut() -> (bool, String),
    operation: impl FnOnce() -> Result<T, String>,
) -> Result<T, String> {
    let mut last_status = "Gateway readiness checks have not completed yet".to_string();
    for attempt in 0..attempts {
        let (ready, status) = probe();
        last_status = status;
        if ready {
            return operation();
        }
        if attempt + 1 < attempts {
            thread::sleep(interval);
        }
    }
    Err(format!(
        "DevKit Gateway did not become proof-ready: {last_status}"
    ))
}

fn finish_operation<T>(
    result: Result<T, String>,
    restore: impl FnOnce() -> Result<(), String>,
) -> Result<T, String> {
    match (result, restore()) {
        (Ok(value), Ok(())) => Ok(value),
        (Err(error), Ok(())) | (Ok(_), Err(error)) => Err(error),
        (Err(error), Err(restore)) => {
            Err(format!("{error}. Hermes restart also failed: {restore}"))
        }
    }
}

fn gateway_readiness_url(root: &Path) -> Result<String, String> {
    if !crate::stop::gateway_is_running(root) {
        return Err("Gateway is not running in this checkout".into());
    }
    let output = crate::process::runner::run_ok_output(&mut gateway_port_command(root)?)?;
    published_gateway_url(String::from_utf8_lossy(&output.stdout).trim())
}

fn gateway_port_command(root: &Path) -> Result<Command, String> {
    let directory = root.join("cardano/gateway");
    let file = directory
        .join("docker-compose.yml")
        .canonicalize()
        .map_err(|error| format!("Cannot locate the Gateway Compose file: {error}"))?;
    // Match the project inspected by gateway_is_running even when the caller
    // exports COMPOSE_PROJECT_NAME or COMPOSE_FILE for another stack.
    let mut command = DockerCli::new(&directory).compose_command(&[]);
    command
        .arg("--project-name")
        .arg(crate::stop::gateway_project(root))
        .arg("--file")
        .arg(file)
        .args(["port", "app", "8000"]);
    Ok(command)
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;

    #[test]
    fn proof_gate_waits_for_gateway_acceptance_without_a_heartbeat() {
        let probes = Cell::new(0);
        let result = run_when_proof_ready(
            3,
            Duration::ZERO,
            || {
                probes.set(probes.get() + 1);
                (probes.get() == 3, "waiting_for_stability".into())
            },
            || {
                assert_eq!(probes.get(), 3);
                Ok("route ready")
            },
        );
        assert_eq!(result.unwrap(), "route ready");
    }

    #[test]
    fn failed_proof_gate_never_enters_operation() {
        let result = run_when_proof_ready(
            2,
            Duration::ZERO,
            || (false, "HEIGHT_NOT_ACCEPTED: depth 5 < 24".into()),
            || -> Result<(), String> { panic!("operation entered before readiness") },
        );
        assert!(result.unwrap_err().contains("HEIGHT_NOT_ACCEPTED"));
    }

    #[test]
    fn daemon_is_restored_after_readiness_or_operation_failure() {
        for result in [
            Ok(()),
            Err("proof not ready".into()),
            Err("route failed".into()),
        ] {
            let restored = Cell::new(false);
            let expected = result.clone();
            assert_eq!(
                finish_operation(result, || {
                    restored.set(true);
                    Ok(())
                }),
                expected
            );
            assert!(restored.get());
        }
        let error =
            finish_operation::<()>(Err("route failed".into()), || Err("restart failed".into()))
                .unwrap_err();
        assert!(error.contains("route failed"));
        assert!(error.contains("restart failed"));
    }

    #[test]
    fn readiness_uses_the_owned_gateway_port() {
        assert_eq!(
            published_gateway_url("0.0.0.0:18000").unwrap(),
            "http://127.0.0.1:18000/health/ready"
        );
        assert_eq!(
            published_gateway_url("[::]:8000").unwrap(),
            "http://[::1]:8000/health/ready"
        );
        for address in ["8000", "localhost:8000", "0.0.0.0:0"] {
            assert!(published_gateway_url(address).is_err());
        }
    }

    #[test]
    fn gateway_lookup_pins_the_same_project_and_repository_compose_file() {
        let root = std::env::temp_dir().join(format!(
            "caribic-proof-readiness-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let directory = root.join("cardano/gateway");
        std::fs::create_dir_all(&directory).unwrap();
        std::fs::write(
            directory.join(".env"),
            "GATEWAY_COMPOSE_PROJECT=owned-devkit-gateway\n",
        )
        .unwrap();
        let file = directory.join("docker-compose.yml");
        std::fs::write(&file, "services: {}\n").unwrap();
        let command = gateway_port_command(&root).unwrap();
        let arguments: Vec<_> = command
            .get_args()
            .map(|value| value.to_string_lossy().into_owned())
            .collect();
        assert_eq!(
            arguments,
            [
                "compose",
                "--project-name",
                "owned-devkit-gateway",
                "--file",
                file.canonicalize().unwrap().to_str().unwrap(),
                "port",
                "app",
                "8000",
            ]
        );
        assert_eq!(command.get_current_dir(), Some(directory.as_path()));
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn default_profile_keeps_client_refresh_without_automatic_heartbeats() {
        let source = include_str!("../../config/hermes-config.example.toml");
        assert!(source.contains("[mode.clients]\nenabled = true\nrefresh = true"));
        assert!(!source.lines().any(|line| {
            line.trim_start()
                .starts_with("host_state_heartbeat_interval =")
        }));
    }
}
