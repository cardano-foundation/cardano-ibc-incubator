use crate::config::database::Database;
use crate::repository::block::{BlockRepository, BlockRepositoryTrait};
use std::sync::Arc;

#[derive(Clone)]
pub struct BlockState {
  pub repository: BlockRepository,
}

impl BlockState {
  pub fn new(db_conn: &Arc<Database>) -> Self {
    Self {
      repository: BlockRepository::new(db_conn),
    }
  }
}
