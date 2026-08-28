use ibc/client/ics_007_tendermint_client/client_state.{ClientState}
use ibc/client/ics_007_tendermint_client/consensus_state.{ConsensusState}
use ibc/client/ics_007_tendermint_client/height.{Height}
use ibc/client/ics_007_tendermint_client/proof_update/eureka_output.{
  UpdateClientOutput,
}
use ibc/client/ics_007_tendermint_client/proof_update/gnark_wrapper.{
  CommitmentKey, Proof, VerificationKey,
}
use ibc/client/ics_007_tendermint_client/types/unchecked_rational.{
  UncheckedRational,
}
use ibc/core/ics_023_vector_commitments/merkle.{MerkleRoot}

pub const program_vkey =
  #"00f170403d8173ed45e43a42ce66835f078fc5aa17be5673b1a7ad6143df097c"

pub const proof_bytes =
  #"ad049e03a39166cd46027b39d48560204ca2758851bce9920dfa6172ebf8e7d70f2e5eaa2545ded7a56a0c70220c652da674435d5b59631a1b9da36bf9a472e659ebddc93458a22d3fdaaebe6eee3780b63f22a824d278ea04a5aaca24a0ccaf141308b4c020406d71157a56b295ead1aa374423f57436b86cc5a5df6cf94e820ebc91c2f458345d8423703489925e6b94dd0f9cb4f293b4834322e4c223c4fd87f749f82c3c08f6ad6164ffa559cf39939eeeab08738c22ebf40d42e8d96378a751fcd6a58236d2744926eeb8bca2d23713bd32201496aae9c501636cbeb39ca4612ee8a5c0c2a8007d849ecfec8585a3b613a6f3fe65c3c4e3af2bb13aebe2159d017d4a2591b38e77aefe1a523acc6ef7c78d1d80bcc3418493f415bd6e43"

pub fn output() -> UpdateClientOutput {
  UpdateClientOutput {
    client_state: ClientState {
      chain_id: #"636f736d6f736875622d34",
      trust_level: UncheckedRational { numerator: 1, denominator: 3 },
      trusting_period: 1_209_600_000_000_000,
      unbonding_period: 1_814_400_000_000_000,
      max_clock_drift: 15_000_000_000,
      frozen_height: Height { revision_number: 0, revision_height: 0 },
      latest_height: Height { revision_number: 4, revision_height: 30_958_714 },
      proof_specs: [],
    },
    trusted_consensus_state: ConsensusState {
      timestamp: 1_777_895_596_297_552_485,
      root: MerkleRoot {
        hash: #"aef8b4344c566856024153a6d926846fa86247d424aa9a2897acdc903e550fd9",
      },
      next_validators_hash: #"a94f05181f311848889c44bf508e23f2c12685ab4e4090c2ac093e5d6114d39e",
    },
    new_consensus_state: ConsensusState {
      timestamp: 1_777_896_114_885_132_442,
      root: MerkleRoot {
        hash: #"480cf4c31bde380d1e21ab9f8b09eb211acee7bb5b5b773529e716cc30133a3f",
      },
      next_validators_hash: #"ff1ca5b63e9d71d07c9aaffcb666e2fd8d4a2cfc00d324e7e8ec665a5b61f6db",
    },
    time: 1_777_896_213_341_521_000,
    trusted_height: Height { revision_number: 4, revision_height: 30_958_714 },
    new_height: Height { revision_number: 4, revision_height: 30_958_804 },
  }
}

pub fn verification_key() -> VerificationKey {
  VerificationKey {
    alpha_g1: #"a0e48692d1860834ee3d7cfc801646561d59bf8e509ded6118cdcda288f6d4396446575706f9b0c8a01a50254f4ba6d7",
    beta_g2: #"9407852422b11eb0e828ab64ffe87ca57da1eaeb9402a3001250e05b30777f98230f927e38e1efdb81b21a659626efd7152f792f8affabb764707348dbe3518686137ac2673e223f29310be593de1985b2314def41039b85cb79171cdd772c90",
    gamma_g2: #"b5dbc0f21c336508c7cc5f94a8a841b0a927c528a9562bc52914d11d299e0b9697334c7c6ac47da97960129a513695ab0976675c0af5eb743b851828d6fe0adab60a33835679320df37b2c27a4bf1a2e7316b8b5d21f1bf09814b59145257acb",
    delta_g2: #"979e39606219971adb0246c4a2dcde4c0edc9b473f6eda66b82ee33eac311070671d1057766e1204415f5a42462aadb41903b89bbb499c9d5544c6556b285f4cda92e6241c2f2f0096e343a8d7682585c652727100cb009ec7d6bb21b8aa2aad",
    ic: [
      #"af6ad2b9a8750705b143bbeff5f92b334808f61d09c8f80f6ea73461c221e121e01870c1a5fc665c0657f0b6a492cb96",
      #"a2c935b80accb23c5b9e5d90d02be2703e9a5e316d5d24f10645091061ad888f4eda1e1c3fed013d209acd21ac263ad9",
      #"a614dc826492cda6e2dd7acb87c45156c606fc70f4ec5a21211ce11347aa37332ca6ccd62eaddae5c849be37c08f73a8",
      #"a574d55fa9393575dfe5b5034c26d53752b9a33b29b4cd305db02e203f18b3d3b6328a07225e89f2c3aee286981ccfb1",
    ],
    commitment_key: CommitmentKey {
      g: #"90312b6be0abc4d630f2ec3bb600d0be74938b1a092b9cfb1a9f22076216353051d62783169bd234e3a2fe97c4c7a80a13454888fbdb830ad6c4138a0933d1e9b99178b3b9415d0107eecddabd505c1acf2492b514da6c0876f5cf6c08609b9a",
      g_sigma_neg: #"b09d303c9ed5c35958f382343a0f84c01982efd74338e77709b56b56cd6fac833ea3efd7344f9c61c480c87dc83bd91d160dbb5d63c429305b4d4234197178abae3231604db3c3931da3c4652b661a7befd9e2d2e155e2829d8fec9a49ed7bf4",
    },
  }
}

pub fn proof() -> Proof {
  Proof {
    a: #"ad049e03a39166cd46027b39d48560204ca2758851bce9920dfa6172ebf8e7d70f2e5eaa2545ded7a56a0c70220c652d",
    b: #"a674435d5b59631a1b9da36bf9a472e659ebddc93458a22d3fdaaebe6eee3780b63f22a824d278ea04a5aaca24a0ccaf141308b4c020406d71157a56b295ead1aa374423f57436b86cc5a5df6cf94e820ebc91c2f458345d8423703489925e6b",
    c: #"94dd0f9cb4f293b4834322e4c223c4fd87f749f82c3c08f6ad6164ffa559cf39939eeeab08738c22ebf40d42e8d96378",
    commitment: #"a751fcd6a58236d2744926eeb8bca2d23713bd32201496aae9c501636cbeb39ca4612ee8a5c0c2a8007d849ecfec8585",
    commitment_pok: #"a3b613a6f3fe65c3c4e3af2bb13aebe2159d017d4a2591b38e77aefe1a523acc6ef7c78d1d80bcc3418493f415bd6e43",
  }
}
