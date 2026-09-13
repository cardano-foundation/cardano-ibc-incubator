use crate::config;
use crate::process::docker::DockerCli;
use std::path::{Path, PathBuf};
use std::process::Output;

pub struct CardanoCli {
    docker: DockerCli,
    network_magic: String,
    project_root: PathBuf,
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
            project_root: cardano_dir.join("../.."),
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
        let output = self.exec_output_allow_failure(cardano_cli_args)?;
        if output.status.success() {
            Ok(output)
        } else {
            Err(format!(
                "Cardano CLI failed: {}",
                String::from_utf8_lossy(&output.stderr)
            ))
        }
    }

    pub fn exec_output_allow_failure(&self, cardano_cli_args: &[&str]) -> Result<Output, String> {
        if crate::local_runtime::is_devkit(&self.project_root) {
            return crate::local_runtime::command(&self.project_root, "cli")
                .args(cardano_cli_args)
                .output()
                .map_err(|error| error.to_string());
        }
        let mut args = vec!["cardano-cli"];
        args.extend_from_slice(cardano_cli_args);
        self.docker
            .compose_exec_no_tty_output_allow_failure("cardano-node", args.as_slice())
    }
}
