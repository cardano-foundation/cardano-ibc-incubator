use crate::check;

/// Verifies local tool prerequisites used by caribic workflows.
pub async fn run_check() -> Result<(), String> {
    check::check_prerequisites().await;

    Ok(())
}
