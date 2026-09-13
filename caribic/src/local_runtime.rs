use std::{collections::BTreeMap, fs, path::Path, process::Command};

use crate::config::CoreCardanoNetwork;

const MARKER: &str = ".caribic/local-runtime";

#[derive(clap::ValueEnum, Clone, Copy, Debug, PartialEq, Eq)]
pub enum LocalRuntime {
    Legacy,
    Devkit,
}

pub fn selected(root: &Path) -> LocalRuntime {
    match fs::read_to_string(root.join(MARKER))
        .as_deref()
        .map(str::trim)
    {
        Ok("devkit") => LocalRuntime::Devkit,
        _ => LocalRuntime::Legacy,
    }
}

pub fn is_devkit(root: &Path) -> bool {
    crate::config::active_core_cardano_network(root) == CoreCardanoNetwork::Local
        && selected(root) == LocalRuntime::Devkit
}

pub fn select(root: &Path, requested: LocalRuntime) -> Result<(), String> {
    if selected(root) != requested
        && (crate::stop::cardano_runtime_is_running(root)?
            || crate::stop::gateway_is_running(root)
            || crate::stop::relayer_is_running(root)
            || crate::stop::dapp_is_running(root))
    {
        return Err("Stop the current stack before changing the local Cardano runtime".to_string());
    }
    fs::create_dir_all(root.join(".caribic")).map_err(|error| error.to_string())?;
    fs::write(
        root.join(MARKER),
        match requested {
            LocalRuntime::Legacy => "legacy\n",
            LocalRuntime::Devkit => "devkit\n",
        },
    )
    .map_err(|error| error.to_string())
}

pub fn command(root: &Path, action: &str) -> Command {
    let mut command = Command::new("python3");
    command
        .arg(root.join("chains/cardano/devkit/profile.py"))
        .arg(action);
    command
}

pub fn run(root: &Path, action: &str, arguments: &[&str]) -> Result<(), String> {
    let status = command(root, action)
        .args(arguments)
        .status()
        .map_err(|error| format!("Failed to run DevKit {action}: {error}"))?;
    if status.success() {
        Ok(())
    } else {
        Err(format!("DevKit {action} failed ({status})"))
    }
}

pub fn environment(root: &Path, containers: bool) -> Result<BTreeMap<String, String>, String> {
    let name = if containers {
        "container-endpoints.env"
    } else {
        "endpoints.env"
    };
    let path = root.join(".caribic/devkit").join(name);
    let contents = fs::read_to_string(&path).map_err(|error| {
        format!(
            "Cannot read {}: {error}. Start the DevKit network first",
            path.display()
        )
    })?;
    Ok(contents
        .lines()
        .filter_map(|line| {
            let line = line.trim();
            if line.is_empty() || line.starts_with('#') {
                return None;
            }
            line.split_once('=').map(|(key, value)| {
                (
                    key.trim().to_string(),
                    value.trim().trim_matches(['\'', '"']).to_string(),
                )
            })
        })
        .collect())
}

pub fn endpoint(root: &Path, key: &str, legacy: &str) -> Result<String, String> {
    if !is_devkit(root) {
        return Ok(legacy.to_string());
    }
    environment(root, false)?
        .remove(key)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| format!("DevKit endpoint {key} is missing"))
}

fn classify_running_status(code: Option<i32>) -> Result<bool, String> {
    match code {
        Some(0) => Ok(true),
        Some(1) => Ok(false),
        _ => Err("Cannot determine whether DevKit is running. Check Docker and run `caribic devkit status` before switching networks or local runtimes".to_string()),
    }
}

pub fn containers_running(root: &Path) -> Result<bool, String> {
    let output = command(root, "running").output().map_err(|error| {
        format!("Cannot inspect DevKit runtime state, refusing to switch runtimes: {error}")
    })?;
    classify_running_status(output.status.code()).map_err(|error| {
        let detail = String::from_utf8_lossy(&output.stderr);
        if detail.trim().is_empty() {
            error
        } else {
            format!("{error}: {}", detail.trim())
        }
    })
}

pub fn seed(root: &Path) -> Result<(), String> {
    for account in crate::config::get_config().cardano.bootstrap_addresses {
        if account.amount <= 0 {
            return Err(format!(
                "Bootstrap funding must be positive for {}",
                account.address
            ));
        }
        let amount = account.amount.to_string();
        let mut args = vec![account.address.as_str(), amount.as_str()];
        if account.address == "addr_test1vz8nzrmel9mmmu97lm06uvm55cj7vny6dxjqc0y0efs8mtqsd8r5m" {
            args.extend(["--outputs", "40"]);
        }
        run(root, "fund", &args)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn failed_runtime_probes_are_not_treated_as_a_stopped_network() {
        assert_eq!(classify_running_status(Some(0)).unwrap(), true);
        assert_eq!(classify_running_status(Some(1)).unwrap(), false);
        for failed_status in [Some(2), Some(127), None] {
            let error = classify_running_status(failed_status).unwrap_err();
            assert!(error.contains("Cannot determine whether DevKit is running"));
        }
    }

    #[test]
    fn devkit_endpoints_never_fall_back_to_another_local_chain() {
        let root =
            std::env::temp_dir().join(format!("caribic-runtime-endpoints-{}", std::process::id()));
        fs::create_dir_all(root.join(".caribic/devkit")).unwrap();
        fs::create_dir_all(root.join("chains/cardano")).unwrap();
        fs::write(root.join(MARKER), "devkit\n").unwrap();
        fs::write(root.join("chains/cardano/.caribic-network"), "local\n").unwrap();
        assert!(endpoint(&root, "OGMIOS_URL", "http://localhost:1337").is_err());
        fs::write(
            root.join(".caribic/devkit/endpoints.env"),
            "OGMIOS_URL=http://localhost:11337\n",
        )
        .unwrap();
        assert_eq!(
            endpoint(&root, "OGMIOS_URL", "http://localhost:1337").unwrap(),
            "http://localhost:11337"
        );
        fs::write(root.join("chains/cardano/.caribic-network"), "preprod\n").unwrap();
        assert!(!is_devkit(&root));
        fs::remove_dir_all(root).unwrap();
    }
}
