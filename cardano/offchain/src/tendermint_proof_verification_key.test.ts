import { assertEquals, assertThrows } from "@std/assert";
import {
  loadTendermintProofSetup,
  loadTendermintProofVerificationKey,
  parseTendermintProofSetupManifest,
  parseTendermintProofVerificationKey,
  TENDERMINT_PROOF_WRAPPER_CONSTRAINTS,
} from "./tendermint_proof_verification_key.ts";

const point = (byte: string, byteLength: number): string =>
  byte.repeat(byteLength);

const validVerificationKey = () => ({
  alpha_g1: point("AA", 48),
  beta_g2: point("BB", 96),
  gamma_g2: point("CC", 96),
  delta_g2: point("DD", 96),
  ic: [
    point("11", 48),
    point("22", 48),
    point("33", 48),
    point("44", 48),
  ],
  n_public: 2,
  commitment_keys: [{
    g: point("55", 96),
    g_sigma_neg: point("66", 96),
  }],
  public_and_commitment_committed: [[]],
  commitment_hash_domain: "cardano-ibc:gnark-bsb22:v1:",
});

Deno.test("parses the exact SP1 wrapper verification-key export", () => {
  const parsed = parseTendermintProofVerificationKey(validVerificationKey());

  assertEquals(parsed.alpha_g1, point("aa", 48));
  assertEquals(parsed.ic.length, 4);
  assertEquals(parsed.commitment_key.g_sigma_neg, point("66", 96));
});

Deno.test("rejects a wrapper verification key with a wrong point size", () => {
  const verificationKey = validVerificationKey();
  verificationKey.ic[2] = point("33", 47);

  assertThrows(
    () => parseTendermintProofVerificationKey(verificationKey),
    Error,
    "ic[2] must be 48 bytes of hex",
  );
});

Deno.test("rejects wrapper settings that differ from the on-chain verifier", () => {
  const verificationKey = validVerificationKey();
  verificationKey.commitment_hash_domain = "different";

  assertThrows(
    () => parseTendermintProofVerificationKey(verificationKey),
    Error,
    "commitment_hash_domain must be cardano-ibc:gnark-bsb22:v1:",
  );
});

Deno.test("rejects extra wrapper verification-key fields", () => {
  const verificationKey = {
    ...validVerificationKey(),
    proving_key: "must-not-be-loaded",
  };

  assertThrows(
    () => parseTendermintProofVerificationKey(verificationKey),
    Error,
    "unexpected fields",
  );
});

Deno.test("loads the tracked wrapper verification key regression artifact", async () => {
  const verificationKey = await loadTendermintProofVerificationKey(
    new URL(
      "../../sp1-tendermint-prover/artifacts/wrapper_verification_key.json",
      import.meta.url,
    ),
  );

  assertEquals(verificationKey.ic.length, 4);
});

Deno.test("accepts a deployment-specific structurally valid wrapper verification key", async () => {
  const temporaryDirectory = await Deno.makeTempDir();
  const verificationKeyPath =
    `${temporaryDirectory}/wrapper_verification_key.json`;
  await Deno.writeTextFile(
    verificationKeyPath,
    JSON.stringify(validVerificationKey()),
  );

  try {
    const loaded = await loadTendermintProofVerificationKey(
      verificationKeyPath,
    );
    assertEquals(loaded.alpha_g1, point("aa", 48));
  } finally {
    await Deno.remove(temporaryDirectory, { recursive: true });
  }
});

Deno.test("loads deployment-specific setup metadata beside the verification key", async () => {
  const temporaryDirectory = await Deno.makeTempDir();
  const verificationKeyPath = `${temporaryDirectory}/verification_key.json`;
  await Deno.writeTextFile(
    verificationKeyPath,
    `${JSON.stringify(validVerificationKey())}\n`,
  );
  await Deno.writeTextFile(
    `${temporaryDirectory}/manifest.json`,
    JSON.stringify({
      curve: "bls12-381",
      development_setup: true,
      constraints: TENDERMINT_PROOF_WRAPPER_CONSTRAINTS,
      files: {
        "outer.pk": { bytes: 10, sha256: "11".repeat(32) },
        "outer.r1cs": { bytes: 20, sha256: "22".repeat(32) },
        "outer.vk": { bytes: 30, sha256: "33".repeat(32) },
      },
    }),
  );

  try {
    const loaded = await loadTendermintProofSetup(verificationKeyPath);

    assertEquals(
      loaded.setup.constraints,
      TENDERMINT_PROOF_WRAPPER_CONSTRAINTS,
    );
    assertEquals(loaded.setup.files["outer.pk"].sha256, "11".repeat(32));
    assertEquals(loaded.verificationKeySha256.length, 64);
  } finally {
    await Deno.remove(temporaryDirectory, { recursive: true });
  }
});

Deno.test("rejects extra setup manifest files", () => {
  assertThrows(
    () =>
      parseTendermintProofSetupManifest({
        curve: "bls12-381",
        development_setup: true,
        constraints: TENDERMINT_PROOF_WRAPPER_CONSTRAINTS,
        files: {
          "outer.pk": { bytes: 10, sha256: "11".repeat(32) },
          "outer.r1cs": { bytes: 20, sha256: "22".repeat(32) },
          "outer.vk": { bytes: 30, sha256: "33".repeat(32) },
          "unexpected.key": { bytes: 40, sha256: "44".repeat(32) },
        },
      }),
    Error,
    "unexpected fields",
  );
});

Deno.test("rejects a setup manifest for a different wrapper circuit", () => {
  assertThrows(
    () =>
      parseTendermintProofSetupManifest({
        curve: "bls12-381",
        development_setup: true,
        constraints: TENDERMINT_PROOF_WRAPPER_CONSTRAINTS - 1,
        files: {
          "outer.pk": { bytes: 10, sha256: "11".repeat(32) },
          "outer.r1cs": { bytes: 20, sha256: "22".repeat(32) },
          "outer.vk": { bytes: 30, sha256: "33".repeat(32) },
        },
      }),
    Error,
    `expected ${TENDERMINT_PROOF_WRAPPER_CONSTRAINTS}`,
  );
});
