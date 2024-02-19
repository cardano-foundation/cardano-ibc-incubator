use crate::config::config;
use async_trait::async_trait;
use sqlx::{Error, PgPool, Pool, Postgres};
use tracing::{info, warn};

pub struct Database {
  pool: PgPool,
}

#[async_trait]
pub trait DatabaseTrait {
  async fn init() -> Result<Self, Error>
  where
    Self: Sized;
  fn get_pool(&self) -> &PgPool;
}

#[async_trait]
impl DatabaseTrait for Database {
  async fn init() -> Result<Self, Error> {
    let database_url = config::get("DATABASE_URL");
    // sqlx::postgres::PgPoolOptions::new().connect(url)
    let pool = sqlx::postgres::PgPoolOptions::new()
      .connect(&database_url)
      .await?;
    Ok(Self { pool })
  }

  fn get_pool(&self) -> &PgPool {
    &self.pool
  }
}
