use super::{encode_wrapper_fixture, SP1_GROTH16_PROOF_BYTES, WRAPPED_PROOF_BYTES};
use anyhow::{bail, ensure, Context};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    path::{Path, PathBuf},
    process::Stdio,
    time::Duration,
};
use tokio::{
    io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader},
    process::{Child, ChildStdin, ChildStdout, Command},
    sync::Mutex,
    time::timeout,
};

const WORKER_PROTOCOL: &str = "cardano-ibc-bn254-to-bls-wrapper/v1";
const MAX_WORKER_LINE_BYTES: usize = 64 * 1024;

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct ReadyMessage {
    ready: bool,
    protocol: String,
    #[serde(rename = "verificationKeySha256")]
    verification_key_sha256: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProofRequest {
    request_id: String,
    fixture: Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ProofResponse {
    #[serde(default)]
    request_id: String,
    ok: bool,
    wrapped_proof: Option<String>,
    program_vkey: Option<String>,
    public_values: Option<String>,
    elapsed_seconds: Option<f64>,
    error: Option<String>,
}

struct Process {
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
}

impl Process {
    async fn start(
        binary: &Path,
        key_dir: &Path,
        expected_verification_key_sha256: &str,
        startup_timeout: Duration,
    ) -> anyhow::Result<Self> {
        let mut child = Command::new(binary)
            .arg("-worker")
            .arg("-key-dir")
            .arg(key_dir)
            .env_clear()
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .kill_on_drop(true)
            .spawn()
            .with_context(|| format!("start wrapper worker {}", binary.display()))?;
        let stdin = child.stdin.take().context("open wrapper worker stdin")?;
        let stdout = child.stdout.take().context("open wrapper worker stdout")?;
        let mut process = Self {
            child,
            stdin,
            stdout: BufReader::new(stdout),
        };

        let line = process
            .read_line(startup_timeout, "wrapper worker startup")
            .await?;
        validate_ready(&line, expected_verification_key_sha256)?;
        Ok(process)
    }

    async fn exchange(
        &mut self,
        request: &ProofRequest,
        proof_timeout: Duration,
    ) -> anyhow::Result<ProofResponse> {
        if let Some(status) = self
            .child
            .try_wait()
            .context("check wrapper worker status")?
        {
            bail!("wrapper worker exited before request with {status}");
        }

        let mut request_line = serde_json::to_vec(request).context("encode wrapper request")?;
        request_line.push(b'\n');
        self.stdin
            .write_all(&request_line)
            .await
            .context("write wrapper request")?;
        self.stdin.flush().await.context("flush wrapper request")?;

        let line = self
            .read_line(proof_timeout, "wrapper proof generation")
            .await?;
        serde_json::from_str(&line).context("decode wrapper response")
    }

    async fn read_line(&mut self, limit: Duration, operation: &str) -> anyhow::Result<String> {
        let mut line = String::new();
        let mut bounded = (&mut self.stdout).take((MAX_WORKER_LINE_BYTES + 1) as u64);
        let bytes = timeout(limit, bounded.read_line(&mut line))
            .await
            .with_context(|| format!("{operation} exceeded {} seconds", limit.as_secs()))?
            .with_context(|| format!("read {operation} response"))?;
        ensure!(
            bytes != 0,
            "wrapper worker closed stdout during {operation}"
        );
        ensure!(
            bytes <= MAX_WORKER_LINE_BYTES,
            "wrapper worker emitted a {bytes}-byte line during {operation}"
        );
        ensure!(
            line.ends_with('\n'),
            "wrapper worker emitted an unterminated line during {operation}"
        );
        Ok(line)
    }
}

pub(crate) struct WrapperWorker {
    binary: PathBuf,
    key_dir: PathBuf,
    startup_timeout: Duration,
    proof_timeout: Duration,
    expected_verification_key_sha256: String,
    process: Mutex<Option<Process>>,
}

impl WrapperWorker {
    pub(crate) async fn start(
        binary: PathBuf,
        key_dir: PathBuf,
        expected_verification_key_sha256: String,
        startup_timeout: Duration,
        proof_timeout: Duration,
    ) -> anyhow::Result<Self> {
        let process = Process::start(
            &binary,
            &key_dir,
            &expected_verification_key_sha256,
            startup_timeout,
        )
        .await?;
        Ok(Self {
            binary,
            key_dir,
            expected_verification_key_sha256,
            startup_timeout,
            proof_timeout,
            process: Mutex::new(Some(process)),
        })
    }

    pub(crate) async fn prove(
        &self,
        request_id: &str,
        program_vkey: [u8; 32],
        public_values: Vec<u8>,
        proof: Vec<u8>,
    ) -> anyhow::Result<Vec<u8>> {
        ensure!(
            proof.len() == SP1_GROTH16_PROOF_BYTES,
            "SP1 Groth16 proof is {} bytes, expected {SP1_GROTH16_PROOF_BYTES}",
            proof.len()
        );
        let request = ProofRequest {
            request_id: request_id.to_owned(),
            fixture: encode_wrapper_fixture(program_vkey, public_values.clone(), proof),
        };

        let mut worker_slot = self.process.lock().await;
        let mut worker = match worker_slot.take() {
            Some(worker) => worker,
            None => Process::start(
                &self.binary,
                &self.key_dir,
                &self.expected_verification_key_sha256,
                self.startup_timeout,
            )
            .await
            .context("restart wrapper worker")?,
        };
        let response = match worker.exchange(&request, self.proof_timeout).await {
            Ok(response) => response,
            Err(error) => {
                // A transport or protocol failure can leave the JSON stream out of sync.
                // The process remains out of the slot, so dropping it kills it and the next
                // request starts a clean worker.
                return Err(error);
            }
        };

        ensure!(
            response.request_id == request_id,
            "wrapper response request ID does not match the request"
        );
        if !response.ok {
            // A normal per-request rejection leaves the stream synchronized.
            *worker_slot = Some(worker);
            drop(worker_slot);
            bail!(
                "wrapper rejected proof: {}",
                response.error.as_deref().unwrap_or("unspecified error")
            );
        }
        ensure!(
            response.error.is_none(),
            "successful wrapper response included an error"
        );

        let returned_vkey = decode_hex(
            response
                .program_vkey
                .as_deref()
                .context("wrapper response omitted program vkey")?,
            "wrapper program vkey",
        )?;
        ensure!(
            returned_vkey == program_vkey,
            "wrapper changed the SP1 program vkey"
        );
        let returned_public_values = decode_hex(
            response
                .public_values
                .as_deref()
                .context("wrapper response omitted public values")?,
            "wrapper public values",
        )?;
        ensure!(
            returned_public_values == public_values,
            "wrapper changed Eureka public values"
        );
        let wrapped_proof = decode_hex(
            response
                .wrapped_proof
                .as_deref()
                .context("wrapper response omitted wrapped proof")?,
            "wrapped proof",
        )?;
        ensure!(
            wrapped_proof.len() == WRAPPED_PROOF_BYTES,
            "wrapper emitted a {}-byte proof",
            wrapped_proof.len()
        );
        if let Some(seconds) = response.elapsed_seconds {
            ensure!(
                seconds.is_finite() && seconds >= 0.0,
                "wrapper emitted an invalid elapsed time"
            );
            tracing::info!(request_id, seconds, "BLS wrapper proof verified");
        }
        // Put the process back only after a complete, correctly correlated, valid response. If
        // this future is cancelled at an await above, the local Child is dropped and killed while
        // the shared slot remains empty.
        *worker_slot = Some(worker);
        drop(worker_slot);
        Ok(wrapped_proof)
    }
}

fn decode_hex(value: &str, label: &str) -> anyhow::Result<Vec<u8>> {
    hex::decode(value.strip_prefix("0x").unwrap_or(value))
        .with_context(|| format!("decode {label}"))
}

fn validate_ready(line: &str, expected_verification_key_sha256: &str) -> anyhow::Result<()> {
    let ready: ReadyMessage =
        serde_json::from_str(line).context("decode wrapper worker readiness")?;
    ensure!(ready.ready, "wrapper worker did not report ready");
    ensure!(
        ready.protocol == WORKER_PROTOCOL,
        "wrapper worker protocol {} does not match {WORKER_PROTOCOL}",
        ready.protocol
    );
    ensure!(
        ready.verification_key_sha256 == expected_verification_key_sha256,
        "wrapper worker loaded a different verification key than the Cardano deployment"
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_unknown_readiness_fields() {
        assert!(serde_json::from_str::<ReadyMessage>(
            r#"{"ready":true,"protocol":"cardano-ibc-bn254-to-bls-wrapper/v1","verificationKeySha256":"aa","extra":1}"#
        )
        .is_err());
    }

    #[test]
    fn readiness_binds_the_deployed_verification_key() {
        let line = r#"{"ready":true,"protocol":"cardano-ibc-bn254-to-bls-wrapper/v1","verificationKeySha256":"aa"}"#;
        validate_ready(line, "aa").unwrap();
        assert!(validate_ready(line, "bb").is_err());
    }

    #[test]
    fn decodes_prefixed_and_unprefixed_hex() {
        assert_eq!(decode_hex("0x0102", "test").unwrap(), [1, 2]);
        assert_eq!(decode_hex("0102", "test").unwrap(), [1, 2]);
    }
}
