use alloy_primitives::{Bytes, FixedBytes};
use alloy_sol_types::{sol, SolValue};
use anyhow::{bail, ensure, Context};
use async_trait::async_trait;
use axum::{
    extract::{DefaultBodyLimit, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use ibc_proto::ibc::lightclients::tendermint::v1::{
    Header as ProtoHeader, Misbehaviour as ProtoMisbehaviour,
};
use prost::Message;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sp1_sdk::{
    CpuProver, Elf, HashableKey, ProveRequest, Prover, ProverClient, ProvingKey, SP1ProofMode,
    SP1ProvingKey, SP1Stdin,
};
use std::{
    collections::BTreeMap,
    env, fs,
    io::Read,
    net::SocketAddr,
    path::{Path, PathBuf},
    process::Command,
    sync::Arc,
    time::Instant,
};
use tempfile::TempDir;
use tokio::sync::Semaphore;

pub const UPDATE_CLIENT_PROGRAM: &str = "sp1-ics07-tendermint-update-client-v2.0.0";
pub const UPDATE_CLIENT_PROGRAM_VKEY_HEX: &str =
    "00d38536f65ab10e7eff0895b1b9f7cf12f89691631742bb487fe090027e0e6d";
pub const UPDATE_CLIENT_ELF_SHA256: &str =
    "6a6a40df2b1339455de7b238fdf3e914f4c2f99e85b8fc4abb65fb1664f42270";
pub const MISBEHAVIOUR_PROGRAM: &str = "sp1-ics07-tendermint-misbehaviour-v2.0.0";
pub const MISBEHAVIOUR_PROGRAM_VKEY_HEX: &str =
    "0010008da4267c2e85d02616e853379e3c937c03a271b5b005f479cff09ccfcb";
pub const MISBEHAVIOUR_ELF_SHA256: &str =
    "6ec141ebb604565dfb7669f8482bd3eacc57ae35158ba3931f1c20f78f7bf921";
pub const EUREKA_TAG: &str = "sp1-programs-v2.0.0";
pub const EUREKA_COMMIT: &str = "ef25a661a8be156d4908956e1055ca40cd67adb7";
const WRAPPED_PROOF_BYTES: usize = 288;
const SP1_GROTH16_PROOF_BYTES: usize = 356;
const MAX_HEADER_BYTES: usize = 1_048_576;
const MAX_MISBEHAVIOUR_BYTES: usize = 2_097_152;
const MAX_JSON_BYTES: usize = 3_145_728;
const MAX_WRAPPER_MANIFEST_BYTES: u64 = 64 * 1024;
const WRAPPER_SETUP_FILES: [&str; 3] = ["outer.pk", "outer.r1cs", "outer.vk"];
const WRAPPER_COMMITMENT_HASH_DOMAIN: &str = "cardano-ibc:gnark-bsb22:v1:";
const WRAPPER_CONSTRAINTS: u64 = 1_192_065;

sol! {
    struct TrustThreshold {
        uint8 numerator;
        uint8 denominator;
    }

    struct Height {
        uint64 revisionNumber;
        uint64 revisionHeight;
    }

    struct ClientState {
        string chainId;
        TrustThreshold trustLevel;
        Height latestHeight;
        uint32 trustingPeriod;
        uint32 unbondingPeriod;
        bool isFrozen;
        uint8 zkAlgorithm;
    }

    struct ConsensusState {
        uint128 timestamp;
        bytes32 root;
        bytes32 nextValidatorsHash;
    }

    struct UpdateClientOutput {
        ClientState clientState;
        ConsensusState trustedConsensusState;
        ConsensusState newConsensusState;
        uint128 time;
        Height trustedHeight;
        Height newHeight;
    }

    struct MisbehaviourOutput {
        ClientState clientState;
        uint128 time;
        Height trustedHeight1;
        Height trustedHeight2;
        ConsensusState trustedConsensusState1;
        ConsensusState trustedConsensusState2;
    }

    struct SP1Proof {
        bytes32 vKey;
        bytes publicValues;
        bytes proof;
    }

    struct MsgUpdateClient {
        SP1Proof sp1Proof;
    }
}

#[derive(Clone, Debug)]
pub struct Config {
    pub listen_addr: SocketAddr,
    pub elf_path: PathBuf,
    pub misbehaviour_elf_path: PathBuf,
    pub wrapper_bin: PathBuf,
    pub wrapper_key_dir: PathBuf,
    pub wrapper_public_vk: PathBuf,
}

impl Config {
    pub fn from_env() -> anyhow::Result<Self> {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let listen_addr = env::var("SP1_TENDERMINT_LISTEN_ADDR")
            .unwrap_or_else(|_| "127.0.0.1:8080".to_owned())
            .parse()
            .context("parse SP1_TENDERMINT_LISTEN_ADDR")?;
        let path =
            |name: &str, default: PathBuf| env::var_os(name).map(PathBuf::from).unwrap_or(default);
        let wrapper_key_dir = path("CARDANO_BLS_WRAPPER_KEY_DIR", root.join("keys-local"));
        let eureka_programs = root.join("../../third_party/ibc-eureka/sp1-programs-v2.0.0");
        Ok(Self {
            listen_addr,
            elf_path: path(
                "SP1_TENDERMINT_ELF",
                eureka_programs.join("sp1-ics07-tendermint-update-client"),
            ),
            misbehaviour_elf_path: path(
                "SP1_TENDERMINT_MISBEHAVIOUR_ELF",
                eureka_programs.join("sp1-ics07-tendermint-misbehaviour"),
            ),
            wrapper_bin: path(
                "CARDANO_BLS_WRAPPER_BIN",
                root.join("bn254-to-bls-wrapper/bn254-to-bls-wrapper"),
            ),
            wrapper_key_dir: wrapper_key_dir.clone(),
            wrapper_public_vk: path(
                "CARDANO_BLS_WRAPPER_PUBLIC_VK",
                wrapper_key_dir.join("verification_key.json"),
            ),
        })
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProveUpdateClientRequest {
    pub request_id: String,
    pub program: String,
    pub client_state: RequestClientState,
    pub trusted_consensus_state: RequestConsensusState,
    pub header: String,
    pub time: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProveMisbehaviourRequest {
    pub request_id: String,
    pub program: String,
    pub client_state: RequestClientState,
    pub misbehaviour: String,
    pub trusted_consensus_state_1: RequestConsensusState,
    pub trusted_consensus_state_2: RequestConsensusState,
    pub time: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RequestClientState {
    pub chain_id: String,
    pub trust_level: RequestTrustLevel,
    pub latest_height: RequestHeight,
    pub trusting_period: String,
    pub unbonding_period: String,
    pub is_frozen: bool,
    pub zk_algorithm: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RequestTrustLevel {
    pub numerator: String,
    pub denominator: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RequestHeight {
    pub revision_number: String,
    pub revision_height: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RequestConsensusState {
    pub timestamp: String,
    pub root: String,
    pub next_validators_hash: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProveUpdateClientResponse {
    pub request_id: String,
    pub program_vkey: String,
    pub public_values: String,
    pub wrapped_proof: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct HealthResponse {
    status: &'static str,
    program: &'static str,
    program_vkey: &'static str,
    eureka_elf_sha256: &'static str,
    misbehaviour_program: &'static str,
    misbehaviour_program_vkey: &'static str,
    misbehaviour_eureka_elf_sha256: &'static str,
    wrapper_vk_sha256: String,
}

#[derive(Debug, Serialize)]
struct ErrorBody {
    error: String,
}

#[derive(Debug)]
struct ProofWorkerBusy;

impl std::fmt::Display for ProofWorkerBusy {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("proof worker is busy")
    }
}

impl std::error::Error for ProofWorkerBusy {}

#[derive(Debug)]
struct RequestBindingMismatch;

impl std::fmt::Display for RequestBindingMismatch {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("requestId does not bind the Eureka output for these inputs")
    }
}

impl std::error::Error for RequestBindingMismatch {}

#[derive(Debug)]
pub struct ApiError {
    status: StatusCode,
    message: String,
}

impl ApiError {
    fn bad_request(error: impl std::fmt::Display) -> Self {
        Self {
            status: StatusCode::BAD_REQUEST,
            message: error.to_string(),
        }
    }

    fn conflict(error: impl std::fmt::Display) -> Self {
        Self {
            status: StatusCode::CONFLICT,
            message: error.to_string(),
        }
    }

    fn internal(error: impl std::fmt::Display) -> Self {
        tracing::error!(error = %error, "proof job failed");
        Self {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            message: "proof generation failed".to_owned(),
        }
    }

    fn busy() -> Self {
        Self {
            status: StatusCode::SERVICE_UNAVAILABLE,
            message: "the single proof worker is busy; retry later".to_owned(),
        }
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (
            self.status,
            Json(ErrorBody {
                error: self.message,
            }),
        )
            .into_response()
    }
}

#[derive(Clone)]
struct ValidatedInput {
    request_id: [u8; 32],
    request_id_hex: String,
    client_state: ClientState,
    trusted_consensus_state: ConsensusState,
    header_bytes: Vec<u8>,
    time: u128,
}

#[derive(Clone)]
struct ValidatedMisbehaviourInput {
    request_id: [u8; 32],
    request_id_hex: String,
    client_state: ClientState,
    misbehaviour_bytes: Vec<u8>,
    misbehaviour: ProtoMisbehaviour,
    trusted_consensus_state_1: ConsensusState,
    trusted_consensus_state_2: ConsensusState,
    time: u128,
}

fn parse_decimal<T>(name: &str, value: &str) -> anyhow::Result<T>
where
    T: std::str::FromStr,
    T::Err: std::fmt::Display,
{
    ensure!(
        !value.is_empty() && value.bytes().all(|byte| byte.is_ascii_digit()),
        "{name} must be an unsigned decimal string"
    );
    value
        .parse()
        .map_err(|error| anyhow::anyhow!("parse {name}: {error}"))
}

fn decode_hex32(name: &str, value: &str) -> anyhow::Result<FixedBytes<32>> {
    ensure!(
        value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit()),
        "{name} must be exactly 32 hexadecimal bytes without a prefix"
    );
    let raw = hex::decode(value).with_context(|| format!("decode {name}"))?;
    Ok(FixedBytes::from_slice(&raw))
}

fn file_sha256(path: &Path) -> anyhow::Result<String> {
    let mut file = fs::File::open(path)?;
    let mut digest = Sha256::new();
    let mut buffer = vec![0_u8; 1024 * 1024];
    loop {
        let read = file.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        digest.update(&buffer[..read]);
    }
    Ok(hex::encode(digest.finalize()))
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct WrapperSetupFileMetadata {
    bytes: u64,
    sha256: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct WrapperSetupManifest {
    curve: String,
    development_setup: bool,
    constraints: u64,
    files: BTreeMap<String, WrapperSetupFileMetadata>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct WrapperCommitmentKey {
    g: String,
    g_sigma_neg: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct WrapperPublicVerificationKey {
    alpha_g1: String,
    beta_g2: String,
    gamma_g2: String,
    delta_g2: String,
    ic: Vec<String>,
    n_public: usize,
    commitment_keys: Vec<WrapperCommitmentKey>,
    public_and_commitment_committed: Vec<Vec<usize>>,
    commitment_hash_domain: String,
}

fn exact_hex(value: &str, byte_length: usize, label: &str) -> anyhow::Result<()> {
    ensure!(
        value.len() == byte_length * 2 && value.bytes().all(|byte| byte.is_ascii_hexdigit()),
        "{label} must be exactly {byte_length} hexadecimal bytes"
    );
    Ok(())
}

fn validate_wrapper_public_vk(raw: &[u8]) -> anyhow::Result<()> {
    let key: WrapperPublicVerificationKey =
        serde_json::from_slice(raw).context("parse Cardano wrapper VK JSON")?;
    exact_hex(&key.alpha_g1, 48, "wrapper VK alpha_g1")?;
    exact_hex(&key.beta_g2, 96, "wrapper VK beta_g2")?;
    exact_hex(&key.gamma_g2, 96, "wrapper VK gamma_g2")?;
    exact_hex(&key.delta_g2, 96, "wrapper VK delta_g2")?;
    ensure!(key.ic.len() == 4, "wrapper VK must contain four IC points");
    for (index, point) in key.ic.iter().enumerate() {
        exact_hex(point, 48, &format!("wrapper VK ic[{index}]"))?;
    }
    ensure!(
        key.n_public == 2,
        "wrapper VK must expose exactly two public inputs"
    );
    ensure!(
        key.commitment_keys.len() == 1,
        "wrapper VK must contain exactly one commitment key"
    );
    exact_hex(&key.commitment_keys[0].g, 96, "wrapper VK commitment key g")?;
    exact_hex(
        &key.commitment_keys[0].g_sigma_neg,
        96,
        "wrapper VK commitment key g_sigma_neg",
    )?;
    ensure!(
        key.public_and_commitment_committed == [Vec::<usize>::new()],
        "wrapper VK public_and_commitment_committed must be [[]]"
    );
    ensure!(
        key.commitment_hash_domain == WRAPPER_COMMITMENT_HASH_DOMAIN,
        "wrapper VK uses an unsupported commitment hash domain"
    );
    Ok(())
}

fn verify_wrapper_setup(key_dir: &Path) -> anyhow::Result<WrapperSetupManifest> {
    let manifest_path = key_dir.join("manifest.json");
    let metadata = fs::metadata(&manifest_path).with_context(|| {
        format!(
            "read deployment-specific wrapper setup manifest {}",
            manifest_path.display()
        )
    })?;
    ensure!(
        metadata.is_file(),
        "wrapper setup manifest is not a file: {}",
        manifest_path.display()
    );
    ensure!(
        metadata.len() <= MAX_WRAPPER_MANIFEST_BYTES,
        "wrapper setup manifest exceeds {MAX_WRAPPER_MANIFEST_BYTES} bytes"
    );
    let raw = fs::read(&manifest_path)
        .with_context(|| format!("read wrapper setup manifest {}", manifest_path.display()))?;
    let manifest: WrapperSetupManifest =
        serde_json::from_slice(&raw).context("parse wrapper setup manifest")?;
    ensure!(
        manifest.curve == "bls12-381",
        "wrapper setup curve must be bls12-381"
    );
    ensure!(
        manifest.constraints == WRAPPER_CONSTRAINTS,
        "wrapper setup has {} constraints, expected {WRAPPER_CONSTRAINTS}",
        manifest.constraints
    );
    ensure!(
        manifest.files.len() == WRAPPER_SETUP_FILES.len()
            && WRAPPER_SETUP_FILES
                .iter()
                .all(|name| manifest.files.contains_key(*name)),
        "wrapper setup manifest must describe exactly outer.pk, outer.r1cs, and outer.vk"
    );

    for name in WRAPPER_SETUP_FILES {
        let expected = &manifest.files[name];
        ensure!(
            expected.bytes > 0,
            "wrapper setup file {name} must not be empty"
        );
        ensure!(
            expected.sha256.len() == 64
                && expected.sha256.bytes().all(|byte| byte.is_ascii_hexdigit())
                && expected.sha256 == expected.sha256.to_ascii_lowercase(),
            "wrapper setup file {name} has an invalid SHA-256"
        );
        let path = key_dir.join(name);
        let actual_metadata = fs::metadata(&path)
            .with_context(|| format!("read wrapper setup file metadata {}", path.display()))?;
        ensure!(
            actual_metadata.is_file(),
            "wrapper setup path is not a file: {}",
            path.display()
        );
        ensure!(
            actual_metadata.len() == expected.bytes,
            "wrapper setup file {name} has {} bytes, expected {}",
            actual_metadata.len(),
            expected.bytes
        );
        let actual = file_sha256(&path)
            .with_context(|| format!("hash wrapper setup file {}", path.display()))?;
        ensure!(
            actual == expected.sha256,
            "wrapper setup file {name} has SHA-256 {actual}, expected {}",
            expected.sha256
        );
    }

    Ok(manifest)
}

fn parse_height(name: &str, value: &RequestHeight) -> anyhow::Result<Height> {
    Ok(Height {
        revisionNumber: parse_decimal(&format!("{name}.revisionNumber"), &value.revision_number)?,
        revisionHeight: parse_decimal(&format!("{name}.revisionHeight"), &value.revision_height)?,
    })
}

fn parse_consensus_state(
    name: &str,
    value: &RequestConsensusState,
) -> anyhow::Result<ConsensusState> {
    let timestamp = parse_decimal(&format!("{name}.timestamp"), &value.timestamp)?;
    ensure!(timestamp > 0, "{name}.timestamp must be positive");
    Ok(ConsensusState {
        timestamp,
        root: decode_hex32(&format!("{name}.root"), &value.root)?,
        nextValidatorsHash: decode_hex32(
            &format!("{name}.nextValidatorsHash"),
            &value.next_validators_hash,
        )?,
    })
}

fn parse_request_id(value: &str) -> anyhow::Result<([u8; 32], String)> {
    ensure!(
        value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit()),
        "requestId must be exactly 32 hexadecimal bytes"
    );
    let request_id = hex::decode(value)?
        .try_into()
        .expect("validated request-id length");
    Ok((request_id, value.to_ascii_lowercase()))
}

fn parse_client_state(request: RequestClientState) -> anyhow::Result<ClientState> {
    let chain_id_bytes = request.chain_id.as_bytes();
    ensure!(
        !chain_id_bytes.is_empty(),
        "clientState.chainId must not be empty"
    );
    ensure!(
        chain_id_bytes.len() <= 50,
        "clientState.chainId must not exceed 50 UTF-8 bytes"
    );
    ensure!(
        !request.is_frozen,
        "the released Eureka programs require an unfrozen client"
    );
    ensure!(
        request.zk_algorithm == "groth16",
        "clientState.zkAlgorithm must be groth16"
    );
    let numerator: u8 = parse_decimal(
        "clientState.trustLevel.numerator",
        &request.trust_level.numerator,
    )?;
    let denominator: u8 = parse_decimal(
        "clientState.trustLevel.denominator",
        &request.trust_level.denominator,
    )?;
    ensure!(numerator > 0, "trust-level numerator must be positive");
    ensure!(denominator > 0, "trust-level denominator must be positive");
    ensure!(numerator <= denominator, "trust level must not exceed one");
    ensure!(
        u16::from(numerator) * 3 >= u16::from(denominator),
        "trust level must be at least one third"
    );
    let client_state = ClientState {
        chainId: request.chain_id,
        trustLevel: TrustThreshold {
            numerator,
            denominator,
        },
        latestHeight: parse_height("clientState.latestHeight", &request.latest_height)?,
        trustingPeriod: parse_decimal("clientState.trustingPeriod", &request.trusting_period)?,
        unbondingPeriod: parse_decimal("clientState.unbondingPeriod", &request.unbonding_period)?,
        isFrozen: false,
        zkAlgorithm: 0,
    };
    ensure!(
        client_state.latestHeight.revisionHeight > 0,
        "client latest revision height must be positive"
    );
    ensure!(
        client_state.trustingPeriod > 0,
        "trusting period must be positive"
    );
    ensure!(
        client_state.unbondingPeriod > 0,
        "unbonding period must be positive"
    );
    ensure!(
        client_state.trustingPeriod < client_state.unbondingPeriod,
        "trusting period must be shorter than unbonding period"
    );
    Ok(client_state)
}

fn parse_proof_time(value: &str) -> anyhow::Result<u128> {
    let time: u128 = parse_decimal("time", value)?;
    ensure!(time > 0, "time must be positive");
    ensure!(
        time.is_multiple_of(1_000_000),
        "time must align with Cardano millisecond validity bounds"
    );
    Ok(time)
}

impl TryFrom<ProveUpdateClientRequest> for ValidatedInput {
    type Error = anyhow::Error;

    fn try_from(request: ProveUpdateClientRequest) -> Result<Self, Self::Error> {
        ensure!(
            request.program == UPDATE_CLIENT_PROGRAM,
            "unsupported program"
        );
        let (request_id, request_id_hex) = parse_request_id(&request.request_id)?;
        let client_state = parse_client_state(request.client_state)?;

        let trusted_consensus_state =
            parse_consensus_state("trustedConsensusState", &request.trusted_consensus_state)?;
        let header_bytes = BASE64
            .decode(&request.header)
            .context("header must be canonical base64")?;
        ensure!(
            BASE64.encode(&header_bytes) == request.header,
            "header must be canonical base64"
        );
        ensure!(
            header_bytes.len() <= MAX_HEADER_BYTES,
            "header exceeds the 1 MiB service limit"
        );
        ProtoHeader::decode(header_bytes.as_slice())
            .context("decode Tendermint Header protobuf")?;
        let time = parse_proof_time(&request.time)?;

        Ok(Self {
            request_id,
            request_id_hex,
            client_state,
            trusted_consensus_state,
            header_bytes,
            time,
        })
    }
}

fn validate_misbehaviour_header(
    name: &str,
    header: &ProtoHeader,
    client_state: &ClientState,
) -> anyhow::Result<(Height, i64)> {
    let trusted_height = header
        .trusted_height
        .as_ref()
        .with_context(|| format!("{name}.trustedHeight is missing"))?;
    ensure!(
        trusted_height.revision_height > 0,
        "{name}.trustedHeight.revisionHeight must be positive"
    );
    ensure!(
        trusted_height.revision_number == client_state.latestHeight.revisionNumber,
        "{name}.trustedHeight revision differs from the client revision"
    );
    let signed_header = header
        .signed_header
        .as_ref()
        .with_context(|| format!("{name}.signedHeader is missing"))?;
    ensure!(
        signed_header.commit.is_some(),
        "{name}.signedHeader.commit is missing"
    );
    let tendermint_header = signed_header
        .header
        .as_ref()
        .with_context(|| format!("{name}.signedHeader.header is missing"))?;
    ensure!(
        tendermint_header.chain_id == client_state.chainId,
        "{name} chain ID differs from clientState.chainId"
    );
    ensure!(
        tendermint_header.height > 0,
        "{name} target height must be positive"
    );
    ensure!(
        header.validator_set.is_some(),
        "{name}.validatorSet is missing"
    );
    ensure!(
        header.trusted_validators.is_some(),
        "{name}.trustedValidators is missing"
    );
    Ok((
        Height {
            revisionNumber: trusted_height.revision_number,
            revisionHeight: trusted_height.revision_height,
        },
        tendermint_header.height,
    ))
}

impl TryFrom<ProveMisbehaviourRequest> for ValidatedMisbehaviourInput {
    type Error = anyhow::Error;

    fn try_from(request: ProveMisbehaviourRequest) -> Result<Self, Self::Error> {
        ensure!(
            request.program == MISBEHAVIOUR_PROGRAM,
            "unsupported program"
        );
        let (request_id, request_id_hex) = parse_request_id(&request.request_id)?;
        let client_state = parse_client_state(request.client_state)?;
        let misbehaviour_bytes = BASE64
            .decode(&request.misbehaviour)
            .context("misbehaviour must be canonical base64")?;
        ensure!(
            BASE64.encode(&misbehaviour_bytes) == request.misbehaviour,
            "misbehaviour must be canonical base64"
        );
        ensure!(
            misbehaviour_bytes.len() <= MAX_MISBEHAVIOUR_BYTES,
            "misbehaviour exceeds the 2 MiB service limit"
        );
        let misbehaviour = ProtoMisbehaviour::decode(misbehaviour_bytes.as_slice())
            .context("decode Tendermint Misbehaviour protobuf")?;
        let header_1 = misbehaviour
            .header_1
            .as_ref()
            .context("misbehaviour.header1 is missing")?;
        let header_2 = misbehaviour
            .header_2
            .as_ref()
            .context("misbehaviour.header2 is missing")?;
        let (trusted_height_1, target_height_1) =
            validate_misbehaviour_header("misbehaviour.header1", header_1, &client_state)?;
        let (trusted_height_2, target_height_2) =
            validate_misbehaviour_header("misbehaviour.header2", header_2, &client_state)?;
        ensure!(
            target_height_1 >= target_height_2,
            "misbehaviour.header1 height must be at least header2 height"
        );

        let trusted_consensus_state_1 =
            parse_consensus_state("trustedConsensusState1", &request.trusted_consensus_state_1)?;
        let trusted_consensus_state_2 =
            parse_consensus_state("trustedConsensusState2", &request.trusted_consensus_state_2)?;
        if trusted_height_1.abi_encode() == trusted_height_2.abi_encode() {
            ensure!(
                trusted_consensus_state_1.abi_encode() == trusted_consensus_state_2.abi_encode(),
                "one trusted height cannot have two different consensus states"
            );
        }

        Ok(Self {
            request_id,
            request_id_hex,
            client_state,
            misbehaviour_bytes,
            misbehaviour,
            trusted_consensus_state_1,
            trusted_consensus_state_2,
            time: parse_proof_time(&request.time)?,
        })
    }
}

fn stdin(input: &ValidatedInput) -> SP1Stdin {
    let mut stdin = SP1Stdin::new();
    stdin.write_vec(input.client_state.abi_encode());
    stdin.write_vec(input.trusted_consensus_state.abi_encode());
    stdin.write_vec(input.header_bytes.clone());
    stdin.write_vec(input.time.to_le_bytes().into());
    stdin
}

fn misbehaviour_stdin(input: &ValidatedMisbehaviourInput) -> SP1Stdin {
    let mut stdin = SP1Stdin::new();
    stdin.write_vec(input.client_state.abi_encode());
    stdin.write_vec(input.misbehaviour_bytes.clone());
    stdin.write_vec(input.trusted_consensus_state_1.abi_encode());
    stdin.write_vec(input.trusted_consensus_state_2.abi_encode());
    stdin.write_vec(input.time.to_le_bytes().into());
    stdin
}

fn proof_request_id(program_vkey_hex: &str, message: &[u8], public_values: &[u8]) -> [u8; 32] {
    let program_vkey = hex::decode(program_vkey_hex).expect("constant program vkey is valid hex");
    Sha256::new()
        .chain_update(program_vkey)
        .chain_update(message)
        .chain_update(public_values)
        .finalize()
        .into()
}

pub fn request_id(header: &[u8], public_values: &[u8]) -> [u8; 32] {
    proof_request_id(UPDATE_CLIENT_PROGRAM_VKEY_HEX, header, public_values)
}

pub fn misbehaviour_request_id(misbehaviour: &[u8], public_values: &[u8]) -> [u8; 32] {
    proof_request_id(MISBEHAVIOUR_PROGRAM_VKEY_HEX, misbehaviour, public_values)
}

fn validate_public_values(input: &ValidatedInput, public_values: &[u8]) -> anyhow::Result<()> {
    let output = UpdateClientOutput::abi_decode(public_values)
        .context("decode Eureka UpdateClientOutput")?;
    ensure!(
        output.abi_encode() == public_values,
        "Eureka output is not canonical Solidity ABI"
    );
    ensure!(
        output.clientState.abi_encode() == input.client_state.abi_encode(),
        "Eureka output changed the input client state"
    );
    ensure!(
        output.trustedConsensusState.abi_encode() == input.trusted_consensus_state.abi_encode(),
        "Eureka output changed the trusted consensus state"
    );
    ensure!(
        output.time == input.time,
        "Eureka output changed proof time"
    );
    let expected_len = 736 + input.client_state.chainId.len().div_ceil(32) * 32;
    ensure!(
        public_values.len() == expected_len,
        "unexpected Eureka output length {} for a {}-byte chain id",
        public_values.len(),
        input.client_state.chainId.len()
    );
    ensure!(
        output.trustedHeight.revisionNumber == input.client_state.latestHeight.revisionNumber,
        "trusted-height revision differs from the client revision"
    );
    ensure!(
        output.newHeight.revisionNumber == input.client_state.latestHeight.revisionNumber,
        "new-height revision differs from the client revision"
    );
    Ok(())
}

fn proto_trusted_height(header: &ProtoHeader) -> Height {
    let height = header
        .trusted_height
        .as_ref()
        .expect("validated misbehaviour header has a trusted height");
    Height {
        revisionNumber: height.revision_number,
        revisionHeight: height.revision_height,
    }
}

fn validate_misbehaviour_public_values(
    input: &ValidatedMisbehaviourInput,
    public_values: &[u8],
) -> anyhow::Result<()> {
    let output = MisbehaviourOutput::abi_decode(public_values)
        .context("decode Eureka MisbehaviourOutput")?;
    ensure!(
        output.abi_encode() == public_values,
        "Eureka misbehaviour output is not canonical Solidity ABI"
    );
    ensure!(
        output.clientState.abi_encode() == input.client_state.abi_encode(),
        "Eureka misbehaviour output changed the input client state"
    );
    ensure!(
        output.time == input.time,
        "Eureka misbehaviour output changed proof time"
    );
    ensure!(
        output.trustedConsensusState1.abi_encode() == input.trusted_consensus_state_1.abi_encode(),
        "Eureka misbehaviour output changed trusted consensus state 1"
    );
    ensure!(
        output.trustedConsensusState2.abi_encode() == input.trusted_consensus_state_2.abi_encode(),
        "Eureka misbehaviour output changed trusted consensus state 2"
    );
    let header_1 = input
        .misbehaviour
        .header_1
        .as_ref()
        .expect("validated misbehaviour has header 1");
    let header_2 = input
        .misbehaviour
        .header_2
        .as_ref()
        .expect("validated misbehaviour has header 2");
    ensure!(
        output.trustedHeight1.abi_encode() == proto_trusted_height(header_1).abi_encode(),
        "Eureka misbehaviour output changed trusted height 1"
    );
    ensure!(
        output.trustedHeight2.abi_encode() == proto_trusted_height(header_2).abi_encode(),
        "Eureka misbehaviour output changed trusted height 2"
    );
    let expected_len = 736 + input.client_state.chainId.len().div_ceil(32) * 32;
    ensure!(
        public_values.len() == expected_len,
        "unexpected Eureka misbehaviour output length {} for a {}-byte chain id",
        public_values.len(),
        input.client_state.chainId.len()
    );
    Ok(())
}

pub fn encode_wrapper_fixture(
    program_vkey: [u8; 32],
    public_values: Vec<u8>,
    proof: Vec<u8>,
) -> serde_json::Value {
    let message = MsgUpdateClient {
        sp1Proof: SP1Proof {
            vKey: program_vkey.into(),
            publicValues: Bytes::from(public_values),
            proof: Bytes::from(proof),
        },
    };
    serde_json::json!({
        "updateClientVkey": format!("0x{}", hex::encode(program_vkey)),
        "updateMsg": format!("0x{}", hex::encode(message.abi_encode())),
    })
}

#[async_trait]
trait ProofEngine: Send + Sync {
    async fn prove_update_client(
        &self,
        input: ValidatedInput,
    ) -> anyhow::Result<ProveUpdateClientResponse>;
    async fn prove_misbehaviour(
        &self,
        input: ValidatedMisbehaviourInput,
    ) -> anyhow::Result<ProveUpdateClientResponse>;
    fn wrapper_vk_sha256(&self) -> &str;
}

pub struct ProductionEngine {
    prover: CpuProver,
    update_client_proving_key: SP1ProvingKey,
    misbehaviour_proving_key: SP1ProvingKey,
    update_client_elf: Vec<u8>,
    misbehaviour_elf: Vec<u8>,
    wrapper_bin: PathBuf,
    wrapper_key_dir: PathBuf,
    wrapper_public_vk: Vec<u8>,
    wrapper_vk_sha256: String,
    jobs: Semaphore,
}

impl ProductionEngine {
    pub async fn initialize(config: &Config) -> anyhow::Result<Self> {
        let update_client_elf = fs::read(&config.elf_path)
            .with_context(|| format!("read Eureka ELF {}", config.elf_path.display()))?;
        let digest = hex::encode(Sha256::digest(&update_client_elf));
        ensure!(
            digest == UPDATE_CLIENT_ELF_SHA256,
            "unexpected Eureka update-client ELF SHA-256 {digest}"
        );
        let misbehaviour_elf = fs::read(&config.misbehaviour_elf_path).with_context(|| {
            format!(
                "read Eureka misbehaviour ELF {}",
                config.misbehaviour_elf_path.display()
            )
        })?;
        let digest = hex::encode(Sha256::digest(&misbehaviour_elf));
        ensure!(
            digest == MISBEHAVIOUR_ELF_SHA256,
            "unexpected Eureka misbehaviour ELF SHA-256 {digest}"
        );
        ensure!(
            config.wrapper_bin.is_file(),
            "wrapper binary is missing: {}",
            config.wrapper_bin.display()
        );
        let wrapper_setup = verify_wrapper_setup(&config.wrapper_key_dir)?;
        let canonical_key_dir = fs::canonicalize(&config.wrapper_key_dir).with_context(|| {
            format!(
                "resolve wrapper setup directory {}",
                config.wrapper_key_dir.display()
            )
        })?;
        let canonical_public_vk =
            fs::canonicalize(&config.wrapper_public_vk).with_context(|| {
                format!(
                    "resolve Cardano wrapper VK {}",
                    config.wrapper_public_vk.display()
                )
            })?;
        ensure!(
            canonical_public_vk.parent() == Some(canonical_key_dir.as_path()),
            "Cardano wrapper VK must be verification_key.json in the mounted wrapper setup directory"
        );
        ensure!(
            canonical_public_vk
                .file_name()
                .and_then(|name| name.to_str())
                == Some("verification_key.json"),
            "Cardano wrapper VK must be named verification_key.json"
        );
        let wrapper_public_vk = fs::read(&config.wrapper_public_vk).with_context(|| {
            format!(
                "read deployment-specific Cardano wrapper VK {}",
                config.wrapper_public_vk.display()
            )
        })?;
        validate_wrapper_public_vk(&wrapper_public_vk)?;
        let wrapper_vk_sha256 = hex::encode(Sha256::digest(&wrapper_public_vk));
        tracing::info!(
            wrapper_setup_constraints = wrapper_setup.constraints,
            wrapper_setup_development = wrapper_setup.development_setup,
            %wrapper_vk_sha256,
            "validated deployment-specific wrapper setup"
        );

        let prover = ProverClient::builder().cpu().build().await;
        let update_client_proving_key = prover
            .setup(Elf::from(update_client_elf.clone()))
            .await
            .context("set up released Eureka update-client ELF")?;
        let actual_vkey = update_client_proving_key
            .verifying_key()
            .bytes32()
            .trim_start_matches("0x")
            .to_ascii_lowercase();
        ensure!(
            actual_vkey == UPDATE_CLIENT_PROGRAM_VKEY_HEX,
            "released Eureka update-client ELF has unexpected program vkey {actual_vkey}"
        );
        let misbehaviour_proving_key = prover
            .setup(Elf::from(misbehaviour_elf.clone()))
            .await
            .context("set up released Eureka misbehaviour ELF")?;
        let actual_vkey = misbehaviour_proving_key
            .verifying_key()
            .bytes32()
            .trim_start_matches("0x")
            .to_ascii_lowercase();
        ensure!(
            actual_vkey == MISBEHAVIOUR_PROGRAM_VKEY_HEX,
            "released Eureka misbehaviour ELF has unexpected program vkey {actual_vkey}"
        );

        Ok(Self {
            prover,
            update_client_proving_key,
            misbehaviour_proving_key,
            update_client_elf,
            misbehaviour_elf,
            wrapper_bin: config.wrapper_bin.clone(),
            wrapper_key_dir: config.wrapper_key_dir.clone(),
            wrapper_public_vk,
            wrapper_vk_sha256,
            jobs: Semaphore::new(1),
        })
    }
}

fn run_wrapper(
    wrapper_bin: &Path,
    wrapper_key_dir: &Path,
    wrapper_public_vk: &[u8],
    program_vkey: [u8; 32],
    public_values: Vec<u8>,
    proof: Vec<u8>,
) -> anyhow::Result<Vec<u8>> {
    ensure!(
        proof.len() == SP1_GROTH16_PROOF_BYTES,
        "SP1 Groth16 proof is {} bytes, expected {SP1_GROTH16_PROOF_BYTES}",
        proof.len()
    );
    let temp = TempDir::new().context("create wrapper request directory")?;
    let fixture_path = temp.path().join("update_client_fixture.json");
    let output_dir = temp.path().join("cardano");
    fs::write(
        &fixture_path,
        serde_json::to_vec(&encode_wrapper_fixture(
            program_vkey,
            public_values.clone(),
            proof,
        ))?,
    )?;

    let output = Command::new(wrapper_bin)
        .arg("-fixture")
        .arg(&fixture_path)
        .arg("-prove")
        .arg("-key-dir")
        .arg(wrapper_key_dir)
        .arg("-out")
        .arg(&output_dir)
        .output()
        .with_context(|| format!("run wrapper {}", wrapper_bin.display()))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        bail!("wrapper exited {}: {}", output.status, stderr.trim());
    }

    let wrapped_proof = fs::read(output_dir.join("proof.bin"))?;
    ensure!(
        wrapped_proof.len() == WRAPPED_PROOF_BYTES,
        "wrapper emitted a {}-byte proof",
        wrapped_proof.len()
    );
    ensure!(
        fs::read(output_dir.join("public_values.bin"))? == public_values,
        "wrapper changed Eureka public values"
    );
    ensure!(
        fs::read(output_dir.join("verification_key.json"))? == wrapper_public_vk,
        "wrapper used a different outer verification key than the deployment artifact"
    );
    Ok(wrapped_proof)
}

#[async_trait]
impl ProofEngine for ProductionEngine {
    async fn prove_update_client(
        &self,
        input: ValidatedInput,
    ) -> anyhow::Result<ProveUpdateClientResponse> {
        let _permit = self.jobs.try_acquire().map_err(|_| ProofWorkerBusy)?;
        tracing::info!(request_id = %input.request_id_hex, "executing Eureka guest");
        let (executed_public_values, _) = self
            .prover
            .execute(Elf::from(self.update_client_elf.clone()), stdin(&input))
            .await
            .context("execute released Eureka update-client program")?;
        let public_values = executed_public_values.as_slice().to_vec();
        validate_public_values(&input, &public_values)?;
        let derived_request_id = request_id(&input.header_bytes, &public_values);
        if derived_request_id != input.request_id {
            return Err(RequestBindingMismatch.into());
        }

        tracing::info!(request_id = %input.request_id_hex, "generating SP1 Groth16 proof");
        let started = Instant::now();
        let proof = self
            .prover
            .prove(&self.update_client_proving_key, stdin(&input))
            .mode(SP1ProofMode::Groth16)
            .await
            .context("generate SP1 Groth16 proof")?;
        ensure!(
            proof.public_values.as_slice() == public_values,
            "SP1 proof output differs from preflight execution"
        );
        self.prover
            .verify(&proof, self.update_client_proving_key.verifying_key(), None)
            .context("verify generated SP1 proof")?;
        tracing::info!(
            request_id = %input.request_id_hex,
            seconds = started.elapsed().as_secs_f64(),
            "SP1 proof verified"
        );

        let proof_bytes = proof.bytes();
        let wrapper = self.wrapper_bin.clone();
        let key_dir = self.wrapper_key_dir.clone();
        let public_vk = self.wrapper_public_vk.clone();
        let public_values_for_wrapper = public_values.clone();
        let program_vkey = hex::decode(UPDATE_CLIENT_PROGRAM_VKEY_HEX)?
            .try_into()
            .expect("constant update-client program-vkey length");
        let wrapped_proof = tokio::task::spawn_blocking(move || {
            run_wrapper(
                &wrapper,
                &key_dir,
                &public_vk,
                program_vkey,
                public_values_for_wrapper,
                proof_bytes,
            )
        })
        .await
        .context("join BLS wrapper task")??;

        Ok(ProveUpdateClientResponse {
            request_id: input.request_id_hex,
            program_vkey: UPDATE_CLIENT_PROGRAM_VKEY_HEX.to_owned(),
            public_values: hex::encode(public_values),
            wrapped_proof: hex::encode(wrapped_proof),
        })
    }

    async fn prove_misbehaviour(
        &self,
        input: ValidatedMisbehaviourInput,
    ) -> anyhow::Result<ProveUpdateClientResponse> {
        let _permit = self.jobs.try_acquire().map_err(|_| ProofWorkerBusy)?;
        tracing::info!(request_id = %input.request_id_hex, "executing Eureka misbehaviour guest");
        let (executed_public_values, _) = self
            .prover
            .execute(
                Elf::from(self.misbehaviour_elf.clone()),
                misbehaviour_stdin(&input),
            )
            .await
            .context("execute released Eureka misbehaviour program")?;
        let public_values = executed_public_values.as_slice().to_vec();
        validate_misbehaviour_public_values(&input, &public_values)?;
        let derived_request_id = misbehaviour_request_id(&input.misbehaviour_bytes, &public_values);
        if derived_request_id != input.request_id {
            return Err(RequestBindingMismatch.into());
        }

        tracing::info!(request_id = %input.request_id_hex, "generating SP1 misbehaviour Groth16 proof");
        let started = Instant::now();
        let proof = self
            .prover
            .prove(&self.misbehaviour_proving_key, misbehaviour_stdin(&input))
            .mode(SP1ProofMode::Groth16)
            .await
            .context("generate SP1 misbehaviour Groth16 proof")?;
        ensure!(
            proof.public_values.as_slice() == public_values,
            "SP1 misbehaviour proof output differs from preflight execution"
        );
        self.prover
            .verify(&proof, self.misbehaviour_proving_key.verifying_key(), None)
            .context("verify generated SP1 misbehaviour proof")?;
        tracing::info!(
            request_id = %input.request_id_hex,
            seconds = started.elapsed().as_secs_f64(),
            "SP1 misbehaviour proof verified"
        );

        let proof_bytes = proof.bytes();
        let wrapper = self.wrapper_bin.clone();
        let key_dir = self.wrapper_key_dir.clone();
        let public_vk = self.wrapper_public_vk.clone();
        let public_values_for_wrapper = public_values.clone();
        let program_vkey = hex::decode(MISBEHAVIOUR_PROGRAM_VKEY_HEX)?
            .try_into()
            .expect("constant misbehaviour program-vkey length");
        let wrapped_proof = tokio::task::spawn_blocking(move || {
            run_wrapper(
                &wrapper,
                &key_dir,
                &public_vk,
                program_vkey,
                public_values_for_wrapper,
                proof_bytes,
            )
        })
        .await
        .context("join BLS misbehaviour wrapper task")??;

        Ok(ProveUpdateClientResponse {
            request_id: input.request_id_hex,
            program_vkey: MISBEHAVIOUR_PROGRAM_VKEY_HEX.to_owned(),
            public_values: hex::encode(public_values),
            wrapped_proof: hex::encode(wrapped_proof),
        })
    }

    fn wrapper_vk_sha256(&self) -> &str {
        &self.wrapper_vk_sha256
    }
}

#[derive(Clone)]
struct AppState {
    engine: Arc<dyn ProofEngine>,
}

fn router(engine: Arc<dyn ProofEngine>) -> Router {
    Router::new()
        .route("/healthz", get(health))
        .route(
            "/v1/tendermint/update-client/proof",
            post(prove_update_client),
        )
        .route(
            "/v1/tendermint/misbehaviour/proof",
            post(prove_misbehaviour),
        )
        .layer(DefaultBodyLimit::max(MAX_JSON_BYTES))
        .with_state(AppState { engine })
}

async fn health(State(state): State<AppState>) -> Json<HealthResponse> {
    Json(HealthResponse {
        status: "ready",
        program: UPDATE_CLIENT_PROGRAM,
        program_vkey: UPDATE_CLIENT_PROGRAM_VKEY_HEX,
        eureka_elf_sha256: UPDATE_CLIENT_ELF_SHA256,
        misbehaviour_program: MISBEHAVIOUR_PROGRAM,
        misbehaviour_program_vkey: MISBEHAVIOUR_PROGRAM_VKEY_HEX,
        misbehaviour_eureka_elf_sha256: MISBEHAVIOUR_ELF_SHA256,
        wrapper_vk_sha256: state.engine.wrapper_vk_sha256().to_owned(),
    })
}

fn map_proof_error(error: anyhow::Error) -> ApiError {
    if error.downcast_ref::<RequestBindingMismatch>().is_some() {
        ApiError::conflict(error)
    } else if error.downcast_ref::<ProofWorkerBusy>().is_some() {
        ApiError::busy()
    } else {
        ApiError::internal(error)
    }
}

async fn prove_update_client(
    State(state): State<AppState>,
    Json(request): Json<ProveUpdateClientRequest>,
) -> Result<Json<ProveUpdateClientResponse>, ApiError> {
    let input = ValidatedInput::try_from(request).map_err(ApiError::bad_request)?;
    state
        .engine
        .prove_update_client(input)
        .await
        .map(Json)
        .map_err(map_proof_error)
}

async fn prove_misbehaviour(
    State(state): State<AppState>,
    Json(request): Json<ProveMisbehaviourRequest>,
) -> Result<Json<ProveUpdateClientResponse>, ApiError> {
    let input = ValidatedMisbehaviourInput::try_from(request).map_err(ApiError::bad_request)?;
    state
        .engine
        .prove_misbehaviour(input)
        .await
        .map(Json)
        .map_err(map_proof_error)
}

pub async fn serve(config: Config) -> anyhow::Result<()> {
    let listen_addr = config.listen_addr;
    let engine = Arc::new(ProductionEngine::initialize(&config).await?);
    let listener = tokio::net::TcpListener::bind(listen_addr)
        .await
        .with_context(|| format!("bind {listen_addr}"))?;
    tracing::info!(%listen_addr, "SP1 Tendermint prover ready");
    axum::serve(listener, router(engine))
        .with_graceful_shutdown(shutdown_signal())
        .await
        .context("serve prover API")
}

async fn shutdown_signal() {
    let _ = tokio::signal::ctrl_c().await;
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{body::Body, http::Request};
    use ibc_proto::ibc::core::client::v1::Height as ProtoHeight;
    use tendermint_proto::types::{
        Commit as ProtoCommit, Header as TendermintHeader, SignedHeader, ValidatorSet,
    };
    use tower::ServiceExt;

    const TRACKED_REGRESSION_WRAPPER_VK_SHA256: &str =
        "e9c2403db628a090f4a598589812f36bb82aaf09c4646b14a6c12c5b5e99a037";

    #[test]
    fn vendored_eureka_programs_match_pinned_hashes() {
        let programs = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../third_party/ibc-eureka")
            .join(EUREKA_TAG);
        for (name, expected) in [
            (
                "sp1-ics07-tendermint-update-client",
                UPDATE_CLIENT_ELF_SHA256,
            ),
            ("sp1-ics07-tendermint-misbehaviour", MISBEHAVIOUR_ELF_SHA256),
        ] {
            assert_eq!(file_sha256(&programs.join(name)).unwrap(), expected);
        }
    }

    fn request_client_state() -> RequestClientState {
        RequestClientState {
            chain_id: "injective-1".to_owned(),
            trust_level: RequestTrustLevel {
                numerator: "1".to_owned(),
                denominator: "3".to_owned(),
            },
            latest_height: RequestHeight {
                revision_number: "1".to_owned(),
                revision_height: "180315956".to_owned(),
            },
            trusting_period: "1209600".to_owned(),
            unbonding_period: "1814400".to_owned(),
            is_frozen: false,
            zk_algorithm: "groth16".to_owned(),
        }
    }

    fn request_consensus_state() -> RequestConsensusState {
        RequestConsensusState {
            timestamp: "1787752047398349000".to_owned(),
            root: "11".repeat(32),
            next_validators_hash: "22".repeat(32),
        }
    }

    fn request() -> ProveUpdateClientRequest {
        ProveUpdateClientRequest {
            request_id: "11".repeat(32),
            program: UPDATE_CLIENT_PROGRAM.to_owned(),
            client_state: request_client_state(),
            trusted_consensus_state: request_consensus_state(),
            header: BASE64.encode([]),
            time: "1787752048403000000".to_owned(),
        }
    }

    fn proto_header(chain_id: &str, target_height: i64, trusted_height: u64) -> ProtoHeader {
        ProtoHeader {
            signed_header: Some(SignedHeader {
                header: Some(TendermintHeader {
                    chain_id: chain_id.to_owned(),
                    height: target_height,
                    ..Default::default()
                }),
                commit: Some(ProtoCommit::default()),
            }),
            validator_set: Some(ValidatorSet::default()),
            trusted_height: Some(ProtoHeight {
                revision_number: 1,
                revision_height: trusted_height,
            }),
            trusted_validators: Some(ValidatorSet::default()),
        }
    }

    fn raw_misbehaviour() -> ProtoMisbehaviour {
        ProtoMisbehaviour {
            header_1: Some(proto_header("injective-1", 180_315_958, 180_315_956)),
            header_2: Some(proto_header("injective-1", 180_315_957, 180_315_956)),
            ..Default::default()
        }
    }

    fn misbehaviour_request() -> ProveMisbehaviourRequest {
        ProveMisbehaviourRequest {
            request_id: "11".repeat(32),
            program: MISBEHAVIOUR_PROGRAM.to_owned(),
            client_state: request_client_state(),
            misbehaviour: BASE64.encode(raw_misbehaviour().encode_to_vec()),
            trusted_consensus_state_1: request_consensus_state(),
            trusted_consensus_state_2: request_consensus_state(),
            time: "1787752048403000000".to_owned(),
        }
    }

    fn sample_public_values(input: &ValidatedInput) -> Vec<u8> {
        UpdateClientOutput {
            clientState: input.client_state.clone(),
            trustedConsensusState: input.trusted_consensus_state.clone(),
            newConsensusState: ConsensusState {
                timestamp: input.trusted_consensus_state.timestamp + 1,
                root: [0x33; 32].into(),
                nextValidatorsHash: [0x44; 32].into(),
            },
            time: input.time,
            trustedHeight: input.client_state.latestHeight.clone(),
            newHeight: Height {
                revisionNumber: input.client_state.latestHeight.revisionNumber,
                revisionHeight: input.client_state.latestHeight.revisionHeight + 1,
            },
        }
        .abi_encode()
    }

    fn sample_misbehaviour_public_values(input: &ValidatedMisbehaviourInput) -> Vec<u8> {
        let header_1 = input.misbehaviour.header_1.as_ref().unwrap();
        let header_2 = input.misbehaviour.header_2.as_ref().unwrap();
        MisbehaviourOutput {
            clientState: input.client_state.clone(),
            time: input.time,
            trustedHeight1: proto_trusted_height(header_1),
            trustedHeight2: proto_trusted_height(header_2),
            trustedConsensusState1: input.trusted_consensus_state_1.clone(),
            trustedConsensusState2: input.trusted_consensus_state_2.clone(),
        }
        .abi_encode()
    }

    #[test]
    fn parses_the_gateway_contract_and_rejects_each_bound() {
        let valid = request();
        ValidatedInput::try_from(valid.clone()).unwrap();

        let mut invalid = valid.clone();
        invalid.program = "other".to_owned();
        assert!(ValidatedInput::try_from(invalid).is_err());

        let mut invalid = valid.clone();
        invalid.client_state.chain_id = "x".repeat(51);
        assert!(ValidatedInput::try_from(invalid).is_err());

        let mut invalid = valid.clone();
        invalid.client_state.trust_level.numerator = "0".to_owned();
        assert!(ValidatedInput::try_from(invalid).is_err());

        let mut invalid = valid.clone();
        invalid.client_state.is_frozen = true;
        assert!(ValidatedInput::try_from(invalid).is_err());

        let mut invalid = valid.clone();
        invalid.client_state.trusting_period = "1814400".to_owned();
        assert!(ValidatedInput::try_from(invalid).is_err());

        let mut invalid = valid;
        invalid.time = "1787752048403000001".to_owned();
        assert!(ValidatedInput::try_from(invalid).is_err());
    }

    #[test]
    fn validates_exact_eureka_output_and_gateway_request_id() {
        let mut input = ValidatedInput::try_from(request()).unwrap();
        let public_values = sample_public_values(&input);
        assert_eq!(public_values.len(), 768);
        validate_public_values(&input, &public_values).unwrap();
        input.request_id = request_id(&input.header_bytes, &public_values);
        input.request_id_hex = hex::encode(input.request_id);
        assert_eq!(
            request_id(&input.header_bytes, &public_values),
            input.request_id
        );

        let mut changed = public_values.clone();
        changed[159] ^= 1;
        assert!(validate_public_values(&input, &changed).is_err());
    }

    #[test]
    fn supports_the_fifty_byte_chain_id_output_shape() {
        let mut request = request();
        request.client_state.chain_id = "x".repeat(50);
        let input = ValidatedInput::try_from(request).unwrap();
        let public_values = sample_public_values(&input);
        assert_eq!(public_values.len(), 800);
        validate_public_values(&input, &public_values).unwrap();
    }

    #[test]
    fn validates_the_two_header_request_contract() {
        let valid = misbehaviour_request();
        ValidatedMisbehaviourInput::try_from(valid.clone()).unwrap();

        let mut invalid = valid.clone();
        invalid.program = UPDATE_CLIENT_PROGRAM.to_owned();
        assert!(ValidatedMisbehaviourInput::try_from(invalid).is_err());

        let mut evidence = raw_misbehaviour();
        evidence.header_2 = None;
        let mut invalid = valid.clone();
        invalid.misbehaviour = BASE64.encode(evidence.encode_to_vec());
        assert!(ValidatedMisbehaviourInput::try_from(invalid).is_err());

        let mut evidence = raw_misbehaviour();
        evidence
            .header_1
            .as_mut()
            .unwrap()
            .signed_header
            .as_mut()
            .unwrap()
            .header
            .as_mut()
            .unwrap()
            .chain_id = "other-1".to_owned();
        let mut invalid = valid.clone();
        invalid.misbehaviour = BASE64.encode(evidence.encode_to_vec());
        assert!(ValidatedMisbehaviourInput::try_from(invalid).is_err());

        let mut evidence = raw_misbehaviour();
        evidence
            .header_1
            .as_mut()
            .unwrap()
            .signed_header
            .as_mut()
            .unwrap()
            .header
            .as_mut()
            .unwrap()
            .height = 180_315_950;
        let mut invalid = valid.clone();
        invalid.misbehaviour = BASE64.encode(evidence.encode_to_vec());
        assert!(ValidatedMisbehaviourInput::try_from(invalid).is_err());

        let mut invalid = valid.clone();
        invalid.trusted_consensus_state_2.root = "33".repeat(32);
        assert!(ValidatedMisbehaviourInput::try_from(invalid).is_err());

        let mut invalid = valid;
        invalid.time = "1787752048403000001".to_owned();
        assert!(ValidatedMisbehaviourInput::try_from(invalid).is_err());
    }

    #[test]
    fn validates_every_bound_misbehaviour_output_field_and_request_id() {
        let mut input = ValidatedMisbehaviourInput::try_from(misbehaviour_request()).unwrap();
        let public_values = sample_misbehaviour_public_values(&input);
        assert_eq!(public_values.len(), 768);
        validate_misbehaviour_public_values(&input, &public_values).unwrap();
        input.request_id = misbehaviour_request_id(&input.misbehaviour_bytes, &public_values);
        input.request_id_hex = hex::encode(input.request_id);
        assert_eq!(
            misbehaviour_request_id(&input.misbehaviour_bytes, &public_values),
            input.request_id
        );

        let output = MisbehaviourOutput::abi_decode(&public_values).unwrap();
        let mut changed = output.clone();
        changed.clientState.latestHeight.revisionHeight += 1;
        assert!(validate_misbehaviour_public_values(&input, &changed.abi_encode()).is_err());
        let mut changed = output.clone();
        changed.time += 1;
        assert!(validate_misbehaviour_public_values(&input, &changed.abi_encode()).is_err());
        let mut changed = output.clone();
        changed.trustedHeight1.revisionHeight += 1;
        assert!(validate_misbehaviour_public_values(&input, &changed.abi_encode()).is_err());
        let mut changed = output.clone();
        changed.trustedHeight2.revisionHeight += 1;
        assert!(validate_misbehaviour_public_values(&input, &changed.abi_encode()).is_err());
        let mut changed = output.clone();
        changed.trustedConsensusState1.root = [0x55; 32].into();
        assert!(validate_misbehaviour_public_values(&input, &changed.abi_encode()).is_err());
        let mut changed = output;
        changed.trustedConsensusState2.nextValidatorsHash = [0x66; 32].into();
        assert!(validate_misbehaviour_public_values(&input, &changed.abi_encode()).is_err());
    }

    fn write_test_wrapper_setup(key_dir: &Path) {
        fs::create_dir_all(key_dir).unwrap();
        let mut files = serde_json::Map::new();
        for (name, contents) in [
            ("outer.pk", b"deployment-specific-pk".as_slice()),
            ("outer.r1cs", b"deployment-specific-r1cs".as_slice()),
            ("outer.vk", b"deployment-specific-vk".as_slice()),
        ] {
            fs::write(key_dir.join(name), contents).unwrap();
            files.insert(
                name.to_owned(),
                serde_json::json!({
                    "bytes": contents.len(),
                    "sha256": hex::encode(Sha256::digest(contents)),
                }),
            );
        }
        fs::write(
            key_dir.join("manifest.json"),
            serde_json::to_vec(&serde_json::json!({
                "curve": "bls12-381",
                "development_setup": true,
                "constraints": WRAPPER_CONSTRAINTS,
                "files": files,
            }))
            .unwrap(),
        )
        .unwrap();
    }

    #[test]
    fn validates_deployment_specific_wrapper_setup_against_its_manifest() {
        let temp = TempDir::new().unwrap();
        write_test_wrapper_setup(temp.path());

        let manifest = verify_wrapper_setup(temp.path()).unwrap();

        assert_eq!(manifest.constraints, WRAPPER_CONSTRAINTS);
        assert!(manifest.development_setup);
    }

    #[test]
    fn rejects_wrapper_setup_file_that_differs_from_its_manifest() {
        let temp = TempDir::new().unwrap();
        write_test_wrapper_setup(temp.path());
        fs::write(temp.path().join("outer.vk"), b"changed-deployment-vk").unwrap();

        let error = verify_wrapper_setup(temp.path()).unwrap_err();

        assert!(error.to_string().contains("outer.vk"));
    }

    #[test]
    fn rejects_wrapper_setup_for_a_different_circuit_shape() {
        let temp = TempDir::new().unwrap();
        write_test_wrapper_setup(temp.path());
        let manifest_path = temp.path().join("manifest.json");
        let mut manifest: serde_json::Value =
            serde_json::from_slice(&fs::read(&manifest_path).unwrap()).unwrap();
        manifest["constraints"] = serde_json::json!(WRAPPER_CONSTRAINTS - 1);
        fs::write(&manifest_path, serde_json::to_vec(&manifest).unwrap()).unwrap();

        let error = verify_wrapper_setup(temp.path()).unwrap_err();

        assert!(error
            .to_string()
            .contains(&format!("expected {WRAPPER_CONSTRAINTS}")));
    }

    #[test]
    fn accepts_a_structurally_valid_deployment_specific_public_vk() {
        let hex = |byte: &str, bytes: usize| byte.repeat(bytes);
        let raw = serde_json::to_vec(&serde_json::json!({
            "alpha_g1": hex("11", 48),
            "beta_g2": hex("22", 96),
            "gamma_g2": hex("33", 96),
            "delta_g2": hex("44", 96),
            "ic": [
                hex("51", 48),
                hex("52", 48),
                hex("53", 48),
                hex("54", 48),
            ],
            "n_public": 2,
            "commitment_keys": [{
                "g": hex("61", 96),
                "g_sigma_neg": hex("62", 96),
            }],
            "public_and_commitment_committed": [[]],
            "commitment_hash_domain": WRAPPER_COMMITMENT_HASH_DOMAIN,
        }))
        .unwrap();

        validate_wrapper_public_vk(&raw).unwrap();
    }

    #[test]
    fn wrapper_fixture_round_trips_the_exact_nested_solidity_abi() {
        let public_values = vec![0x11; 768];
        let proof = vec![0x22; SP1_GROTH16_PROOF_BYTES];
        for expected_vkey in [
            UPDATE_CLIENT_PROGRAM_VKEY_HEX,
            MISBEHAVIOUR_PROGRAM_VKEY_HEX,
        ] {
            let vkey: [u8; 32] = hex::decode(expected_vkey).unwrap().try_into().unwrap();
            let fixture = encode_wrapper_fixture(vkey, public_values.clone(), proof.clone());
            let encoded = hex::decode(
                fixture["updateMsg"]
                    .as_str()
                    .unwrap()
                    .trim_start_matches("0x"),
            )
            .unwrap();
            let decoded = MsgUpdateClient::abi_decode(&encoded).unwrap();
            assert_eq!(decoded.sp1Proof.vKey.as_slice(), &vkey);
            assert_eq!(decoded.sp1Proof.publicValues.as_ref(), &public_values);
            assert_eq!(decoded.sp1Proof.proof.as_ref(), &proof);
            assert_eq!(encoded.len(), 1_376);
        }
    }

    #[test]
    fn tracked_stable_regression_artifacts_match_the_pinned_deployment_key() {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("artifacts");
        let proof = fs::read(root.join("injective-45/wrapped_proof.bin")).unwrap();
        let public_values = fs::read(root.join("injective-45/public_values.bin")).unwrap();
        let public_vk = fs::read(root.join("wrapper_verification_key.json")).unwrap();
        assert_eq!(proof.len(), WRAPPED_PROOF_BYTES);
        assert_eq!(public_values.len(), 768);
        assert_eq!(
            hex::encode(Sha256::digest(&proof)),
            "ec5fe188500102c2e974c842257178305365ecf09809effca4a83b1e2629a464"
        );
        assert_eq!(
            hex::encode(Sha256::digest(&public_values)),
            "4a7114908b8dab0e72c5fd1441afc49c2b9266e04efabf7639d1f53643ae2462"
        );
        assert_eq!(
            hex::encode(Sha256::digest(&public_vk)),
            TRACKED_REGRESSION_WRAPPER_VK_SHA256
        );

        let output = UpdateClientOutput::abi_decode(&public_values).unwrap();
        assert_eq!(output.clientState.chainId, "injective-1");
        assert_eq!(output.time, 1_787_752_048_403_000_000);
        assert!(output.time.is_multiple_of(1_000_000));
        assert_eq!(output.trustedHeight.revisionHeight, 180_315_956);
        assert_eq!(output.newHeight.revisionHeight, 180_315_957);

        let proof = fs::read(root.join("misbehaviour-double-sign-2/wrapped_proof.bin")).unwrap();
        let public_values =
            fs::read(root.join("misbehaviour-double-sign-2/public_values.bin")).unwrap();
        let metadata: serde_json::Value = serde_json::from_slice(
            &fs::read(root.join("misbehaviour-double-sign-2/metadata.json")).unwrap(),
        )
        .unwrap();
        assert_eq!(proof.len(), WRAPPED_PROOF_BYTES);
        assert_eq!(public_values.len(), 768);
        assert_eq!(
            hex::encode(Sha256::digest(&proof)),
            "67070bc3eef265a14c887209a21ae84575ca219fd399050bcbb739381c2988c6"
        );
        assert_eq!(
            hex::encode(Sha256::digest(&public_values)),
            "1d7e7545afa75466ce623cd1b66250d4cb7d9ba642fc16d441676d7c888c541a"
        );
        assert_eq!(metadata["programVkey"], MISBEHAVIOUR_PROGRAM_VKEY_HEX);
        assert_eq!(
            metadata["wrapperPublicVkey"]["sha256"],
            TRACKED_REGRESSION_WRAPPER_VK_SHA256
        );

        let output = MisbehaviourOutput::abi_decode(&public_values).unwrap();
        assert_eq!(output.clientState.chainId, "test-chain-0");
        assert_eq!(output.time, 1_000_003_600_000_000_000);
        assert_eq!(output.trustedHeight1.revisionHeight, 1);
        assert_eq!(output.trustedHeight2.revisionHeight, 1);
        assert_eq!(
            output.trustedConsensusState1.abi_encode(),
            output.trustedConsensusState2.abi_encode()
        );
    }

    struct MockEngine;

    #[async_trait]
    impl ProofEngine for MockEngine {
        async fn prove_update_client(
            &self,
            input: ValidatedInput,
        ) -> anyhow::Result<ProveUpdateClientResponse> {
            Ok(ProveUpdateClientResponse {
                request_id: input.request_id_hex,
                program_vkey: UPDATE_CLIENT_PROGRAM_VKEY_HEX.to_owned(),
                public_values: "33".repeat(768),
                wrapped_proof: "44".repeat(WRAPPED_PROOF_BYTES),
            })
        }

        async fn prove_misbehaviour(
            &self,
            input: ValidatedMisbehaviourInput,
        ) -> anyhow::Result<ProveUpdateClientResponse> {
            Ok(ProveUpdateClientResponse {
                request_id: input.request_id_hex,
                program_vkey: MISBEHAVIOUR_PROGRAM_VKEY_HEX.to_owned(),
                public_values: "33".repeat(768),
                wrapped_proof: "44".repeat(WRAPPED_PROOF_BYTES),
            })
        }

        fn wrapper_vk_sha256(&self) -> &str {
            "55"
        }
    }

    #[tokio::test]
    async fn exposes_the_gateway_endpoint() {
        let response = router(Arc::new(MockEngine))
            .oneshot(
                Request::post("/v1/tendermint/update-client/proof")
                    .header("content-type", "application/json")
                    .body(Body::from(serde_json::to_vec(&request()).unwrap()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);

        let response = router(Arc::new(MockEngine))
            .oneshot(
                Request::post("/v1/tendermint/misbehaviour/proof")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        serde_json::to_vec(&misbehaviour_request()).unwrap(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn rejects_malformed_gateway_requests_without_proving() {
        let mut invalid = request();
        invalid.header = "not-base64".to_owned();
        let response = router(Arc::new(MockEngine))
            .oneshot(
                Request::post("/v1/tendermint/update-client/proof")
                    .header("content-type", "application/json")
                    .body(Body::from(serde_json::to_vec(&invalid).unwrap()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    }

    struct BusyEngine;

    #[async_trait]
    impl ProofEngine for BusyEngine {
        async fn prove_update_client(
            &self,
            _input: ValidatedInput,
        ) -> anyhow::Result<ProveUpdateClientResponse> {
            Err(ProofWorkerBusy.into())
        }

        async fn prove_misbehaviour(
            &self,
            _input: ValidatedMisbehaviourInput,
        ) -> anyhow::Result<ProveUpdateClientResponse> {
            Err(ProofWorkerBusy.into())
        }

        fn wrapper_vk_sha256(&self) -> &str {
            "55"
        }
    }

    #[tokio::test]
    async fn rejects_a_concurrent_job_instead_of_queueing_it() {
        let response = router(Arc::new(BusyEngine))
            .oneshot(
                Request::post("/v1/tendermint/update-client/proof")
                    .header("content-type", "application/json")
                    .body(Body::from(serde_json::to_vec(&request()).unwrap()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);

        let response = router(Arc::new(BusyEngine))
            .oneshot(
                Request::post("/v1/tendermint/misbehaviour/proof")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        serde_json::to_vec(&misbehaviour_request()).unwrap(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
    }
}
