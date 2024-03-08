use crate::config::config;
use crate::config::database::Database;
use crate::dtos::block::QueryBlockDataRequest;
use crate::repository::block::BlockRepositoryTrait;
use crate::state::block::BlockState;
use crate::utils::common::convert_string_to_u64;
use crate::utils::date::parse_from_str_to_timestamp;
use crate::utils::to_hex_string::to_hex_string;
use axum::extract::State;
use axum::{routing::get, Json, Router};
use bson::doc;
use pallas::codec::minicbor::bytes::nil;
use pallas::ledger::traverse::wellknown::MAINNET_MAGIC;
use serde::{Deserialize, Serialize};
use serde_json::error;
use std::fmt::Pointer;
use std::io::Read;
use std::sync::Arc;
use std::vec;
use tracing::debug;
use tracing::info;

use hex::encode;
use minicbor::Encoder;
use pallas::ledger::traverse::{MultiEraBlock, MultiEraTx};
use pallas::{
  codec::utils::Nullable,
  network::{
    facades::PeerClient,
    miniprotocols::{Point, TESTNET_MAGIC},
  },
};
use std::convert::TryFrom;
use tracing::warn;

use crate::errors::{self, Error};

pub fn create_route() -> Router<BlockState> {
  Router::new().route("/blocks", get(get_block_data))
}

async fn get_block_data(
  State(state): State<BlockState>,
  request: QueryBlockDataRequest,
) -> Result<Json<BlockData>, Error> {
  debug!("Returning block data: {}", request.height);
  if request.height <= 0 {
    println!(", and is a small number, increase ten-fold");

    return Err(errors::Error::bad_request());
  }
  let current_block = state
    .repository
    .find_by_block_no(request.height as i32)
    .await
    .ok_or(errors::Error::not_found())?;
  let current_epoch_param = state
    .repository
    .find_epoch_param_by_epoch_no(current_block.epoch_no)
    .await;

  let mut epoch_nonce = config::get("CARDANO_EPOCH_NONCE_GENESIS").to_owned();
  if !current_epoch_param.is_none() {
    epoch_nonce = to_hex_string(current_epoch_param.expect("").nonce);
  }

  let block_hash = to_hex_string(current_block.hash.to_owned());
  let absolute_slot = current_block.slot_no;

  // mainnet
  // relays-new.cardano-mainnet.iohk.io:3001 -> ok

  let cardano_node_url = config::get("CARDANO_NODE_URL");
  let magic_number = convert_string_to_u64(config::get("CARDANO_MAGIC_NUM"));
  let mut peer = PeerClient::connect(&cardano_node_url, magic_number)
    .await
    .unwrap();

  // no tx
  let point: Point = Point::Specific(absolute_slot as u64, hex::decode(block_hash).unwrap());

  let cbor = peer.blockfetch().fetch_single(point).await.unwrap();
  let block = MultiEraBlock::decode(&cbor).expect("invalid cbor");
  let b_header = block.header();

  let mut buffer = [0u8; 500000];
  let mut encoder: Encoder<&mut [u8]> = Encoder::new(&mut buffer[..]);
  let tx_len = block.txs().len() as usize;
  let tx_len64 = u64::try_from(tx_len).unwrap();
  encoder.array(tx_len64).unwrap();
  warn!("tx_len ={}", tx_len);

  for tx in &block.txs() {
    match tx {
      MultiEraTx::Babbage(x) => {
        let transaction_body_cbor = x.transaction_body.raw_cbor();
        let transaction_witness_set_cbor = x.transaction_witness_set.raw_cbor();
        let auxiliary_data_cbor = match &x.auxiliary_data {
          Nullable::Some(aux) => aux.raw_cbor(),
          _ => &[],
        };
        let _ = encoder
          .array(3)
          .unwrap()
          .str(encode(transaction_body_cbor).as_str())
          .unwrap()
          .str(encode(transaction_witness_set_cbor).as_str())
          .unwrap()
          .str(encode(auxiliary_data_cbor).as_str())
          .unwrap();
        // .end();
      }
      _ => println!("noooooo"),
    }
  }
  let _ = encoder.end().unwrap();
  let data = hex::encode(buffer);
  let index_of = match data.rfind("ff0000000000000000000000000000000000000000") {
    Some(data_index) => data_index,
    None => data.len(),
  };

  peer.abort();

  Ok(Json(BlockData {
    block_no: block.number().to_owned(),
    slot: block.slot().to_owned(),
    hash: block.hash().to_string().to_owned(),
    header_cbor: hex::encode(b_header.cbor()).to_owned(),
    body_cbor: data[..index_of].to_string().to_owned(),
    prev_hash: hex::encode(
      block
        .header()
        .as_babbage()
        .unwrap()
        .header_body
        .prev_hash
        .expect("invalid prev hash"),
    ),
    epoch_no: current_block.epoch_no as u64,
    epoch_nonce: epoch_nonce.to_owned(),
    timestamp: parse_from_str_to_timestamp(current_block.time_formatted) as u64,
    chain_id: magic_number.to_string(),
  }))
}

#[derive(Serialize, Deserialize, Debug)]
struct Status {
  status: String,
}

#[derive(Serialize, Deserialize, Debug)]
struct BlockData {
  // block number
  block_no: u64,
  // slot number
  slot: u64,
  // block hash
  hash: String,
  // hash of previous block
  prev_hash: String,
  // epoch number
  epoch_no: u64,
  // hex string of block header to cbor
  header_cbor: String,
  // hex string of block txs to cbor
  body_cbor: String,
  // hex string of current epoch
  epoch_nonce: String,
  // timestamp of block
  timestamp: u64,
  // chain id
  chain_id: String,
}
