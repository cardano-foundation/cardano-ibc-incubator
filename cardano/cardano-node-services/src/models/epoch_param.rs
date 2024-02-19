use chrono::{DateTime, FixedOffset, NaiveDateTime, NaiveTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{any::AnyRow, Any};

#[derive(Clone, Deserialize, Serialize, sqlx::FromRow)]
pub struct EpochParam {
  pub id: i64,
  pub epoch_no: i64,
  pub nonce: Vec<u8>,
  pub block_id: i64,
}
