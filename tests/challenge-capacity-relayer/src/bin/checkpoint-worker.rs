use ibc_proto::google::protobuf::Any;
use ibc_relayer::{
    chain::{
        cardano::{CardanoChainEndpoint, CardanoSigningKeyPair},
        cosmos::CosmosSdkChain,
        endpoint::ChainEndpoint,
        handle::{BaseChainHandle, ChainHandle},
        runtime::ChainRuntime,
        tracking::TrackedMsgs,
    },
    config::ChainConfig,
    event::source::ErrorDetail as MonitorErrorDetail,
    foreign_client::{ForeignClient, HasExpiredOrFrozenError},
    keyring::{KeyRing, Secp256k1KeyPair, Store},
    worker::{
        client::{detect_misbehavior_task, spawn_refresh_client},
        WorkerCmd,
    },
};
use ibc_relayer_types::events::IbcEvent;
use prost::Message;
use serde_json::{json, Value};
use std::{fs, io::Write, path::PathBuf, sync::Arc, time::Duration};

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
    let action = std::env::args().nth(2);
    if action.as_deref() == Some("--create") {
        let created = ForeignClient::new(dst.clone(), src.clone())?;
        println!("{}", json!({"client_id":created.id().to_string()}));
        dst.shutdown()?;
        src.shutdown()?;
        return Ok(());
    }
    if action.as_deref() == Some("--submit") {
        let file = std::env::args()
            .nth(3)
            .ok_or("protobuf Any file required")?;
        let message = Any::decode(fs::read(file)?.as_slice())?;
        let events = dst.send_messages_and_wait_commit(TrackedMsgs::new_static(
            vec![message],
            "readiness submission",
        ))?;
        println!("{}", json!({"events":format!("{events:?}")}));
        dst.shutdown()?;
        src.shutdown()?;
        return Ok(());
    }
    let mut client = ForeignClient::restore(
        input["client_id"]
            .as_str()
            .ok_or("client id required")?
            .parse()?,
        dst.clone(),
        src.clone(),
    );
    match action.as_deref() {
        Some("--counters") => {
            let (ibc_relayer::client_state::AnyClientState::Probabilistic(state), _) =
                client.validated_client_state()?
            else {
                return Err("probabilistic client required".into());
            };
            let response = dst.query_probabilistic_verification(
                ibc_relayer_types::clients::ics08_cardano_probabilistic::raw::QueryVerificationRequest {
                    namespace: state.storage_namespace,
                    generation: state.verification_generation,
                    kind: 5,
                    limit: 128,
                    ..Default::default()
                },
                ibc_relayer::chain::requests::QueryHeight::Latest,
            )?;
            println!("{}", String::from_utf8(response)?);
            dst.shutdown()?;
            src.shutdown()?;
            return Ok(());
        }
        Some("--refresh-once") => {
            let events = client.refresh()?;
            println!("{}", json!({"events":format!("{events:?}")}));
            dst.shutdown()?;
            src.shutdown()?;
            return Ok(());
        }
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
    let worker = if action.as_deref() == Some("--watch-only") {
        None
    } else {
        Some(spawn_refresh_client(client.clone()).ok_or("client already expired or frozen")?)
    };
    let substitute_worker = if input["maintain_substitute"].as_bool().unwrap_or(false) {
        spawn_refresh_client(ForeignClient::restore(
            "08-cardano-probabilistic-2".parse()?,
            dst.clone(),
            src.clone(),
        ))
    } else {
        None
    };
    let subscription = dst.subscribe()?;
    let (sender, receiver) = crossbeam_channel::unbounded();
    let watcher = detect_misbehavior_task(receiver, client.clone());
    let output = path.with_extension("progress.json");
    let mut observed = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path.with_extension("events.jsonl"))?;
    let mut batches = 0u64;
    while !path.with_extension("stop").exists()
        && !worker.as_ref().is_some_and(|worker| worker.is_stopped())
    {
        let state = client.validated_client_state();
        let record = match state {
            Ok((ibc_relayer::client_state::AnyClientState::Probabilistic(state), elapsed)) => {
                json!({"active":true,"proof_height":state.latest_height.revision_height(),"checkpoint_height":state.latest_verified_height().revision_height(),"checkpoint_timestamp":state.latest_checkpoint_timestamp,"verification_generation":state.verification_generation,"epoch_response_windows":state.epoch_context_challenges.iter().map(|entry|json!({"epoch":entry.epoch,"usable_after_unix_ns":entry.usable_after_unix_ns})).collect::<Vec<_>>(),"elapsed_seconds":elapsed.map(|duration|duration.as_secs()),"production_event_batches":batches})
            }
            other => json!({"active":false,"error":format!("{other:?}")}),
        };
        let temporary = output.with_extension("tmp");
        fs::write(&temporary, serde_json::to_vec_pretty(&record)?)?;
        fs::rename(temporary, &output)?;
        match subscription.recv_timeout(Duration::from_secs(1)) {
            Ok(result) => match result.as_ref() {
                Ok(batch) => {
                    batches += 1;
                    writeln!(
                        observed,
                        "{}",
                        json!({"height":batch.height.to_string(),"events":batch.events.iter().map(|event|format!("{:?}",event.event)).collect::<Vec<_>>()})
                    )?;
                    observed.flush()?;
                    let mut updates = batch.clone();
                    updates.events.retain(|event| matches!(&event.event,IbcEvent::UpdateClient(update) if update.client_id() == client.id()));
                    if !updates.events.is_empty() {
                        sender.send(WorkerCmd::IbcEvents { batch: updates })?;
                    }
                }
                Err(error) if matches!(error.detail(), MonitorErrorDetail::Rpc(_)) => {
                    writeln!(observed, "{}", json!({"rpc_retry":error.to_string()}))?;
                    observed.flush()?;
                }
                Err(error) => {
                    return Err(format!("production event collection failed: {error}").into())
                }
            },
            Err(crossbeam_channel::RecvTimeoutError::Timeout) => {}
            Err(error) => return Err(error.into()),
        }
    }
    if let Some(worker) = worker {
        worker.shutdown_and_wait();
    }
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
