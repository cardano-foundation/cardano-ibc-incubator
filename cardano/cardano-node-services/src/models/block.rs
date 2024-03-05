use chrono::{DateTime, FixedOffset, NaiveDateTime, NaiveTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::prelude::*;
use sqlx::{any::AnyRow, Any};

use sqlx::postgres::PgRow;

use crate::utils::date::Date;
#[derive(Clone, Deserialize, Serialize, sqlx::FromRow)]
pub struct Block {
  pub id: i64,
  pub hash: Vec<u8>,
  pub epoch_no: i32,
  pub slot_no: i64,
  pub epoch_slot_no: i32,
  pub block_no: i32,
  pub previous_id: i64,
  pub slot_leader_id: i64,
  pub size: i32,
  pub tx_count: i64,
  pub proto_major: i32,
  pub proto_minor: i32,
  pub vrf_key: String,
  pub op_cert: Vec<u8>,
  pub op_cert_counter: i64,
  pub time_formatted: String,
}
