use crate::process::runner;
use std::env;
use std::process::Command;

pub fn run_shell(shell_command: &str) -> Result<(), String> {
    run_command("sh", &["-lc", shell_command])
}

pub fn run_privileged_command(command: &str, args: &[&str]) -> Result<(), String> {
    if is_root_user() {
        return run_command(command, args);
    }

    if !command_exists("sudo") {
        return Err(format!(
            "`sudo` is required to run '{} {}' as a non-root user",
            command,
            args.join(" ")
        ));
    }

    let mut sudo_args = vec![command];
    sudo_args.extend_from_slice(args);
    run_command("sudo", sudo_args.as_slice())
}

pub fn run_command(command: &str, args: &[&str]) -> Result<(), String> {
    let mut cmd = Command::new(command);
    cmd.args(args);
    runner::run_ok_output(&mut cmd).map(|_| ())
}

pub fn run_command_streaming(command: &str, args: &[&str]) -> Result<(), String> {
    let mut cmd = Command::new(command);
    cmd.args(args);
    runner::run_inherit_status(&mut cmd)
}

pub fn command_exists(binary: &str) -> bool {
    let Some(path_var) = env::var_os("PATH") else {
        return false;
    };

    env::split_paths(&path_var).any(|directory| {
        let candidate = directory.join(binary);
        candidate.is_file()
    })
}

fn is_root_user() -> bool {
    Command::new("id")
        .arg("-u")
        .output()
        .ok()
        .and_then(|output| String::from_utf8(output.stdout).ok())
        .map(|uid| uid.trim() == "0")
        .unwrap_or(false)
}
