use thiserror::Error;

pub type Result<T> = std::result::Result<T, Error>;

#[derive(Error, Debug)]
pub enum Error {
    #[error("Gateway communication error: {0}")]
    Gateway(String),

    #[error("Transaction building error: {0}")]
    TxBuilder(String),

    #[error("Transaction signing error: {0}")]
    Signing(String),

    #[error("Key derivation error: {0}")]
    KeyDerivation(String),

    #[error("Serialization error: {0}")]
    Serialization(String),

    #[error("Invalid configuration: {0}")]
    Config(String),

    #[error("IBC error: {0}")]
    Ibc(String),

    #[error("gRPC error: {0}")]
    Grpc(#[from] tonic::Status),

    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),

    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Unknown error: {0}")]
    Unknown(String),
}

impl From<String> for Error {
    fn from(s: String) -> Self {
        Error::Unknown(s)
    }
}

impl From<&str> for Error {
    fn from(s: &str) -> Self {
        Error::Unknown(s.to_string())
    }
}

