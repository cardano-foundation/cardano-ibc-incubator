use crate::config;
use std::path::{Path, PathBuf};
use std::process::Output;

pub struct CardanoCli {
    network_magic: String,
    project_root: PathBuf,
}

impl CardanoCli {
    pub fn new(project_root_dir: &Path) -> Self {
        let active_network = config::active_core_cardano_network(project_root_dir);
        let network_magic = config::cardano_network_profile(active_network)
            .network_magic
            .to_string();
        Self {
            project_root: project_root_dir.to_path_buf(),
            network_magic,
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
        if !crate::local_network::is_local(&self.project_root) {
            return Err("Cardano CLI queries require the local network. Public networks use the configured Gateway endpoints.".into());
        }
        crate::local_network::command(&self.project_root, "cli")
            .args(cardano_cli_args)
            .output()
            .map_err(|error| error.to_string())
    }
}
