use std::{fs, sync::Arc};

use ibc_relayer::{
    chain::{
        cosmos::CosmosSdkChain,
        endpoint::ChainEndpoint,
        handle::{BaseChainHandle, ChainRequest},
    },
    config::ChainConfig,
    foreign_client::{ForeignClient, MisbehaviourResults},
    keyring::Secp256k1KeyPair,
    misbehaviour::{AnyMisbehaviour, MisbehaviourEvidence},
};
use ibc_relayer_types::{
    clients::ics08_cardano_probabilistic::{misbehaviour::Misbehaviour, raw},
    core::{ics02_client::header::AnyHeader, ics24_host::identifier::ChainId},
    Height,
};
use prost::Message;
use serde_json::{json, Value};

// The source is a fixed, natively signed fork fixture. All destination queries
// and challenge submission use the pinned Hermes Cosmos endpoint after restart.
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let input: Value = serde_json::from_slice(&fs::read(
        std::env::args().nth(1).ok_or("input file required")?,
    )?)?;
    let runtime = Arc::new(tokio::runtime::Runtime::new()?);
    let config: ChainConfig = serde_json::from_value(json!({
        "type": "CosmosSdk", "id": input["chain_id"],
        "rpc_addr": input["rpc"], "grpc_addr": input["grpc"],
        "event_source": {"mode": "pull", "interval": "100ms"},
        "account_prefix": "cosmos", "key_name": "startup", "key_store_type": "Memory",
        "store_prefix": "ibc", "gas_price": {"price": 0.0025, "denom": "stake"},
        "default_gas": 5_000_000, "max_gas": input["max_gas"], "gas_multiplier": 1.8,
        "max_msg_num": 20, "max_tx_size": input["max_tx_bytes"]
    }))?;
    let mut host = CosmosSdkChain::bootstrap(config.clone(), runtime)?;
    let key: Secp256k1KeyPair = serde_json::from_value(input["key"].clone())?;
    host.keybase_mut().add_key("startup", key)?;
    let epoch = input["epoch"].as_u64().ok_or("proposal epoch required")?;
    let trusted = Height::new(
        0,
        input["trusted_height"]
            .as_u64()
            .ok_or("trusted height required")?,
    )?;
    let expected_context = raw::ClientState::decode(
        fs::read(input["context_file"].as_str().ok_or("context required")?)?.as_slice(),
    )?;
    let fork = raw::ProbabilisticHeader::decode(
        fs::read(input["fork_file"].as_str().ok_or("fork required")?)?.as_slice(),
    )?;
    let witness: ibc_relayer_types::clients::ics08_cardano_probabilistic::header::Header =
        fork.try_into()?;
    let (source_sender, source_receiver) = crossbeam_channel::unbounded();
    let source = BaseChainHandle::new(ChainId::from_string("cardano-0"), source_sender);
    let source_config = config.clone();
    let source_thread = std::thread::spawn(move || {
        let mut checked = 0;
        for (_, request) in source_receiver {
            match request {
                ChainRequest::BuildMisbehaviour {
                    update_event,
                    client_state,
                    challenge_context,
                    reply_to,
                } => {
                    let AnyHeader::Probabilistic(submitted) = update_event.header.unwrap() else {
                        panic!("expected recovered probabilistic proposal");
                    };
                    assert_eq!(submitted.trusted_height, trusted);
                    assert_eq!(submitted.new_epoch_context.as_ref().unwrap().epoch, epoch);
                    let context =
                        raw::ClientState::decode(challenge_context.unwrap().as_slice()).unwrap();
                    assert!(
                        context == expected_context,
                        "pre-proposal checkpoint differs"
                    );
                    let ibc_relayer::client_state::AnyClientState::Probabilistic(state) =
                        client_state
                    else {
                        panic!("expected probabilistic client");
                    };
                    assert_eq!(state.current_epoch, epoch - 1);
                    assert_eq!(state.latest_checkpoint_epoch, epoch - 1);
                    assert_eq!(state.latest_checkpoint_height, Some(trusted));
                    checked += 1;
                    reply_to
                        .send(Ok(Some(MisbehaviourEvidence {
                            misbehaviour: AnyMisbehaviour::Probabilistic(Misbehaviour {
                                client_id: update_event.common.client_id,
                                header1: submitted,
                                header2: witness.clone(),
                                verified_observation_1: vec![],
                                verified_observation_2: vec![],
                            }),
                            supporting_headers: vec![],
                        })))
                        .unwrap();
                }
                ChainRequest::Config { reply_to } => {
                    reply_to.send(Ok(source_config.clone())).unwrap();
                }
                other => panic!("unexpected source request: {other:?}"),
            }
        }
        checked
    });
    let (destination_sender, destination_receiver) = crossbeam_channel::unbounded();
    let destination = BaseChainHandle::new(config.id().clone(), destination_sender);
    let destination_thread = std::thread::spawn(move || {
        let mut requested_epochs = vec![];
        let mut trusted_heights = vec![];
        for (_, request) in destination_receiver {
            match request {
                ChainRequest::QueryClientState {
                    request,
                    include_proof,
                    reply_to,
                } => {
                    reply_to
                        .send(host.query_client_state(request, include_proof))
                        .unwrap();
                }
                ChainRequest::QueryPacketEventDataFromTxs { request, reply_to } => {
                    let ibc_relayer::chain::requests::QueryTxRequest::Client(query) = &request
                    else {
                        panic!("expected proposal transaction query");
                    };
                    assert_eq!(query.probabilistic_epoch, Some(epoch));
                    assert_eq!(query.consensus_height, trusted);
                    requested_epochs.push(query.probabilistic_epoch.unwrap());
                    reply_to.send(host.query_txs(request)).unwrap();
                }
                ChainRequest::QueryCardanoChallengeContext {
                    client_id,
                    trusted_height,
                    reply_to,
                } => {
                    assert_eq!(trusted_height, trusted);
                    trusted_heights.push(trusted_height.revision_height());
                    reply_to
                        .send(host.query_cardano_challenge_context(client_id, trusted_height))
                        .unwrap();
                }
                ChainRequest::Signer { reply_to } => {
                    reply_to.send(host.get_signer()).unwrap();
                }
                ChainRequest::SendMessagesAndWaitCommit {
                    tracked_msgs,
                    reply_to,
                } => {
                    let deadline = input["deadline"].as_u64().unwrap();
                    assert!(
                        host.query_application_status()
                            .unwrap()
                            .timestamp
                            .nanoseconds()
                            < deadline
                    );
                    reply_to
                        .send(host.send_messages_and_wait_commit(tracked_msgs))
                        .unwrap();
                }
                other => panic!("unexpected destination request: {other:?}"),
            }
        }
        (requested_epochs, trusted_heights)
    });
    let client = ForeignClient::restore("08-cardano-probabilistic-0".parse()?, destination, source);
    // No update event or previous watcher state survives this fresh process.
    let result = client.detect_misbehaviour_and_submit_evidence(None);
    assert!(
        matches!(result, MisbehaviourResults::EvidenceSubmitted(_)),
        "{result:?}"
    );
    drop(client);
    let checked = source_thread.join().expect("source runtime panicked");
    let (epochs, heights) = destination_thread
        .join()
        .expect("destination runtime panicked");
    assert_eq!(checked, 1);
    assert_eq!(epochs, vec![epoch]);
    assert_eq!(heights, vec![trusted.revision_height()]);
    println!(
        "{}",
        json!({"proposal_epochs": epochs, "trusted_heights": heights, "checked": checked})
    );
    Ok(())
}
