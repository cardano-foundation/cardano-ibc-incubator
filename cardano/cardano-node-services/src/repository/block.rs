use crate::config::database::{Database, DatabaseTrait};
use crate::models::block::Block;
use crate::models::epoch_param::EpochParam;
use async_trait::async_trait;
use pallas::codec::minicbor::data::Int;
use pallas::ledger::traverse::block;
use sqlx;
use sqlx::postgres::PgRow;
use sqlx::prelude::*;
use sqlx::Error;
use std::sync::Arc;
use tracing::warn;

#[derive(Clone)]
pub struct BlockRepository {
  pub(crate) db_conn: Arc<Database>,
}

#[async_trait]
pub trait BlockRepositoryTrait {
  fn new(db_conn: &Arc<Database>) -> Self;
  async fn find_by_block_no(&self, block_no: i32) -> Option<Block>;
  async fn find_epoch_param_by_epoch_no(&self, epoch_no: i32) -> Option<EpochParam>;
}

#[async_trait]
impl BlockRepositoryTrait for BlockRepository {
  fn new(db_conn: &Arc<Database>) -> Self {
    Self {
      db_conn: Arc::clone(db_conn),
    }
  }

  async fn find_by_block_no(&self, block_no: i32) -> Option<Block> {
    // let row: Vec<Block> = sqlx::query_as("SELECT * FROM block WHERE block_no = $1")
    //   .bind(block_no) // Example parameter binding
    //   .fetch_one(self.db_conn.get_pool())
    //   .await
    //   .expect("msg");

    // let query = sqlx::query_as::<_, Block>("SELECT *, TO_CHAR(time, 'YYYY-MM-DD HH24:MI:SS') AS time_formatted FROM block WHERE block_no = $1")
    //   .fetch_all(self.db_conn.get_pool())
    //   .await
    //   .unwrap();
    let block = sqlx::query_as::<_, Block>("SELECT *, TO_CHAR(time, 'YYYY-MM-DD HH24:MI:SS') AS time_formatted FROM block WHERE block_no = $1")
      .bind(block_no)
      .fetch_one(self.db_conn.get_pool())
      //   .fetch_optional(self.db_conn.get_pool())
      .await;
    match block {
      Ok(row) => {
        // The query returned a row, you can work with the data in 'row'
        println!("{:?}", row.block_no);
      }
      Err(e) => {
        // An error occurred during query execution
        eprintln!("Error executing query: {}", e);
      }
    }
    let block = sqlx::query_as::<_, Block>("SELECT *, TO_CHAR(time, 'YYYY-MM-DD HH24:MI:SS') AS time_formatted FROM block WHERE block_no = $1")
      .bind(block_no)
      .fetch_optional(self.db_conn.get_pool())
      .await
      .unwrap_or(None);
    return block;
  }

  async fn find_epoch_param_by_epoch_no(&self, epoch_no: i32) -> Option<EpochParam> {
    let epoch_param =
      sqlx::query_as::<_, EpochParam>("SELECT * FROM epoch_param WHERE epoch_no = $1")
        .bind(epoch_no)
        .fetch_optional(self.db_conn.get_pool())
        .await
        .unwrap_or(None);
    return epoch_param;
  }
}
