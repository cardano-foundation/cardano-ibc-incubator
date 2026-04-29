use crate::process::runner;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};

pub struct DockerCli {
    current_dir: PathBuf,
    envs: Vec<(String, String)>,
}

impl DockerCli {
    pub fn new(current_dir: &Path) -> Self {
        Self {
            current_dir: current_dir.to_path_buf(),
            envs: Vec::new(),
        }
    }

    pub fn with_envs(mut self, envs: &[(&str, &str)]) -> Self {
        self.envs = envs
            .iter()
            .map(|(key, value)| (key.to_string(), value.to_string()))
            .collect();
        self
    }

    pub fn compose_output(&self, args: &[&str]) -> Result<Output, String> {
        let mut command = self.compose_command(args);
        runner::run_ok_output(&mut command)
    }

    pub fn compose_ok(&self, args: &[&str]) -> Result<(), String> {
        let mut command = self.compose_command(args);
        runner::run_ok_output(&mut command).map(|_| ())
    }

    pub fn compose_exec_no_tty_output(
        &self,
        service: &str,
        args: &[&str],
    ) -> Result<Output, String> {
        let mut compose_args = vec!["exec", "-T", service];
        compose_args.extend_from_slice(args);
        self.compose_output(compose_args.as_slice())
    }

    pub fn raw_output(&self, args: &[&str]) -> Result<Output, String> {
        let mut command = self.raw_command(args);
        runner::run_ok_output(&mut command)
    }

    pub(crate) fn compose_command(&self, args: &[&str]) -> Command {
        let mut command = self.base_command();
        command.arg("compose").args(args);
        command
    }

    pub(crate) fn raw_command(&self, args: &[&str]) -> Command {
        let mut command = self.base_command();
        command.args(args);
        command
    }

    fn base_command(&self) -> Command {
        let mut command = Command::new("docker");
        command.current_dir(&self.current_dir);
        for (key, value) in &self.envs {
            command.env(key, value);
        }
        command
    }
}
