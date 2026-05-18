use std::path::Path;

pub async fn run_message_exchange_demo(_project_root_path: &Path) -> Result<(), String> {
    Err(
        "Message-exchange demo is disabled because it depended on the phased-out intermediary chain. Direct ICQ/message exchange support must be implemented against a target chain explicitly."
            .to_string(),
    )
}
