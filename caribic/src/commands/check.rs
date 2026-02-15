use crate::check;

pub async fn run_check() -> Result<(), String> {
    check::check_prerequisites().await;

    Ok(())
}
