use std::{fs, time::Duration};

use ibc_proto::{
    cosmos::tx::v1beta1::{AuthInfo, Fee, TxRaw},
    google::protobuf::Any,
};
use ibc_relayer::{
    chain::cosmos::{
        batch::send_batched_messages_and_wait_commit,
        types::{
            account::{Account, AccountAddress, AccountNumber, AccountSequence},
            config::TxConfig,
            gas::GasConfig,
        },
    },
    config::{
        dynamic_gas::DynamicGasPrice,
        types::{MaxMsgNum, MaxTxSize, Memo},
        AddressType, GasPrice,
    },
    keyring::Secp256k1KeyPair,
};
use prost::Message;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tendermint_rpc::{Client, HttpClient};

// This probe calls the pinned Hermes transaction code. It does not implement
// another simulation, signing, batching, or broadcast path.
#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let input: Value = serde_json::from_slice(&fs::read(
        std::env::args().nth(1).ok_or("input file required")?,
    )?)?;
    let key: Secp256k1KeyPair = serde_json::from_value(input["key"].clone())?;
    let mut account = Account {
        address: AccountAddress::new(input["signer"].as_str().ok_or("signer required")?.into()),
        number: AccountNumber::new(
            input["account_number"]
                .as_u64()
                .ok_or("account number required")?,
        ),
        sequence: AccountSequence::new(input["sequence"].as_u64().ok_or("sequence required")?),
    };
    let max_gas = input["max_gas"].as_u64().ok_or("gas cap required")?;
    let gas_price = GasPrice {
        price: 0.0025,
        denom: "stake".into(),
    };
    let config = TxConfig {
        chain_id: input["chain_id"]
            .as_str()
            .ok_or("chain id required")?
            .parse()?,
        gas_config: GasConfig {
            default_gas: 5_000_000,
            max_gas,
            gas_multiplier: 1.8,
            gas_price,
            max_fee: Fee {
                gas_limit: max_gas,
                amount: vec![ibc_proto::cosmos::base::v1beta1::Coin {
                    denom: "stake".into(),
                    amount: "1500000".into(),
                }],
                payer: String::new(),
                granter: String::new(),
            },
            fee_granter: String::new(),
            dynamic_gas_price: DynamicGasPrice::disabled(),
        },
        rpc_address: input["rpc"].as_str().ok_or("RPC required")?.parse()?,
        grpc_address: input["grpc"].as_str().ok_or("gRPC required")?.parse()?,
        rpc_timeout: Duration::from_secs(10),
        address_type: AddressType::Cosmos,
        max_msg_num: MaxMsgNum::new(20)?,
        max_tx_size: MaxTxSize::new(
            input["max_tx_bytes"].as_u64().ok_or("byte cap required")? as usize
        )?,
        extension_options: vec![],
    };
    let rpc = HttpClient::builder(config.rpc_address.clone().try_into()?)
        .compat_mode(tendermint_rpc::client::CompatMode::V0_38)
        .timeout(config.rpc_timeout)
        .build()?;
    let message = Any::decode(
        fs::read(
            input["message_file"]
                .as_str()
                .ok_or("message file required")?,
        )?
        .as_slice(),
    )?;
    let messages = vec![message];
    let events = send_batched_messages_and_wait_commit(
        &rpc,
        &config,
        &key,
        &mut account,
        &Memo::default(),
        messages,
    )
    .await?;
    let height = tendermint::block::Height::try_from(
        events
            .first()
            .ok_or("missing challenge event")?
            .height
            .revision_height(),
    )?;
    let block = rpc.block(height).await?;
    if block.block.data.len() != 1 {
        return Err("expected one challenge transaction".into());
    }
    let wire = &block.block.data[0];
    let tx = TxRaw::decode(wire.as_slice())?;
    let fee = AuthInfo::decode(tx.auth_info_bytes.as_slice())?
        .fee
        .ok_or("missing fee")?;
    if wire.len() > config.max_tx_size.to_usize() {
        return Err("signed challenge exceeds the relayer byte budget".into());
    }
    fs::write(
        input["wire_file"].as_str().ok_or("wire file required")?,
        wire,
    )?;
    let hash = tendermint::Hash::Sha256(Sha256::digest(wire).into());
    let committed = rpc.tx(hash, false).await?;
    if committed.tx_result.code.is_err() {
        return Err(format!("challenge execution failed: {}", committed.tx_result.log).into());
    }
    // Hermes clamps adjusted gas to max_gas. The executed challenge must fit
    // with the multiplier before that clamp can conceal a capacity deficit.
    if (committed.tx_result.gas_used as f64 * config.gas_config.gas_multiplier).ceil() as u64
        > max_gas
    {
        return Err("challenge exceeds the relayer gas budget after its multiplier".into());
    }
    println!(
        "{}",
        json!({"signed_tx_bytes": wire.len(), "gas_used": committed.tx_result.gas_used,
        "gas_wanted": fee.gas_limit, "events": events.len()})
    );
    Ok(())
}
