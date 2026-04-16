use crate::logger::{self, verbose};
use crate::process::runner::{self, StreamKind, StreamingOptions};
use std::path::{Path, PathBuf};
use std::process::{Command, Output};
use std::time::Duration;

pub struct HermesCli {
    binary: PathBuf,
}

impl HermesCli {
    pub fn new(binary: &Path) -> Self {
        Self {
            binary: binary.to_path_buf(),
        }
    }

    pub fn output(&self, current_dir: Option<&Path>, args: &[&str]) -> Result<Output, String> {
        let mut command = self.command(current_dir, args);
        runner::run_ok_output(&mut command)
    }

    pub fn output_with_progress(
        &self,
        current_dir: Option<&Path>,
        args: &[&str],
        heartbeat_interval: Duration,
    ) -> Result<Output, String> {
        let mut command = self.command(current_dir, args);
        runner::run_output_streaming(
            &mut command,
            StreamingOptions {
                label: "Hermes command",
                heartbeat_interval: Some(heartbeat_interval),
                log_failure_output: false,
            },
            |stream, line| {
                if logger::get_verbosity() == logger::Verbosity::Verbose {
                    let stream_name = match stream {
                        StreamKind::Stdout => "stdout",
                        StreamKind::Stderr => "stderr",
                    };
                    verbose(&format!("[Hermes/{stream_name}] {line}"));
                }
            },
        )
    }

    fn command(&self, current_dir: Option<&Path>, args: &[&str]) -> Command {
        let mut command = Command::new(&self.binary);
        if let Some(current_dir) = current_dir {
            command.current_dir(current_dir);
        }
        command.args(args);
        command
    }
}
