use crate::config;
use crate::process::docker::DockerCli;
use std::path::Path;
use std::process::Output;

pub struct CardanoCli {
    docker: DockerCli,
    network_magic: String,
}

impl CardanoCli {
    pub fn new(project_root_dir: &Path) -> Self {
        let active_network = config::active_core_cardano_network(project_root_dir);
        let network_magic = config::cardano_network_profile(active_network)
            .network_magic
            .to_string();
        let cardano_dir = project_root_dir.join("chains/cardano");
        Self::for_chain_dir_and_magic(cardano_dir.as_path(), network_magic.as_str())
    }

    pub fn for_chain_dir_and_magic(cardano_dir: &Path, network_magic: &str) -> Self {
        Self {
            docker: DockerCli::new(cardano_dir),
            network_magic: network_magic.to_string(),
        }
    }

    pub fn query_tip(&self) -> Result<Output, String> {
        self.exec_output(&[
            "query",
            "tip",
            "--cardano-mode",
            "--testnet-magic",
            self.network_magic.as_str(),
        ])
    }

    pub fn query_utxo(&self, address: &str) -> Result<Output, String> {
        self.exec_output(&[
            "query",
            "utxo",
            "--address",
            address,
            "--testnet-magic",
            self.network_magic.as_str(),
            "--output-json",
        ])
    }

    pub fn exec_output(&self, cardano_cli_args: &[&str]) -> Result<Output, String> {
        // Caribic runs Cardano queries against the managed devnet container rather than a host
        // install, so every typed Cardano call funnels through `docker compose exec`.
        self.docker
            .compose_exec_output("cardano-node", cardano_cli_args)
    }
}
