use std::path::Path;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RouteChain {
    Cardano,
    Injective,
    Osmosis,
}

impl RouteChain {
    pub fn display_name(self) -> &'static str {
        match self {
            Self::Cardano => "Cardano",
            Self::Injective => "Injective",
            Self::Osmosis => "Osmosis",
        }
    }
}

#[derive(Debug, Clone)]
pub struct RouteEndpoint {
    pub chain: RouteChain,
    pub network: Option<String>,
}

impl RouteEndpoint {
    pub fn new(chain: RouteChain, network: Option<String>) -> Self {
        Self { chain, network }
    }
}

#[derive(Debug, Clone)]
pub struct TransferRouteSetup {
    pub source_chain: RouteChain,
    pub source_network: Option<String>,
    pub destination_chain: RouteChain,
    pub destination_network: Option<String>,
}

impl TransferRouteSetup {
    pub fn summary_lines(&self) -> Vec<String> {
        vec![format!(
            "Direct {}{} -> {}{} route setup is not implemented.",
            self.source_chain.display_name(),
            format_network(self.source_network.as_deref()),
            self.destination_chain.display_name(),
            format_network(self.destination_network.as_deref())
        )]
    }
}

pub fn setup_transfer_route(
    _project_root_path: &Path,
    source: RouteEndpoint,
    destination: RouteEndpoint,
) -> Result<TransferRouteSetup, String> {
    if source.chain != RouteChain::Cardano {
        return Err(format!(
            "Only Cardano-sourced token-transfer routes are currently supported, got '{}'.",
            source.chain.display_name()
        ));
    }

    if destination.chain == RouteChain::Cardano {
        return Err("Cardano-to-Cardano token-transfer route setup is not supported.".to_string());
    }

    Err(format!(
        "Direct {}{} -> {}{} token-transfer route setup is not implemented yet. The former intermediary-chain route has been phased out.",
        source.chain.display_name(),
        format_network(source.network.as_deref()),
        destination.chain.display_name(),
        format_network(destination.network.as_deref())
    ))
}

fn format_network(network: Option<&str>) -> String {
    network
        .map(|value| format!(" ({value})"))
        .unwrap_or_default()
}
