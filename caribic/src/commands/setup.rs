use std::path::Path;

use crate::{
    logger,
    route_setup::{self, RouteChain, RouteEndpoint},
    start::{self, CoreServiceId, HealthTarget},
    stop::stop_relayer,
    SetupCommand, TransferRouteChainArg,
};

/// Runs setup-only commands for reusable bridge state.
pub fn run_setup(project_root_path: &Path, command: SetupCommand) -> Result<(), String> {
    match command {
        SetupCommand::Route {
            from,
            from_network,
            to,
            to_network,
        } => run_setup_route(project_root_path, from, from_network, to, to_network),
    }
}

fn run_setup_route(
    project_root_path: &Path,
    from: TransferRouteChainArg,
    from_network: Option<String>,
    to: TransferRouteChainArg,
    to_network: Option<String>,
) -> Result<(), String> {
    if crate::local_runtime::is_devkit(project_root_path) {
        for (chain, network) in [(&from, &from_network), (&to, &to_network)] {
            if matches!(chain, TransferRouteChainArg::Cosmos) {
                crate::chains::cosmos_profiles::validate_route_state(
                    project_root_path,
                    network.as_deref().unwrap_or("v8-classic"),
                )?;
            }
        }
        if !matches!(from, TransferRouteChainArg::Cardano) {
            return Err(format!(
                "Only Cardano-sourced token-transfer routes are currently supported, got '{}'.",
                RouteChain::from(from).display_name()
            ));
        }
        if matches!(to, TransferRouteChainArg::Cardano) {
            return Err("Cardano-to-Cardano token-transfer route setup is not supported.".into());
        }
        if !matches!(to, TransferRouteChainArg::Cosmos) {
            return Err("DevKit token-transfer routes require Cosmos v8-classic, the only fixture with a matching Cardano clock. Select Cosmos v8-classic or use the legacy Cardano runtime.".into());
        }
        let route = start::with_devkit_heartbeat(project_root_path, || {
            route_setup::setup_transfer_route(
                project_root_path,
                RouteEndpoint::new(from.into(), from_network),
                RouteEndpoint::new(to.into(), to_network),
            )
        })?;
        logger::log("PASS: Token-transfer route is ready");
        for line in route.summary_lines() {
            logger::log(&format!("  - {}", line));
        }
        return Ok(());
    }
    let relayer_path = project_root_path.join("relayer");
    let relayer_was_running = matches!(
        start::check_health_target(project_root_path, HealthTarget::Core(CoreServiceId::Hermes)),
        Ok((true, _))
    );

    if relayer_was_running {
        logger::verbose(
            "Stopping Hermes daemon during route setup to avoid account sequence contention",
        );
        stop_relayer(relayer_path.as_path());
    }

    let setup_result = route_setup::setup_transfer_route(
        project_root_path,
        RouteEndpoint::new(from.into(), from_network),
        RouteEndpoint::new(to.into(), to_network),
    );

    let restart_result = if relayer_was_running {
        start::start_hermes_daemon()
            .map_err(|error| format!("Route setup finished, but Hermes restart failed: {}", error))
    } else {
        Ok(())
    };

    let route = setup_result?;
    restart_result?;

    logger::log("PASS: Token-transfer route is ready");
    for line in route.summary_lines() {
        logger::log(&format!("  - {}", line));
    }

    Ok(())
}

impl From<TransferRouteChainArg> for RouteChain {
    fn from(value: TransferRouteChainArg) -> Self {
        match value {
            TransferRouteChainArg::Cardano => Self::Cardano,
            TransferRouteChainArg::Cosmos => Self::Cosmos,
            TransferRouteChainArg::Injective => Self::Injective,
            TransferRouteChainArg::Osmosis => Self::Osmosis,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unsupported_devkit_cosmos_endpoint_fails_before_starting_hermes() {
        let root = std::env::temp_dir().join(format!(
            "caribic-route-preflight-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(root.join(".caribic")).unwrap();
        std::fs::write(root.join(".caribic-network"), "local\n").unwrap();
        std::fs::write(root.join(".caribic/local-runtime"), "devkit\n").unwrap();
        for (from, from_network, to, to_network) in [
            (
                TransferRouteChainArg::Cardano,
                None,
                TransferRouteChainArg::Cosmos,
                Some("v10-classic".into()),
            ),
            (
                TransferRouteChainArg::Cosmos,
                Some("v10-classic".into()),
                TransferRouteChainArg::Cardano,
                None,
            ),
        ] {
            let error = run_setup_route(&root, from, from_network, to, to_network).unwrap_err();
            assert!(
                error.contains("supported only by the local v8-classic Cosmos fixture"),
                "{error}"
            );
        }
        for destination in [
            TransferRouteChainArg::Osmosis,
            TransferRouteChainArg::Injective,
        ] {
            let error = run_setup_route(
                &root,
                TransferRouteChainArg::Cardano,
                None,
                destination,
                None,
            )
            .unwrap_err();
            assert!(
                error.contains("DevKit token-transfer routes require Cosmos v8-classic"),
                "{error}"
            );
        }
        std::fs::remove_dir_all(root).unwrap();
    }
}
