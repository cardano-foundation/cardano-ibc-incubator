use std::path::Path;
use std::process::Command;

/// Runs the three audit commands and fails on the first non-zero exit.
pub fn run_audit(project_root_path: &Path) -> Result<(), String> {
    let checks = [
        ("cardano/gateway", "npm", &["audit"][..]),
        ("caribic", "cargo", &["audit"][..]),
        ("cardano/onchain", "aiken", &["check"][..]),
    ];

    for (relative_dir, command, args) in checks {
        let status = Command::new(command)
            .args(args)
            .current_dir(project_root_path.join(relative_dir))
            .status()
            .map_err(|error| format!("Failed to run `{command} {}`: {error}", args.join(" ")))?;
        if !status.success() {
            return Err(format!(
                "`{command} {}` failed in `{}` (exit code {})",
                args.join(" "),
                relative_dir,
                status.code().unwrap_or(-1),
            ));
        }
    }

    Ok(())
}
