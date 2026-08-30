use anyhow::{ensure, Context};
use cardano_ibc_sp1_tendermint_prover::encode_wrapper_fixture;
use std::{env, fs, path::PathBuf};

fn main() -> anyhow::Result<()> {
    let mut args = env::args_os().skip(1);
    let program_vkey_hex = args.next().context(
        "usage: encode-wrapper-fixture <program-vkey-hex> <public-values.bin> <proof.bin> <fixture.json>",
    )?;
    let public_values_path = args
        .next()
        .map(PathBuf::from)
        .context("missing public values path")?;
    let proof_path = args
        .next()
        .map(PathBuf::from)
        .context("missing SP1 proof path")?;
    let output_path = args
        .next()
        .map(PathBuf::from)
        .context("missing fixture output path")?;
    ensure!(args.next().is_none(), "too many arguments");

    let program_vkey_hex = program_vkey_hex
        .to_str()
        .context("program vkey must be UTF-8")?
        .trim_start_matches("0x");
    ensure!(
        program_vkey_hex.len() == 64
            && program_vkey_hex
                .bytes()
                .all(|byte| byte.is_ascii_hexdigit()),
        "program vkey must be exactly 32 hexadecimal bytes"
    );
    let program_vkey = hex::decode(program_vkey_hex)?
        .try_into()
        .expect("validated program-vkey length");
    let fixture = encode_wrapper_fixture(
        program_vkey,
        fs::read(&public_values_path)
            .with_context(|| format!("read {}", public_values_path.display()))?,
        fs::read(&proof_path).with_context(|| format!("read {}", proof_path.display()))?,
    );
    fs::write(&output_path, serde_json::to_vec_pretty(&fixture)?)
        .with_context(|| format!("write {}", output_path.display()))?;
    Ok(())
}
