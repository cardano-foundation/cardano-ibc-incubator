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
            TransferRouteChainArg::Injective => Self::Injective,
            TransferRouteChainArg::Osmosis => Self::Osmosis,
        }
    }
}
