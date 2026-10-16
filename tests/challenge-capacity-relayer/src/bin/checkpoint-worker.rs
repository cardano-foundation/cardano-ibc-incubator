use ibc_relayer::{
    chain::{
        cardano::{CardanoChainEndpoint, CardanoSigningKeyPair},
        cosmos::CosmosSdkChain,
        endpoint::ChainEndpoint,
        handle::{BaseChainHandle, ChainHandle},
        runtime::ChainRuntime,
    },
    config::ChainConfig,
    foreign_client::{ForeignClient, HasExpiredOrFrozenError},
    keyring::{KeyRing, Secp256k1KeyPair, Store},
    worker::client::{detect_misbehavior_task, spawn_refresh_client},
};
use serde_json::{json, Value};
use std::{fs, path::PathBuf, sync::Arc, time::Duration};

// Disposable integration driver. Both chain handles are production endpoints.
// The ordinary five-second refresh worker owns checkpoint selection and submission.
fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();
    let path = PathBuf::from(std::env::args().nth(1).ok_or("input JSON required")?);
    let input: Value = serde_json::from_slice(&fs::read(&path)?)?;
    let runtime = Arc::new(tokio::runtime::Runtime::new()?);
    let destination: ChainConfig = serde_json::from_value(input["destination"].clone())?;
    let source: ChainConfig = serde_json::from_value(input["source"].clone())?;
    let key: Secp256k1KeyPair = serde_json::from_slice(&fs::read(
        input["key"].as_str().ok_or("key file required")?,
    )?)?;
    let mut host = CosmosSdkChain::bootstrap(destination.clone(), runtime.clone())?;
    host.keybase_mut().add_key("checkpoint", key)?;
    drop(host);
    let ChainConfig::Cardano(cardano) = &source else {
        return Err("Cardano source required".into());
    };
    let mut source_keys: KeyRing<CardanoSigningKeyPair> =
        KeyRing::new(Store::Test, "addr", &cardano.id, &cardano.key_store_folder)?;
    source_keys.add_key("checkpoint",CardanoSigningKeyPair::new("abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about".into(),0,0)?)?;
    let dst: BaseChainHandle = ChainRuntime::<CosmosSdkChain>::spawn(destination, runtime.clone())?;
    let src: BaseChainHandle = ChainRuntime::<CardanoChainEndpoint>::spawn(source, runtime)?;
    let client = ForeignClient::restore(
        input["client_id"]
            .as_str()
            .ok_or("client id required")?
            .parse()?,
        dst.clone(),
        src.clone(),
    );
    match std::env::args().nth(2).as_deref() {
        Some("--status") => {
            let result = client.validated_client_state();
            let record = match result {
                Ok((ibc_relayer::client_state::AnyClientState::Probabilistic(state), elapsed)) => {
                    json!({"active":true,"expired":false,"frozen":false,"checkpoint_height":state.latest_verified_height().revision_height(),"proof_height":state.latest_height.revision_height(),"checkpoint_timestamp":state.latest_checkpoint_timestamp,"verification_generation":state.verification_generation,"epoch_response_windows":state.epoch_context_challenges.iter().map(|entry|json!({"epoch":entry.epoch,"usable_after_unix_ns":entry.usable_after_unix_ns})).collect::<Vec<_>>(),"elapsed_seconds":elapsed.map(|duration|duration.as_secs())})
                }
                Err(error) => {
                    json!({"active":false,"expired":error.is_expired_error(),"frozen":error.is_frozen_error(),"error":error.to_string()})
                }
                other => json!({"active":false,"error":format!("{other:?}")}),
            };
            println!("{}", record);
            dst.shutdown()?;
            src.shutdown()?;
            return Ok(());
        }
        Some("--update") => {
            let height = std::env::args()
                .nth(3)
                .ok_or("update height required")?
                .parse()?;
            let events = client.build_update_client_and_send(
                ibc_relayer::chain::requests::QueryHeight::Specific(
                    ibc_relayer_types::Height::new(0, height)?,
                ),
                None,
            )?;
            println!("{}", json!({"events":format!("{events:?}")}));
            dst.shutdown()?;
            src.shutdown()?;
            return Ok(());
        }
        _ => {}
    }
    let worker = spawn_refresh_client(client.clone()).ok_or("client already expired or frozen")?;
    let substitute_worker = if input["maintain_substitute"].as_bool().unwrap_or(false) {
        spawn_refresh_client(ForeignClient::restore(
            "08-cardano-probabilistic-2".parse()?,
            dst.clone(),
            src.clone(),
        ))
    } else {
        None
    };
    let (_sender, receiver) = crossbeam_channel::unbounded();
    let watcher = detect_misbehavior_task(receiver, client.clone());
    let output = path.with_extension("progress.json");
    while !path.with_extension("stop").exists() && !worker.is_stopped() {
        let state = client.validated_client_state();
        let record = match state {
            Ok((ibc_relayer::client_state::AnyClientState::Probabilistic(state), elapsed)) => {
                json!({"active":true,"proof_height":state.latest_height.revision_height(),"checkpoint_height":state.latest_verified_height().revision_height(),"checkpoint_timestamp":state.latest_checkpoint_timestamp,"verification_generation":state.verification_generation,"epoch_response_windows":state.epoch_context_challenges.iter().map(|entry|json!({"epoch":entry.epoch,"usable_after_unix_ns":entry.usable_after_unix_ns})).collect::<Vec<_>>(),"elapsed_seconds":elapsed.map(|duration|duration.as_secs())})
            }
            other => json!({"active":false,"error":format!("{other:?}")}),
        };
        let temporary = output.with_extension("tmp");
        fs::write(&temporary, serde_json::to_vec_pretty(&record)?)?;
        fs::rename(temporary, &output)?;
        std::thread::sleep(Duration::from_secs(1));
    }
    worker.shutdown_and_wait();
    if let Some(worker) = substitute_worker {
        worker.shutdown_and_wait();
    }
    if let Some(watcher) = watcher {
        watcher.shutdown_and_wait();
    }
    dst.shutdown()?;
    src.shutdown()?;
    Ok(())
}
