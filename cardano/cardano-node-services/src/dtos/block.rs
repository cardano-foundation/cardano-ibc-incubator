// Original author: Christian Gill (@gillchristian)
// From: https://gist.github.com/gillchristian/db76e712cc02bff620b86f0cd2bfb691

use async_trait::async_trait;
use axum::extract::{FromRequestParts, Query};
use axum::http::{request::Parts, StatusCode};
use serde::Deserialize;
use validator::Validate;

#[derive(Debug, Clone, Deserialize)]
struct Height {
  height: u64,
}

impl Default for Height {
  fn default() -> Self {
    Self { height: 0 }
  }
}

#[derive(Clone, Deserialize)]
pub struct QueryBlockDataRequest {
  pub height: u64,
}

#[async_trait]
impl<S> FromRequestParts<S> for QueryBlockDataRequest
where
  S: Send + Sync,
{
  type Rejection = (StatusCode, &'static str);

  async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
    let Query(Height { height }) = Query::<Height>::from_request_parts(parts, state)
      .await
      .unwrap_or_default();

    Ok(Self { height })
  }
}
