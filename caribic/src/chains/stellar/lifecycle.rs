use std::process::Command;

use super::config;
use crate::logger::verbose;
use crate::utils::wait_for_health_check;

/// Start the local Stellar quickstart container.
///
/// Runs `stellar/quickstart:testing` with Soroban RPC, Horizon, and the Lab UI enabled.
/// The container binds port 8000 and serves:
///   - Horizon API:      http://127.0.0.1:8000
///   - Soroban RPC:      http://127.0.0.1:8000/soroban/rpc
///   - Friendbot:        http://127.0.0.1:8000/friendbot
pub(super) async fn start_local() -> Result<(), Box<dyn std::error::Error>> {
    // Idempotent: if the container is already running, a second `docker run` will fail
    // with a "name already in use" error. Stop any leftover container first so each
    // `caribic start stellar` invocation starts fresh.
    stop_local();

    verbose(&format!(
        "Pulling and starting Stellar quickstart container ({}) ...",
        config::DOCKER_IMAGE
    ));

    let status = Command::new("docker")
        .args([
            "run",
            "--rm",
            "-d",
            "-p",
            &format!("{}:{}", config::LOCAL_PORT, config::LOCAL_PORT),
            "--name",
            config::CONTAINER_NAME,
            config::DOCKER_IMAGE,
            "--local",
            "--enable",
            "rpc,horizon",
        ])
        .status()?;

    if !status.success() {
        return Err(format!(
            "docker run failed for Stellar quickstart container (exit code: {:?})",
            status.code()
        )
        .into());
    }

    // Wait for Horizon to become ready. The Horizon root endpoint returns a JSON object
    // with `"horizon_version"` once the node is initialized. Quickstart typically needs
    // ~10–20 s to boot on first run; allow up to 60 s.
    let is_healthy = wait_for_health_check(
        config::LOCAL_HORIZON_URL,
        60,
        3000,
        Some(|response_body: &String| {
            // Horizon root returns JSON with `horizon_version` when ready.
            response_body.contains("horizon_version")
        }),
    )
    .await;

    if is_healthy.is_ok() {
        verbose("Stellar quickstart container is healthy (Horizon ready)");
        return Ok(());
    }

    // Health check timed out — clean up the container so the user isn't left with a
    // partially started container consuming the port.
    stop_local();
    Err(format!(
        "Timed out waiting for Stellar Horizon at {} — container stopped",
        config::LOCAL_HORIZON_URL
    )
    .into())
}

/// Stop and remove the local Stellar quickstart container.
///
/// Uses `docker stop` which sends SIGTERM and waits up to 10 s before SIGKILL.
/// Since the container is started with `--rm` it is automatically removed on stop.
pub(super) fn stop_local() {
    // Best-effort: if the container isn't running, `docker stop` exits non-zero — ignore it.
    let _ = Command::new("docker")
        .args(["stop", config::CONTAINER_NAME])
        .output();
}
