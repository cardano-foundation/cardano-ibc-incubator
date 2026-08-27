use alloy_sol_types::{sol, SolValue};
use anyhow::{ensure, Context};
use ibc_proto::ibc::{
    core::client::v1::Height as ProtoHeight, lightclients::tendermint::v1::Header as ProtoHeader,
};
use prost::Message;
use serde_json::Value;
use sha2::{Digest, Sha256};
use sp1_sdk::{Elf, ProveRequest, Prover, ProverClient, SP1ProofMode, SP1Stdin};
use std::{env, fs, path::Path};
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
        time: target.signed_header.header.time.unix_timestamp_nanos() as u128 + 1_000_000_000,
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

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let elf_path = env::args()
        .nth(1)
        .context("usage: eureka-guest-runner <ELF> <fixture-source>")?;
    let source_path = env::args()
        .nth(2)
        .context("missing Injective fixture source directory")?;
    let elf = fs::read(&elf_path).with_context(|| format!("read {elf_path}"))?;
    let digest = hex::encode(Sha256::digest(&elf));
    ensure!(
        digest == ELF_SHA256,
        "unexpected Eureka ELF SHA-256: {digest}"
    );

    println!("eureka_tag={EUREKA_TAG}");
    println!("eureka_commit={EUREKA_COMMIT}");
    println!("elf_sha256={digest}");
    println!();
    run_case(&elf, &injective_case(Path::new(&source_path))?).await?;
    run_case(&elf, &synthetic_200_case()?).await?;
    Ok(())
}
