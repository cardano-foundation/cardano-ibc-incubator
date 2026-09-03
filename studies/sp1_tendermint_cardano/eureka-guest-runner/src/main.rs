use alloy_sol_types::{sol, SolValue};
use anyhow::{bail, ensure, Context};
use ibc_proto::ibc::{
    core::client::v1::Height as ProtoHeight, lightclients::tendermint::v1::Header as ProtoHeader,
};
use prost::Message;
use serde::Serialize;
use serde_json::Value;
use sha2::{Digest, Sha256};
use sp1_sdk::{
    Elf, HashableKey, ProveRequest, Prover, ProverClient, ProvingKey, SP1ProofMode, SP1Stdin,
};
use std::{
    collections::BTreeMap,
    env, fs,
    path::{Path, PathBuf},
    time::{Instant, SystemTime, UNIX_EPOCH},
};
use tendermint::{hash::Hash, validator::Set, AppHash, Time};
use tendermint_rpc::endpoint::{commit, validators};
use tendermint_testgen::{
    Generator, Header as TgHeader, LightBlock as TgLightBlock, Validator as TgValidator,
};

const EUREKA_TAG: &str = "sp1-programs-v2.0.0";
const EUREKA_COMMIT: &str = "ef25a661a8be156d4908956e1055ca40cd67adb7";
const ELF_SHA256: &str = "6a6a40df2b1339455de7b238fdf3e914f4c2f99e85b8fc4abb65fb1664f42270";
const SP1_VERSION: &str = "6.1.0";
const TUNING_ENV_NAMES: &[&str] = &[
    "RAYON_NUM_THREADS",
    "TOKIO_WORKER_THREADS",
    "GOMAXPROCS",
    "GOGC",
    "GOMEMLIMIT",
    "RUSTFLAGS",
    "CARGO_PROFILE_RELEASE_LTO",
    "CARGO_PROFILE_RELEASE_CODEGEN_UNITS",
    "MINIMAL_TRACE_CHUNK_THRESHOLD",
    "TRACE_CHUNK_SLOTS",
    "MEMORY_LIMIT",
    "SHARD_SIZE",
    "ELEMENT_THRESHOLD",
    "HEIGHT_THRESHOLD",
    "SP1_WORKER_NUM_SPLICING_WORKERS",
    "SP1_WORKER_SPLICING_BUFFER_SIZE",
    "SP1_WORKER_MAX_REDUCE_ARITY",
    "SP1_WORKER_NUMBER_OF_SEND_SPLICE_WORKERS_PER_SPLICE",
    "SP1_WORKER_SEND_SPLICE_INPUT_BUFFER_SIZE_PER_SPLICE",
    "SP1_WORKER_GLOBAL_MEMORY_BUFFER_SIZE",
    "SP1_WORKER_USE_FIXED_PK",
    "SP1_WORKER_VERIFY_INTERMEDIATES",
    "SP1_WORKER_NUM_CORE_WORKERS",
    "SP1_WORKER_CORE_BUFFER_SIZE",
    "SP1_WORKER_NUM_SETUP_WORKERS",
    "SP1_WORKER_SETUP_BUFFER_SIZE",
    "SP1_WORKER_NORMALIZE_PROGRAM_CACHE_SIZE",
    "SP1_WORKER_NUM_PREPARE_REDUCE_WORKERS",
    "SP1_WORKER_PREPARE_REDUCE_BUFFER_SIZE",
    "SP1_WORKER_NUM_RECURSION_EXECUTOR_WORKERS",
    "SP1_WORKER_RECURSION_EXECUTOR_BUFFER_SIZE",
    "SP1_WORKER_NUM_RECURSION_PROVER_WORKERS",
    "SP1_WORKER_RECURSION_PROVER_BUFFER_SIZE",
    "SP1_WORKER_MAX_COMPOSE_ARITY",
    "SP1_WORKER_NUM_DEFERRED_WORKERS",
    "SP1_WORKER_DEFERRED_BUFFER_SIZE",
    "SP1_CPU_BENCH_SAVE_BUNDLE",
];

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
}

struct Case {
    name: &'static str,
    validators: usize,
    client_state: ClientState,
    trusted_consensus_state: ConsensusState,
    proposed_header: ProtoHeader,
    time: u128,
    expected_trusted_height: u64,
    expected_new_height: u64,
    expected_root: &'static str,
}

#[derive(Debug, Serialize)]
struct NetworkProofMetrics {
    status: &'static str,
    request_id: Option<String>,
    request_to_fulfillment_seconds: Option<f64>,
    gas_limit_pgu: Option<u64>,
    gas_used_pgu: Option<u64>,
}

#[derive(Debug, Serialize)]
struct ExecutionMetrics {
    schema_version: u8,
    measurement: &'static str,
    measurement_scope: &'static str,
    measured_at_unix_seconds: u64,
    case: &'static str,
    validators: usize,
    eureka_tag: &'static str,
    eureka_commit: &'static str,
    elf_sha256: &'static str,
    sp1_version: &'static str,
    available_parallelism: usize,
    tuning_environment: BTreeMap<String, String>,
    execute_seconds: f64,
    instructions: u64,
    syscalls: u64,
    local_estimated_pgu: u64,
    public_values_bytes: usize,
    public_values_sha256: String,
    network_proof: NetworkProofMetrics,
}

fn unsubmitted_network_proof_metrics() -> NetworkProofMetrics {
    NetworkProofMetrics {
        status: "not_submitted",
        request_id: None,
        request_to_fulfillment_seconds: None,
        gas_limit_pgu: None,
        gas_used_pgu: None,
    }
}

fn rpc_result<T: serde::de::DeserializeOwned>(path: &Path) -> anyhow::Result<T> {
    let value: Value = serde_json::from_slice(&fs::read(path)?)?;
    Ok(serde_json::from_value(value["result"].clone())?)
}

fn hash32(hash: Hash) -> [u8; 32] {
    hash.as_bytes().try_into().expect("SHA-256 hash")
}

fn make_client_state(chain_id: &str, revision_height: u64) -> ClientState {
    ClientState {
        chainId: chain_id.to_owned(),
        trustLevel: TrustThreshold {
            numerator: 1,
            denominator: 3,
        },
        latestHeight: Height {
            revisionNumber: 1,
            revisionHeight: revision_height,
        },
        trustingPeriod: 14 * 24 * 60 * 60,
        unbondingPeriod: 21 * 24 * 60 * 60,
        isFrozen: false,
        zkAlgorithm: 0,
    }
}

fn ceil_to_millisecond(timestamp_nanos: u128) -> u128 {
    timestamp_nanos.div_ceil(1_000_000) * 1_000_000
}

fn injective_case(source: &Path) -> anyhow::Result<Case> {
    let trusted: commit::Response = rpc_result(&source.join("commit-180315956.json"))?;
    let target: commit::Response = rpc_result(&source.join("commit-180315957.json"))?;
    let vals: validators::Response = rpc_result(&source.join("validators-180315957.json"))?;
    let validator_count = vals.validators.len();
    let validator_set = Set::with_proposer(
        vals.validators,
        target.signed_header.header.proposer_address,
    )?;
    let proposed_header = ProtoHeader {
        signed_header: Some(target.signed_header.clone().into()),
        validator_set: Some(validator_set.clone().into()),
        trusted_height: Some(ProtoHeight {
            revision_number: 1,
            revision_height: 180_315_956,
        }),
        trusted_validators: Some(validator_set.into()),
    };
    let trusted_consensus_state = ConsensusState {
        timestamp: trusted.signed_header.header.time.unix_timestamp_nanos() as u128,
        root: <[u8; 32]>::try_from(trusted.signed_header.header.app_hash.as_bytes())?.into(),
        nextValidatorsHash: hash32(trusted.signed_header.header.next_validators_hash).into(),
    };

    Ok(Case {
        name: "injective-45",
        validators: validator_count,
        client_state: make_client_state("injective-1", 180_315_956),
        trusted_consensus_state,
        proposed_header,
        time: ceil_to_millisecond(
            target.signed_header.header.time.unix_timestamp_nanos() as u128 + 1_000_000_000,
        ),
        expected_trusted_height: 180_315_956,
        expected_new_height: 180_315_957,
        expected_root: "0f403709014e662d28bdce5bdf6ec9456f4a30ec9cec24ee422006a7096efb97",
    })
}

fn synthetic_200_case() -> anyhow::Result<Case> {
    let validators: Vec<_> = (0..200)
        .map(|i| TgValidator::new(&format!("validator-{i:03}")).voting_power(1))
        .collect();
    let trusted_header = TgHeader::new(&validators)
        .height(1)
        .chain_id("synthetic-1")
        .next_validators(&validators)
        .time(Time::from_unix_timestamp(1_800_000_000, 0)?)
        .app_hash(AppHash::try_from(vec![7u8; 32])?);
    let trusted_gen = TgLightBlock::new_default_with_header(trusted_header);
    let target_gen = trusted_gen.next();
    let trusted = trusted_gen.generate()?;
    let target = target_gen.generate()?;
    let proposed_header = ProtoHeader {
        signed_header: Some(target.signed_header.clone().into()),
        validator_set: Some(target.validators.clone().into()),
        trusted_height: Some(ProtoHeight {
            revision_number: 1,
            revision_height: 1,
        }),
        trusted_validators: Some(trusted.next_validators.clone().into()),
    };
    let trusted_consensus_state = ConsensusState {
        timestamp: trusted.signed_header.header.time.unix_timestamp_nanos() as u128,
        root: <[u8; 32]>::try_from(trusted.signed_header.header.app_hash.as_bytes())?.into(),
        nextValidatorsHash: hash32(trusted.signed_header.header.next_validators_hash).into(),
    };

    Ok(Case {
        name: "synthetic-200",
        validators: validators.len(),
        client_state: make_client_state("synthetic-1", 1),
        trusted_consensus_state,
        proposed_header,
        time: target.signed_header.header.time.unix_timestamp_nanos() as u128 + 1_000_000_000,
        expected_trusted_height: 1,
        expected_new_height: 2,
        expected_root: "0707070707070707070707070707070707070707070707070707070707070707",
    })
}

fn stdin(case: &Case) -> SP1Stdin {
    let mut stdin = SP1Stdin::new();
    stdin.write_vec(case.client_state.abi_encode());
    stdin.write_vec(case.trusted_consensus_state.abi_encode());
    stdin.write_vec(case.proposed_header.encode_to_vec());
    stdin.write_vec(case.time.to_le_bytes().into());
    stdin
}

fn validate_execution_output(
    case: &Case,
    public_values: &[u8],
) -> anyhow::Result<UpdateClientOutput> {
    let output = UpdateClientOutput::abi_decode(public_values)?;
    ensure!(
        case.validators == if case.name == "injective-45" { 45 } else { 200 },
        "unexpected validator count for {}",
        case.name
    );
    ensure!(output.trustedHeight.revisionHeight == case.expected_trusted_height);
    ensure!(output.newHeight.revisionHeight == case.expected_new_height);
    ensure!(hex::encode(output.newConsensusState.root) == case.expected_root);
    ensure!(public_values.len() == 768);
    Ok(output)
}

async fn run_case(elf: &[u8], case: &Case) -> anyhow::Result<()> {
    let cpu = ProverClient::builder().cpu().build().await;
    let (public_values, report) = cpu.execute(Elf::from(elf.to_vec()), stdin(case)).await?;
    let output = validate_execution_output(case, public_values.as_slice())?;

    let mock = ProverClient::builder().mock().build().await;
    let proving_key = mock.setup(Elf::from(elf.to_vec())).await?;
    let mock_proof = mock
        .prove(&proving_key, stdin(case))
        .mode(SP1ProofMode::Groth16)
        .await?;
    ensure!(
        mock_proof.public_values.as_slice() == public_values.as_slice(),
        "mock proof and direct execution disagree"
    );

    println!("case={}", case.name);
    println!("validators={}", case.validators);
    println!("instructions={}", report.total_instruction_count());
    println!("syscalls={}", report.total_syscall_count());
    println!("public_values_bytes={}", public_values.as_slice().len());
    println!("trusted_height={}", output.trustedHeight.revisionHeight);
    println!("new_height={}", output.newHeight.revisionHeight);
    println!();
    Ok(())
}

fn execution_output_dir(output_root: &Path, case_name: &str) -> PathBuf {
    output_root.join(case_name).join("execution")
}

async fn benchmark_execution_case(
    elf: &[u8],
    case: &Case,
    output_root: &Path,
) -> anyhow::Result<()> {
    let available_parallelism = std::thread::available_parallelism()?.get();
    let cpu = ProverClient::builder().cpu().build().await;
    let started = Instant::now();
    let (public_values, report) = cpu
        .execute(Elf::from(elf.to_vec()), stdin(case))
        .calculate_gas(true)
        .await
        .context("execute released Eureka ELF with SP1 gas estimation")?;
    let execute_seconds = started.elapsed().as_secs_f64();
    validate_execution_output(case, public_values.as_slice())?;
    let local_estimated_pgu = report
        .gas()
        .context("SP1 execution report did not contain a local gas estimate")?;
    let measured_at_unix_seconds = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .context("system time predates the Unix epoch")?
        .as_secs();
    let metrics = ExecutionMetrics {
        schema_version: 1,
        measurement: "sp1-local-execution",
        measurement_scope: "guest execution with local gas estimation; excludes fixture construction, prover initialization, proof generation, network queueing, and Cardano wrapping",
        measured_at_unix_seconds,
        case: case.name,
        validators: case.validators,
        eureka_tag: EUREKA_TAG,
        eureka_commit: EUREKA_COMMIT,
        elf_sha256: ELF_SHA256,
        sp1_version: SP1_VERSION,
        available_parallelism,
        tuning_environment: active_tuning_environment(),
        execute_seconds,
        instructions: report.total_instruction_count(),
        syscalls: report.total_syscall_count(),
        local_estimated_pgu,
        public_values_bytes: public_values.as_slice().len(),
        public_values_sha256: hex::encode(Sha256::digest(public_values.as_slice())),
        network_proof: unsubmitted_network_proof_metrics(),
    };
    let output_dir = execution_output_dir(output_root, case.name);
    fs::create_dir_all(&output_dir)
        .with_context(|| format!("create output directory {}", output_dir.display()))?;
    let metrics_path = output_dir.join("metrics.json");
    fs::write(
        &metrics_path,
        format!("{}\n", serde_json::to_string_pretty(&metrics)?),
    )?;

    println!("case={}", case.name);
    println!("validators={}", case.validators);
    println!("execute_seconds={execute_seconds:.9}");
    println!("instructions={}", metrics.instructions);
    println!("syscalls={}", metrics.syscalls);
    println!("local_estimated_pgu={local_estimated_pgu}");
    println!("network_status={}", metrics.network_proof.status);
    println!("metrics={}", metrics_path.display());
    println!();
    Ok(())
}

fn proof_mode_name(mode: SP1ProofMode) -> &'static str {
    match mode {
        SP1ProofMode::Core => "core",
        SP1ProofMode::Compressed => "compressed",
        SP1ProofMode::Plonk => "plonk",
        SP1ProofMode::Groth16 => "groth16",
    }
}

fn proof_mode_for_command(command: &str) -> Option<SP1ProofMode> {
    match command {
        "prove-cpu-core" => Some(SP1ProofMode::Core),
        "prove-cpu-compressed" => Some(SP1ProofMode::Compressed),
        "prove-cpu" | "prove-cpu-groth16" => Some(SP1ProofMode::Groth16),
        _ => None,
    }
}

fn tuning_environment_from(
    mut read: impl FnMut(&str) -> Option<String>,
) -> BTreeMap<String, Option<String>> {
    TUNING_ENV_NAMES
        .iter()
        .map(|name| ((*name).to_owned(), read(name)))
        .collect()
}

fn tuning_environment() -> BTreeMap<String, Option<String>> {
    tuning_environment_from(|name| env::var(name).ok())
}

fn active_tuning_environment() -> BTreeMap<String, String> {
    tuning_environment()
        .into_iter()
        .filter_map(|(name, value)| value.map(|value| (name, value)))
        .collect()
}

fn proof_output_dir(output_root: &Path, case_name: &str, proof_mode_label: &str) -> PathBuf {
    output_root.join(case_name).join(proof_mode_label)
}

fn should_save_bundle(proof_mode_label: &str) -> bool {
    proof_mode_label == "groth16"
        || env::var("SP1_CPU_BENCH_SAVE_BUNDLE")
            .ok()
            .and_then(|value| value.parse::<bool>().ok())
            .unwrap_or(false)
}

async fn prove_cpu_case(
    elf: &[u8],
    case: &Case,
    output_root: &Path,
    proof_mode: SP1ProofMode,
) -> anyhow::Result<()> {
    let proof_mode_label = proof_mode_name(proof_mode);
    let available_parallelism = std::thread::available_parallelism()?.get();
    let tuning_environment = tuning_environment();
    println!("case={}", case.name);
    println!("validators={}", case.validators);
    println!("proof_mode={proof_mode_label}");
    println!("available_parallelism={available_parallelism}");
    for (name, value) in &tuning_environment {
        println!(
            "env_{}={}",
            name.to_ascii_lowercase(),
            value.as_deref().unwrap_or("<unset>")
        );
    }
    ensure!(
        case.time.is_multiple_of(1_000_000),
        "proof time must align with Cardano's millisecond validity bound"
    );
    println!("proof_time_nanos={}", case.time);
    println!("cardano_tx_valid_to_millis={}", case.time / 1_000_000);
    println!("stage=initialize_cpu_prover");
    let cpu = ProverClient::builder().cpu().build().await;

    println!("stage=setup");
    let started = Instant::now();
    let proving_key = cpu
        .setup(Elf::from(elf.to_vec()))
        .await
        .context("set up released Eureka ELF")?;
    let setup_seconds = started.elapsed().as_secs_f64();
    let program_vkey = proving_key.verifying_key().bytes32();
    println!("setup_seconds={setup_seconds:.3}");
    println!("program_vkey={program_vkey}");

    println!("stage=execute");
    let started = Instant::now();
    let (executed_public_values, report) = cpu
        .execute(Elf::from(elf.to_vec()), stdin(case))
        .await
        .context("execute released Eureka ELF before proving")?;
    let execute_seconds = started.elapsed().as_secs_f64();
    validate_execution_output(case, executed_public_values.as_slice())?;
    println!("execute_seconds={execute_seconds:.3}");
    println!("instructions={}", report.total_instruction_count());
    println!("syscalls={}", report.total_syscall_count());

    println!("stage=prove_{proof_mode_label}");
    let started = Instant::now();
    let proof = cpu
        .prove(&proving_key, stdin(case))
        .mode(proof_mode)
        .await
        .with_context(|| format!("generate real SP1 {proof_mode_label} proof"))?;
    let prove_seconds = started.elapsed().as_secs_f64();
    ensure!(
        proof.public_values.as_slice() == executed_public_values.as_slice(),
        "proof and direct execution public values disagree"
    );
    println!("prove_seconds={prove_seconds:.3}");
    let groth16_bytes = if proof_mode_label == "groth16" {
        let bytes = proof.bytes();
        ensure!(!bytes.is_empty(), "SP1 returned an empty/mock proof");
        println!("groth16_proof_bytes={}", bytes.len());
        Some(bytes)
    } else {
        None
    };

    println!("stage=verify");
    let started = Instant::now();
    cpu.verify(&proof, proving_key.verifying_key(), None)
        .with_context(|| format!("verify generated SP1 {proof_mode_label} proof"))?;
    let verify_seconds = started.elapsed().as_secs_f64();
    println!("verify_seconds={verify_seconds:.3}");

    let output_dir = proof_output_dir(output_root, case.name, proof_mode_label);
    fs::create_dir_all(&output_dir)
        .with_context(|| format!("create output directory {}", output_dir.display()))?;
    let bundle_bytes = if should_save_bundle(proof_mode_label) {
        let bundle_path = output_dir.join("proof.bundle.bin");
        proof
            .save(&bundle_path)
            .with_context(|| format!("save proof bundle {}", bundle_path.display()))?;
        Some(fs::metadata(&bundle_path)?.len())
    } else {
        None
    };
    if let Some(groth16_bytes) = &groth16_bytes {
        fs::write(output_dir.join("proof.groth16.bin"), groth16_bytes)?;
        fs::write(
            output_dir.join("proof.groth16.hex"),
            format!("{}\n", hex::encode(groth16_bytes)),
        )?;
    }
    fs::write(
        output_dir.join("public_values.bin"),
        proof.public_values.as_slice(),
    )?;
    fs::write(
        output_dir.join("public_values.hex"),
        format!("{}\n", hex::encode(proof.public_values.as_slice())),
    )?;
    fs::write(
        output_dir.join("program_vkey.txt"),
        format!("{program_vkey}\n"),
    )?;
    let metrics = serde_json::json!({
        "case": case.name,
        "validators": case.validators,
        "eureka_tag": EUREKA_TAG,
        "eureka_commit": EUREKA_COMMIT,
        "elf_sha256": ELF_SHA256,
        "sp1_version": proof.sp1_version,
        "proof_mode": proof_mode_label,
        "available_parallelism": available_parallelism,
        "tuning_environment": tuning_environment,
        "program_vkey": program_vkey,
        "instructions": report.total_instruction_count(),
        "syscalls": report.total_syscall_count(),
        "public_values_bytes": proof.public_values.as_slice().len(),
        "groth16_proof_bytes": groth16_bytes.as_ref().map(Vec::len),
        "proof_bundle_bytes": bundle_bytes,
        "groth16_proof_sha256": groth16_bytes
            .as_ref()
            .map(|bytes| hex::encode(Sha256::digest(bytes))),
        "public_values_sha256": hex::encode(Sha256::digest(proof.public_values.as_slice())),
        "setup_seconds": setup_seconds,
        "execute_seconds": execute_seconds,
        "prove_seconds": prove_seconds,
        "verify_seconds": verify_seconds,
    });
    fs::write(
        output_dir.join("metrics.json"),
        format!("{}\n", serde_json::to_string_pretty(&metrics)?),
    )?;
    if let Some(bundle_bytes) = bundle_bytes {
        println!("proof_bundle_bytes={bundle_bytes}");
    } else {
        println!("proof_bundle_saved=false");
    }
    println!("artifacts={}", output_dir.display());
    println!("stage=complete");
    println!();
    Ok(())
}

fn selected_cases(selection: &str, source: &Path) -> anyhow::Result<Vec<Case>> {
    match selection {
        "injective-45" => Ok(vec![injective_case(source)?]),
        "synthetic-200" => Ok(vec![synthetic_200_case()?]),
        "all" => Ok(vec![injective_case(source)?, synthetic_200_case()?]),
        _ => bail!("unknown case {selection:?}; expected injective-45, synthetic-200, or all"),
    }
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    sp1_sdk::utils::setup_logger();
    let mut args = env::args().skip(1);
    let elf_path = args.next().context(
        "usage: eureka-guest-runner <ELF> <fixture-source> \
         [check|benchmark-execution|prove-cpu|prove-cpu-groth16|prove-cpu-core|prove-cpu-compressed] \
         [injective-45|synthetic-200|all] [output-directory]",
    )?;
    let source_path = args
        .next()
        .context("missing Injective fixture source directory")?;
    let command = args.next().unwrap_or_else(|| "check".to_owned());
    let selection = args.next().unwrap_or_else(|| "all".to_owned());
    let output_root = PathBuf::from(
        args.next()
            .unwrap_or_else(|| "artifacts-production".to_owned()),
    );
    ensure!(args.next().is_none(), "too many command-line arguments");
    let elf = fs::read(&elf_path).with_context(|| format!("read {elf_path}"))?;
    let digest = hex::encode(Sha256::digest(&elf));
    ensure!(
        digest == ELF_SHA256,
        "unexpected Eureka ELF SHA-256: {digest}"
    );

    println!("eureka_tag={EUREKA_TAG}");
    println!("eureka_commit={EUREKA_COMMIT}");
    println!("elf_sha256={digest}");
    println!("command={command}");
    println!("selection={selection}");
    println!();
    let cases = selected_cases(&selection, Path::new(&source_path))?;
    for case in cases {
        if command == "check" {
            run_case(&elf, &case).await?;
        } else if command == "benchmark-execution" {
            benchmark_execution_case(&elf, &case, &output_root).await?;
        } else if let Some(proof_mode) = proof_mode_for_command(&command) {
            prove_cpu_case(&elf, &case, &output_root, proof_mode).await?;
        } else {
            bail!(
                "unknown command {command:?}; expected check, benchmark-execution, prove-cpu, \
                 prove-cpu-groth16, prove-cpu-core, or prove-cpu-compressed"
            );
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_cpu_benchmark_modes_and_preserves_groth16_alias() {
        assert_eq!(
            proof_mode_name(proof_mode_for_command("prove-cpu-core").unwrap()),
            "core"
        );
        assert_eq!(
            proof_mode_name(proof_mode_for_command("prove-cpu-compressed").unwrap()),
            "compressed"
        );
        assert_eq!(
            proof_mode_name(proof_mode_for_command("prove-cpu").unwrap()),
            "groth16"
        );
        assert_eq!(
            proof_mode_name(proof_mode_for_command("prove-cpu-groth16").unwrap()),
            "groth16"
        );
        assert!(proof_mode_for_command("check").is_none());
    }

    #[test]
    fn uses_mode_specific_artifact_directories() {
        assert_eq!(
            proof_output_dir(Path::new("results"), "injective-45", "compressed"),
            PathBuf::from("results/injective-45/compressed")
        );
        assert_eq!(
            execution_output_dir(Path::new("results"), "synthetic-200"),
            PathBuf::from("results/synthetic-200/execution")
        );
    }

    #[test]
    fn serializes_tuning_context_into_metrics() {
        let context =
            tuning_environment_from(|name| (name == "RAYON_NUM_THREADS").then(|| "8".to_owned()));
        let json = serde_json::to_value(context).unwrap();
        assert_eq!(json["RAYON_NUM_THREADS"], "8");
        assert!(json["MINIMAL_TRACE_CHUNK_THRESHOLD"].is_null());
        assert!(json["SP1_WORKER_USE_FIXED_PK"].is_null());
    }

    #[test]
    fn does_not_present_local_estimates_as_network_measurements() {
        let json = serde_json::to_value(unsubmitted_network_proof_metrics()).unwrap();
        assert_eq!(json["status"], "not_submitted");
        assert!(json["request_id"].is_null());
        assert!(json["request_to_fulfillment_seconds"].is_null());
        assert!(json["gas_limit_pgu"].is_null());
        assert!(json["gas_used_pgu"].is_null());
    }
}
