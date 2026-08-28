use alloy_sol_types::{sol, SolValue};
use anyhow::{bail, ensure, Context};
use ibc_proto::ibc::{
    core::client::v1::Height as ProtoHeight, lightclients::tendermint::v1::Header as ProtoHeader,
};
use prost::Message;
use serde_json::Value;
use sha2::{Digest, Sha256};
use sp1_sdk::{
    Elf, HashableKey, ProveRequest, Prover, ProverClient, ProvingKey, SP1ProofMode, SP1Stdin,
};
use std::{
    env, fs,
    path::{Path, PathBuf},
    time::Instant,
};
use tendermint::{hash::Hash, validator::Set, AppHash, Time};
use tendermint_rpc::endpoint::{commit, validators};
use tendermint_testgen::{
    Generator, Header as TgHeader, LightBlock as TgLightBlock, Validator as TgValidator,
};

const EUREKA_TAG: &str = "sp1-programs-v2.0.0";
const EUREKA_COMMIT: &str = "ef25a661a8be156d4908956e1055ca40cd67adb7";
const ELF_SHA256: &str = "6a6a40df2b1339455de7b238fdf3e914f4c2f99e85b8fc4abb65fb1664f42270";

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

async fn run_case(elf: &[u8], case: &Case) -> anyhow::Result<()> {
    let cpu = ProverClient::builder().cpu().build().await;
    let (public_values, report) = cpu.execute(Elf::from(elf.to_vec()), stdin(case)).await?;
    let output = UpdateClientOutput::abi_decode(public_values.as_slice())?;
    ensure!(case.validators == if case.name == "injective-45" { 45 } else { 200 });
    ensure!(output.trustedHeight.revisionHeight == case.expected_trusted_height);
    ensure!(output.newHeight.revisionHeight == case.expected_new_height);
    ensure!(hex::encode(output.newConsensusState.root) == case.expected_root);
    ensure!(public_values.as_slice().len() == 768);

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

async fn prove_cpu_case(elf: &[u8], case: &Case, output_root: &Path) -> anyhow::Result<()> {
    println!("case={}", case.name);
    println!("validators={}", case.validators);
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
    let output = UpdateClientOutput::abi_decode(executed_public_values.as_slice())?;
    ensure!(output.trustedHeight.revisionHeight == case.expected_trusted_height);
    ensure!(output.newHeight.revisionHeight == case.expected_new_height);
    ensure!(hex::encode(output.newConsensusState.root) == case.expected_root);
    ensure!(executed_public_values.as_slice().len() == 768);
    println!("execute_seconds={execute_seconds:.3}");
    println!("instructions={}", report.total_instruction_count());
    println!("syscalls={}", report.total_syscall_count());

    println!("stage=prove_groth16");
    let started = Instant::now();
    let proof = cpu
        .prove(&proving_key, stdin(case))
        .mode(SP1ProofMode::Groth16)
        .await
        .context("generate real SP1 Groth16 proof")?;
    let prove_seconds = started.elapsed().as_secs_f64();
    ensure!(
        proof.public_values.as_slice() == executed_public_values.as_slice(),
        "proof and direct execution public values disagree"
    );
    let groth16_bytes = proof.bytes();
    ensure!(
        !groth16_bytes.is_empty(),
        "SP1 returned an empty/mock proof"
    );
    println!("prove_seconds={prove_seconds:.3}");
    println!("groth16_proof_bytes={}", groth16_bytes.len());

    println!("stage=verify");
    let started = Instant::now();
    cpu.verify(&proof, proving_key.verifying_key(), None)
        .context("verify generated SP1 Groth16 proof")?;
    let verify_seconds = started.elapsed().as_secs_f64();
    println!("verify_seconds={verify_seconds:.3}");

    let output_dir = output_root.join(case.name);
    fs::create_dir_all(&output_dir)
        .with_context(|| format!("create output directory {}", output_dir.display()))?;
    let bundle_path = output_dir.join("proof.bundle.bin");
    proof
        .save(&bundle_path)
        .with_context(|| format!("save proof bundle {}", bundle_path.display()))?;
    fs::write(output_dir.join("proof.groth16.bin"), &groth16_bytes)?;
    fs::write(
        output_dir.join("proof.groth16.hex"),
        format!("{}\n", hex::encode(&groth16_bytes)),
    )?;
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
    let bundle_bytes = fs::metadata(&bundle_path)?.len();
    let metrics = serde_json::json!({
        "case": case.name,
        "validators": case.validators,
        "eureka_tag": EUREKA_TAG,
        "eureka_commit": EUREKA_COMMIT,
        "elf_sha256": ELF_SHA256,
        "sp1_version": proof.sp1_version,
        "program_vkey": program_vkey,
        "instructions": report.total_instruction_count(),
        "syscalls": report.total_syscall_count(),
        "public_values_bytes": proof.public_values.as_slice().len(),
        "groth16_proof_bytes": groth16_bytes.len(),
        "proof_bundle_bytes": bundle_bytes,
        "groth16_proof_sha256": hex::encode(Sha256::digest(&groth16_bytes)),
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
    println!("proof_bundle_bytes={bundle_bytes}");
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
        "usage: eureka-guest-runner <ELF> <fixture-source> [check|prove-cpu] \
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
        match command.as_str() {
            "check" => run_case(&elf, &case).await?,
            "prove-cpu" => prove_cpu_case(&elf, &case, &output_root).await?,
            _ => bail!("unknown command {command:?}; expected check or prove-cpu"),
        }
    }
    Ok(())
}
