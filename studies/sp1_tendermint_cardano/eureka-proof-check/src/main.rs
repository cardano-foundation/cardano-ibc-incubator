use alloy_sol_types::{sol, SolValue};
use anyhow::{bail, Context, Result};
use serde::Deserialize;
use sp1_verifier::{Groth16Verifier, GROTH16_VK_BYTES};
use std::{env, fs, path::PathBuf};

sol! {
    struct SP1Proof {
        bytes32 vKey;
        bytes publicValues;
        bytes proof;
    }

    struct MsgUpdateClient {
        SP1Proof sp1Proof;
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Fixture {
    update_client_vkey: String,
    update_msg: String,
}

fn decode_hex(value: &str) -> Result<Vec<u8>> {
    hex::decode(value.strip_prefix("0x").unwrap_or(value)).context("invalid hex")
}

fn verify_fixture(path: &PathBuf) -> Result<(usize, usize, usize)> {
    let fixture: Fixture = serde_json::from_slice(
        &fs::read(path).with_context(|| format!("failed to read {}", path.display()))?,
    )?;
    let encoded = decode_hex(&fixture.update_msg)?;
    let message = MsgUpdateClient::abi_decode(&encoded)?;
    let program_vkey = format!("0x{}", hex::encode(message.sp1Proof.vKey));

    if program_vkey != fixture.update_client_vkey {
        bail!("program verification key differs from fixture metadata");
    }

    Groth16Verifier::verify(
        message.sp1Proof.proof.as_ref(),
        message.sp1Proof.publicValues.as_ref(),
        &program_vkey,
        &GROTH16_VK_BYTES,
    )
    .context("Eureka SP1 Groth16 proof did not verify")?;

    Ok((
        encoded.len(),
        message.sp1Proof.proof.len(),
        message.sp1Proof.publicValues.len(),
    ))
}

fn main() -> Result<()> {
    let path = env::args_os().nth(1).map(PathBuf::from).unwrap_or_else(|| {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../fixtures/update_client_fixture-groth16.json")
    });
    let (message_bytes, proof_bytes, public_value_bytes) = verify_fixture(&path)?;

    println!("verified: true");
    println!("curve: BN254");
    println!("update_message_bytes: {message_bytes}");
    println!("proof_bytes: {proof_bytes}");
    println!("public_values_bytes: {public_value_bytes}");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture_path() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../fixtures/update_client_fixture-groth16.json")
    }

    #[test]
    fn verifies_eureka_fixture() {
        assert_eq!(
            verify_fixture(&fixture_path()).expect("official Eureka fixture must verify"),
            (1_376, 356, 768),
        );
    }

    #[test]
    fn rejects_tampered_public_values() {
        let fixture: Fixture = serde_json::from_slice(&fs::read(fixture_path()).unwrap()).unwrap();
        let encoded = decode_hex(&fixture.update_msg).unwrap();
        let message = MsgUpdateClient::abi_decode(&encoded).unwrap();
        let mut public_values = message.sp1Proof.publicValues.to_vec();
        public_values[0] ^= 1;
        let program_vkey = format!("0x{}", hex::encode(message.sp1Proof.vKey));
        assert!(Groth16Verifier::verify(
            message.sp1Proof.proof.as_ref(),
            &public_values,
            &program_vkey,
            &GROTH16_VK_BYTES,
        )
        .is_err());
    }

    #[test]
    fn rejects_tampered_proof() {
        let fixture: Fixture = serde_json::from_slice(&fs::read(fixture_path()).unwrap()).unwrap();
        let encoded = decode_hex(&fixture.update_msg).unwrap();
        let message = MsgUpdateClient::abi_decode(&encoded).unwrap();
        let mut proof = message.sp1Proof.proof.to_vec();
        let last = proof.len() - 1;
        proof[last] ^= 1;
        let program_vkey = format!("0x{}", hex::encode(message.sp1Proof.vKey));
        assert!(Groth16Verifier::verify(
            &proof,
            message.sp1Proof.publicValues.as_ref(),
            &program_vkey,
            &GROTH16_VK_BYTES,
        )
        .is_err());
    }
}
