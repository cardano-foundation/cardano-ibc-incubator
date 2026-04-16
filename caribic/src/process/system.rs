use crate::process::runner;
use std::ffi::OsStr;
use std::path::Path;
use std::process::{Command, Output};

pub struct SystemChecks;

impl SystemChecks {
    pub fn output<S: AsRef<OsStr>>(command: S, args: &[&str]) -> Result<Output, String> {
        let mut process = Command::new(command);
        process.args(args);
        runner::run_output(&mut process)
    }

    pub fn is_process_alive(pid: u32) -> bool {
        Command::new("kill")
            .args(["-0", &pid.to_string()])
            .status()
            .map(|status| status.success())
            .unwrap_or(false)
    }

    pub fn process_command(pid: u32) -> Option<String> {
        let mut command = Command::new("ps");
        command.args(["-p", &pid.to_string(), "-o", "command="]);
        let output = runner::run_output(&mut command).ok()?;
        if !output.status.success() {
            return None;
        }

        let command = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if command.is_empty() {
            None
        } else {
            Some(command)
        }
    }

    pub fn send_signal(pid: u32, signal: &str) -> Result<(), String> {
        let mut command = Command::new("kill");
        command.args([signal, &pid.to_string()]);
        runner::run_ok_output(&mut command).map(|_| ())
    }

    pub fn find_processes_by_command() -> Result<String, String> {
        let mut command = Command::new("ps");
        command.args(["-ax", "-o", "pid=,command="]);
        let output = runner::run_ok_output(&mut command)?;
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    }

    pub fn tcp_port_open(host: &str, port: u16) -> bool {
        Command::new("nc")
            .args(["-z", host, &port.to_string()])
            .status()
            .map(|status| status.success())
            .unwrap_or(false)
    }

    pub fn shell_succeeds(command: &str) -> bool {
        Self::output("sh", &["-lc", command])
            .map(|output| output.status.success())
            .unwrap_or(false)
    }

    pub fn filesystem_df_kib(path: &Path) -> Option<(u64, u64)> {
        let path_str = path.to_str()?;
        let output = Self::output("df", &["-Pk", path_str]).ok()?;
        if !output.status.success() {
            return None;
        }

        let df_stdout = String::from_utf8_lossy(&output.stdout);
        let data_line = df_stdout.lines().nth(1)?.trim();
        let columns: Vec<&str> = data_line.split_whitespace().collect();
        if columns.len() < 4 {
            return None;
        }

        let total_kib = columns.get(1)?.parse::<u64>().ok()?;
        let free_kib = columns.get(3)?.parse::<u64>().ok()?;
        Some((total_kib, free_kib))
    }
}
