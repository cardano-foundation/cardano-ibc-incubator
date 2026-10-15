//! Reference vectors from the mithril-stm and fixed versions the Mithril
//! mainnet aggregator 0.9.22 (3f6cb73) builds with.
use fixed::types::U8F24;
use mithril_stm::{
    AggregateSignatureType, AncillaryGenesisData, AncillaryProofInput, Clerk, Initializer,
    KeyRegistration, MithrilMembershipDigest, Parameters, Signer, SingleSignature,
};
use rand_chacha::ChaCha20Rng;
use rand_core::{RngCore, SeedableRng};
use serde_json::{json, Value};

type D = MithrilMembershipDigest;

fn u8f24_vectors() -> Vec<Value> {
    let mut inputs: Vec<f64> = vec![
        0.2, 0.65, 0.95, 1.0, 0.5, 0.1, 0.05, 0.01, 0.20000001, 0.19999998, 0.000001, 0.9999999,
        f64::EPSILON, 1.0 - f64::EPSILON,
    ];
    // Exact half points between two codes, and their binary64 neighbours.
    for code in [1u64, 2, 3, 3355442, 3355443, 8388607, 8388608, 16777214, 16777215] {
        let half = (code as f64 + 0.5) / (1u64 << 24) as f64;
        let bits = half.to_bits();
        inputs.extend([f64::from_bits(bits - 1), half, f64::from_bits(bits + 1)]);
    }
    let mut rng = ChaCha20Rng::from_seed([7u8; 32]);
    for _ in 0..200 {
        inputs.push((rng.next_u64() >> 11) as f64 / (1u64 << 53) as f64);
    }
    inputs
        .into_iter()
        .filter(|value| *value > 0.0 && *value <= 1.0)
        .map(|value| json!({"phi_f_bits": value.to_bits(), "u8f24": U8F24::from_num(value).to_bits()}))
        .collect()
}

fn lottery_case(name: &str, params: Parameters, stakes: &[u64], seed: u8) -> Value {
    let mut rng = ChaCha20Rng::from_seed([seed; 32]);
    let mut message = [0u8; 32];
    rng.fill_bytes(&mut message);
    let mut registration = KeyRegistration::initialize();
    let mut initializers = Vec::new();
    for &stake in stakes {
        let initializer = Initializer::new(params, stake, &mut rng);
        registration
            .register(initializer.stake, &initializer.get_verification_key_proof_of_possession_for_concatenation())
            .expect("registration");
        initializers.push(initializer);
    }
    let closed = registration.close_registration(&params).expect("closed registration");
    let signers: Vec<Signer<D>> = initializers
        .into_iter()
        .map(|initializer| initializer.try_create_signer(&closed).expect("signer"))
        .collect();
    let clerk = Clerk::new_clerk_from_signer(&signers[0]);
    let avk = clerk.compute_aggregate_verification_key();
    let concatenation_avk = avk.to_concatenation_aggregate_verification_key();
    let mut signatures: Vec<SingleSignature> = Vec::new();
    let mut parties = Vec::new();
    for (signer, &stake) in signers.iter().zip(stakes) {
        let signature = signer.create_single_signature(&message).ok();
        parties.push(json!({
            "stake": stake,
            "signature": signature.as_ref().map(|s| serde_json::to_value(s).expect("signature json")),
        }));
        signatures.extend(signature);
    }
    let ancillary = AncillaryProofInput::new(None, AncillaryGenesisData::new());
    let aggregate = clerk
        .aggregate_signatures_with_type(&signatures, &message, AggregateSignatureType::Concatenation, ancillary)
        .ok()
        .map(|(aggregate, _)| {
            let verified = aggregate.verify(&message, &avk, &params, None, None).is_ok();
            json!({"multi_signature": hex::encode(serde_json::to_vec(&aggregate).expect("aggregate json")), "verified": verified})
        });
    json!({
        "name": name,
        "params": {"k": params.k, "m": params.m, "phi_f": params.phi_f},
        "message": hex::encode(message),
        "aggregate_verification_key": hex::encode(serde_json::to_vec(concatenation_avk).expect("avk json")),
        "total_stake": concatenation_avk.get_total_stake(),
        "parties": parties,
        "aggregate": aggregate,
    })
}

fn main() {
    let half = 1u64 << 62;
    let cases = vec![
        lottery_case("mainnet parameters", Parameters { k: 120, m: 1000, phi_f: 0.2 }, &[100, 2_431_347_067_481, 76_359_526_850_192, 5_000, 900_000_000_000, 33], 1),
        lottery_case("phi_f 0.65", Parameters { k: 60, m: 500, phi_f: 0.65 }, &[1, 10, 100, 1000, 10000], 2),
        lottery_case("phi_f 1", Parameters { k: 20, m: 50, phi_f: 1.0 }, &[3, 4, 5], 3),
        lottery_case("stakes above 2^53", Parameters { k: 40, m: 400, phi_f: 0.2 }, &[(1 << 53) + 1, (1 << 53) + 3, 9_007_199_254_740_993, 12_345], 4),
        lottery_case("stakes above 2^63 in total", Parameters { k: 40, m: 400, phi_f: 0.2 }, &[half, half, half - 1, 7], 5),
        lottery_case("small quorum", Parameters { k: 3, m: 12, phi_f: 0.95 }, &[2, 2, 2], 6),
    ];
    let output = json!({
        "upstream": {"mithril_commit": "3f6cb73f491eb3195d02318643e40836fb093acc", "mithril_stm": "0.12.0", "fixed": "1.31.0"},
        "u8f24": u8f24_vectors(),
        "lotteries": cases,
    });
    println!("{}", serde_json::to_string_pretty(&output).expect("vectors"));
}
