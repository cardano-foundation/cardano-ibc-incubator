use std::path::Path;
use std::thread;
use std::time::Duration;

use crate::{
    config,
    logger::{error, log},
    process::{docker::DockerCli, system::SystemChecks},
    start,
    utils::execute_script,
};

fn compose_project_container_names(
    project_path: &Path,
    project: &str,
    service: Option<&str>,
    include_stopped: bool,
) -> Vec<String> {
    let args = compose_project_container_args(project_path, project, service, include_stopped);
    let arg_refs = args.iter().map(String::as_str).collect::<Vec<_>>();

    DockerCli::new(Path::new("."))
        .raw_output(arg_refs.as_slice())
        .ok()
        .map(|result| {
            String::from_utf8_lossy(&result.stdout)
                .lines()
                .map(str::trim)
                .filter(|name| !name.is_empty())
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default()
}

fn compose_project_container_args(
    project_path: &Path,
    project: &str,
    service: Option<&str>,
    include_stopped: bool,
) -> Vec<String> {
    let working_dir = project_path
        .canonicalize()
        .unwrap_or_else(|_| project_path.to_path_buf());
    let mut args = vec!["ps".to_string()];
    if include_stopped {
        args.push("--all".to_string());
    }
    args.extend([
        "--filter".to_string(),
        format!("label=com.docker.compose.project={project}"),
    ]);
    args.extend([
        "--filter".to_string(),
        format!(
            "label=com.docker.compose.project.working_dir={}",
            working_dir.display()
        ),
    ]);
    if let Some(service) = service {
        args.extend([
            "--filter".to_string(),
            format!("label=com.docker.compose.service={service}"),
        ]);
    }
    args.extend(["--format".to_string(), "{{.Names}}".to_string()]);
    args
}

fn remove_named_containers(names: &[String], label: &str) {
    if names.is_empty() {
        log(&format!("{} was not running", label));
        return;
    }
    let mut stop_args = vec!["stop", "--time", "10"];
    stop_args.extend(names.iter().map(String::as_str));
    if let Err(stop_error) = execute_script(Path::new("."), "docker", stop_args, None) {
        error(&format!(
            "ERROR: Failed to stop {} gracefully: {}",
            label, stop_error
        ));
    }

    let mut remove_args = vec!["rm", "-f"];
    remove_args.extend(names.iter().map(String::as_str));
    match execute_script(Path::new("."), "docker", remove_args, None) {
        Ok(_) => log(&format!("{} stopped successfully", label)),
        Err(stop_error) => error(&format!("ERROR: Failed to stop {}: {}", label, stop_error)),
    }
}

pub(crate) fn gateway_is_running(project_root_path: &Path) -> bool {
    !compose_project_container_names(
        project_root_path.join("cardano/gateway").as_path(),
        "gateway",
        None,
        false,
    )
    .is_empty()
}

pub(crate) fn dapp_is_running(project_root_path: &Path) -> bool {
    !compose_project_container_names(
        project_root_path.join("dapps").as_path(),
        "dapps",
        Some("ibc-swap-client"),
        false,
    )
    .is_empty()
}

pub(crate) fn cardano_runtime_is_running(project_root_path: &Path) -> bool {
    !compose_project_container_names(
        project_root_path.join("chains/cardano").as_path(),
        "cardano",
        None,
        false,
    )
    .is_empty()
}

pub(crate) fn relayer_is_running(project_root_path: &Path) -> bool {
    let relayer_path = project_root_path.join("relayer");
    let expected_binary = relayer_path.join("target/release/hermes");
    let expected_binary_str = expected_binary.to_str();
    if let Some(pid) = start::read_hermes_pid_file() {
        if start::is_process_alive(pid)
            && start::is_expected_hermes_daemon_pid(pid, expected_binary_str)
        {
            return true;
        }
    }
    !find_running_hermes_daemon_pids(relayer_path.as_path()).is_empty()
}

// Do not replace these targeted removals with `docker compose down` or `rm`.
// Compose scopes those commands by its generic project name, so another checkout
// using the same project name can be selected even when its working directory differs.
pub fn stop_gateway(project_root_path: &Path) {
    let gateway_path = project_root_path.join("cardano/gateway");
    let containers = compose_project_container_names(gateway_path.as_path(), "gateway", None, true);
    remove_named_containers(containers.as_slice(), "Gateway");
}

pub fn stop_dapp(project_root_path: &Path) {
    const IBC_SWAP_DAPP_SERVICE: &str = "ibc-swap-client";
    let dapps_path = project_root_path.join("dapps");
    let containers = compose_project_container_names(
        dapps_path.as_path(),
        "dapps",
        Some(IBC_SWAP_DAPP_SERVICE),
        true,
    );
    remove_named_containers(containers.as_slice(), "IBC Swap dapp");
}

pub fn stop_cardano_network(project_root_path: &Path) {
    let cardano_path = project_root_path.join("chains/cardano");
    let containers = compose_project_container_names(cardano_path.as_path(), "cardano", None, true);
    remove_named_containers(containers.as_slice(), "Cardano network");
}

pub fn stop_relayer(relayer_path: &Path) {
    let expected_binary = relayer_path.join("target/release/hermes");
    let expected_binary_str = expected_binary.to_str();

    let mut running_pids = Vec::new();

    if let Some(pid) = start::read_hermes_pid_file() {
        if start::is_process_alive(pid)
            && start::is_expected_hermes_daemon_pid(pid, expected_binary_str)
        {
            running_pids.push(pid);
        } else {
            start::remove_hermes_pid_file();
        }
    }

    if running_pids.is_empty() {
        // Legacy cleanup path for Hermes processes started before pid-file tracking existed.
        running_pids = find_running_hermes_daemon_pids(relayer_path);
    }

    if running_pids.is_empty() {
        log("Hermes relayer was not running");
        return;
    }

    for pid in &running_pids {
        if let Err(kill_error) = SystemChecks::send_signal(*pid, "-TERM") {
            error(&format!(
                "ERROR: Failed to send SIGTERM to Hermes relayer pid {}: {}",
                pid, kill_error
            ));
        }
    }

    thread::sleep(Duration::from_millis(500));

    let remaining_pids: Vec<u32> = running_pids
        .into_iter()
        .filter(|pid| start::is_process_alive(*pid))
        .collect();

    for pid in &remaining_pids {
        if let Err(kill_error) = SystemChecks::send_signal(*pid, "-KILL") {
            error(&format!(
                "ERROR: Failed to send SIGKILL to Hermes relayer pid {}: {}",
                pid, kill_error
            ));
        }
    }

    if remaining_pids.is_empty() {
        start::remove_hermes_pid_file();
        log("Hermes relayer stopped successfully");
    } else {
        log(&format!(
            "Hermes relayer stop requested; forced kill attempted for remaining pids: {}",
            remaining_pids
                .iter()
                .map(|pid| pid.to_string())
                .collect::<Vec<_>>()
                .join(", ")
        ));
    }
}

fn find_running_hermes_daemon_pids(relayer_path: &Path) -> Vec<u32> {
    let expected_binary = relayer_path.join("target/release/hermes");
    let expected_binary_str = expected_binary.to_str();

    match SystemChecks::find_processes_by_command() {
        Ok(output) => output
            .lines()
            .filter_map(parse_pid_and_command)
            .filter_map(|(pid, command)| {
                if start::is_hermes_daemon_command(command.as_str(), expected_binary_str) {
                    Some(pid)
                } else {
                    None
                }
            })
            .collect(),
        Err(_) => Vec::new(),
    }
}

fn parse_pid_and_command(line: &str) -> Option<(u32, String)> {
    let trimmed = line.trim_start();
    if trimmed.is_empty() {
        return None;
    }

    let mut parts = trimmed.splitn(2, char::is_whitespace);
    let pid_str = parts.next()?;
    let command = parts.next().unwrap_or("").trim_start().to_string();
    let pid = pid_str.parse::<u32>().ok()?;

    Some((pid, command))
}

#[cfg(test)]
mod tests {
    use super::compose_project_container_args;
    use std::path::Path;

    #[test]
    fn compose_cleanup_is_scoped_to_the_checkout_working_directory() {
        let first_checkout = compose_project_container_args(
            Path::new("/workspace/checkout-a/dapps"),
            "dapps",
            Some("ibc-swap-client"),
            true,
        );
        let second_checkout = compose_project_container_args(
            Path::new("/workspace/checkout-b/dapps"),
            "dapps",
            Some("ibc-swap-client"),
            true,
        );

        assert!(first_checkout.contains(
            &"label=com.docker.compose.project.working_dir=/workspace/checkout-a/dapps".to_string()
        ));
        assert!(second_checkout.contains(
            &"label=com.docker.compose.project.working_dir=/workspace/checkout-b/dapps".to_string()
        ));
        assert!(first_checkout.contains(&"label=com.docker.compose.project=dapps".to_string()));
        assert!(first_checkout
            .contains(&"label=com.docker.compose.service=ibc-swap-client".to_string()));
        assert!(first_checkout.contains(&"--all".to_string()));
        assert_ne!(first_checkout, second_checkout);
    }
}

pub fn stop_mithril(mithril_path: &Path) {
    let mithril_script_path = mithril_path.join("scripts");

    if !mithril_script_path.exists() {
        log("Mithril was not configured");
        return;
    }

    let mithril_data_dir = mithril_path.join("data");
    let mithril_data_dir = mithril_data_dir.to_string_lossy().to_string();
    let mithril_config = config::get_config().mithril;
    let mithril_result = execute_script(
        &mithril_script_path,
        "docker",
        Vec::from([
            "compose",
            "-f",
            "docker-compose.yaml",
            "--profile",
            "mithril",
            "down",
        ]),
        Some(vec![
            (
                "MITHRIL_AGGREGATOR_IMAGE",
                mithril_config.aggregator_image.as_str(),
            ),
            ("MITHRIL_CLIENT_IMAGE", mithril_config.client_image.as_str()),
            ("MITHRIL_SIGNER_IMAGE", mithril_config.signer_image.as_str()),
            (
                "CARDANO_NODE_VERSION",
                mithril_config.cardano_node_version.as_str(),
            ),
            (
                "CHAIN_OBSERVER_TYPE",
                mithril_config.chain_observer_type.as_str(),
            ),
            ("CARDANO_NODE_DIR", mithril_config.cardano_node_dir.as_str()),
            ("MITHRIL_DATA_DIR", mithril_data_dir.as_str()),
            (
                "GENESIS_VERIFICATION_KEY",
                mithril_config.genesis_verification_key.as_str(),
            ),
            (
                "GENESIS_SECRET_KEY",
                mithril_config.genesis_secret_key.as_str(),
            ),
            ("MITHRIL_SIGNER_IMAGE", mithril_config.signer_image.as_str()),
        ]),
    );
    match mithril_result {
        Ok(_) => {
            log("Mithril stopped successfully (mithril-aggregator, mithril-signer-1, mithril-signer-2)");
        }
        Err(e) => {
            error(&format!("ERROR: Failed to stop Mithril: {}", e));
        }
    }
}
