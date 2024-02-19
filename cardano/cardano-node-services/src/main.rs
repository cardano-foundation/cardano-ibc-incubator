use std::env;
use std::net::SocketAddr;
use tokio::runtime::Builder;
use tracing::info;

use crate::config::database::DatabaseTrait;
use crate::config::{config as getConfig, database};
use std::sync::Arc;

mod app;
mod config;
mod dtos;
mod errors;
mod logger;
mod models;
mod repository;
mod routes;
mod state;
mod utils;

use errors::Error;

#[tokio::main(flavor = "multi_thread", worker_threads = 4)]
async fn main() {
  getConfig::init();
  info!("Config init");
  let connection = database::Database::init()
    .await
    .unwrap_or_else(|e| panic!("Database error: {}", e.to_string()));

  let app = app::create_app(Arc::new(connection)).await;

  let port = utils::common::convert_string_to_u64(getConfig::get("PORT")) as u16;
  let address = SocketAddr::from(([0, 0, 0, 0], port));

  info!("Server listening on {}", &address);
  axum::Server::bind(&address)
    .serve(app.into_make_service())
    .await
    .expect("Failed to start server");
}
