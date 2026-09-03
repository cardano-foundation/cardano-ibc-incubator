import type { TendermintProofVerificationKey } from "../types/index.ts";

export const TENDERMINT_PROOF_VK_PATH_ENV = "SP1_TENDERMINT_WRAPPER_VK_PATH";

const COMMITMENT_HASH_DOMAIN = "cardano-ibc:gnark-bsb22:v1:";
export const TENDERMINT_PROOF_WRAPPER_CONSTRAINTS = 1_192_065;
const SETUP_FILE_NAMES = ["outer.pk", "outer.r1cs", "outer.vk"] as const;
const ROOT_FIELDS = [
  "alpha_g1",
  "beta_g2",
  "gamma_g2",
  "delta_g2",
  "ic",
  "n_public",
  "commitment_keys",
  "public_and_commitment_committed",
  "commitment_hash_domain",
] as const;

type SetupFileName = typeof SETUP_FILE_NAMES[number];

export type TendermintProofSetupFileMetadata = {
  bytes: number;
  sha256: string;
};

export type TendermintProofSetupMetadata = {
  curve: "bls12-381";
  developmentSetup: boolean;
  constraints: number;
  files: Record<SetupFileName, TendermintProofSetupFileMetadata>;
};

export type LoadedTendermintProofSetup = {
  verificationKey: TendermintProofVerificationKey;
  verificationKeySha256: string;
  setup: TendermintProofSetupMetadata;
};

const requireObject = (
  value: unknown,
  label: string,
): Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
};

const requireExactFields = (
  value: Record<string, unknown>,
  expected: readonly string[],
  label: string,
): void => {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (
    actual.length !== wanted.length ||
    actual.some((field, index) => field !== wanted[index])
  ) {
    throw new Error(`${label} has unexpected fields`);
  }
};

const requireHex = (
  value: unknown,
  byteLength: number,
  label: string,
): string => {
  if (
    typeof value !== "string" ||
    value.length !== byteLength * 2 ||
    !/^[0-9a-fA-F]+$/.test(value)
  ) {
    throw new Error(`${label} must be ${byteLength} bytes of hex`);
  }
  return value.toLowerCase();
};

const requirePositiveSafeInteger = (value: unknown, label: string): number => {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new Error(`${label} must be a positive safe integer`);
  }
  return value as number;
};

const sha256Hex = async (raw: string): Promise<string> => {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw)),
  );
  return Array.from(
    digest,
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
};

export const parseTendermintProofSetupManifest = (
  value: unknown,
): TendermintProofSetupMetadata => {
  const root = requireObject(value, "SP1 wrapper setup manifest");
  requireExactFields(
    root,
    ["curve", "development_setup", "constraints", "files"],
    "SP1 wrapper setup manifest",
  );
  if (root.curve !== "bls12-381") {
    throw new Error("SP1 wrapper setup manifest curve must be bls12-381");
  }
  if (typeof root.development_setup !== "boolean") {
    throw new Error(
      "SP1 wrapper setup manifest development_setup must be a boolean",
    );
  }
  const files = requireObject(
    root.files,
    "SP1 wrapper setup manifest files",
  );
  requireExactFields(
    files,
    SETUP_FILE_NAMES,
    "SP1 wrapper setup manifest files",
  );

  const parsedFiles = Object.fromEntries(
    SETUP_FILE_NAMES.map((name) => {
      const metadata = requireObject(
        files[name],
        `SP1 wrapper setup manifest files.${name}`,
      );
      requireExactFields(
        metadata,
        ["bytes", "sha256"],
        `SP1 wrapper setup manifest files.${name}`,
      );
      return [name, {
        bytes: requirePositiveSafeInteger(
          metadata.bytes,
          `SP1 wrapper setup manifest files.${name}.bytes`,
        ),
        sha256: requireHex(
          metadata.sha256,
          32,
          `SP1 wrapper setup manifest files.${name}.sha256`,
        ),
      }];
    }),
  ) as Record<SetupFileName, TendermintProofSetupFileMetadata>;

  const constraints = requirePositiveSafeInteger(
    root.constraints,
    "SP1 wrapper setup manifest constraints",
  );
  if (constraints !== TENDERMINT_PROOF_WRAPPER_CONSTRAINTS) {
    throw new Error(
      `SP1 wrapper setup manifest has ${constraints} constraints; expected ${TENDERMINT_PROOF_WRAPPER_CONSTRAINTS}`,
    );
  }

  return {
    curve: "bls12-381",
    developmentSetup: root.development_setup,
    constraints,
    files: parsedFiles,
  };
};

export const parseTendermintProofVerificationKey = (
  value: unknown,
): TendermintProofVerificationKey => {
  const root = requireObject(value, "SP1 wrapper verification key");
  requireExactFields(root, ROOT_FIELDS, "SP1 wrapper verification key");

  if (root.n_public !== 2) {
    throw new Error("SP1 wrapper verification key n_public must be 2");
  }
  if (root.commitment_hash_domain !== COMMITMENT_HASH_DOMAIN) {
    throw new Error(
      `SP1 wrapper verification key commitment_hash_domain must be ${COMMITMENT_HASH_DOMAIN}`,
    );
  }

  if (!Array.isArray(root.ic) || root.ic.length !== 4) {
    throw new Error("SP1 wrapper verification key ic must contain 4 points");
  }
  const ic = root.ic.map((point, index) =>
    requireHex(point, 48, `SP1 wrapper verification key ic[${index}]`)
  );

  if (
    !Array.isArray(root.commitment_keys) ||
    root.commitment_keys.length !== 1
  ) {
    throw new Error(
      "SP1 wrapper verification key commitment_keys must contain 1 key",
    );
  }
  const commitmentKey = requireObject(
    root.commitment_keys[0],
    "SP1 wrapper verification key commitment_keys[0]",
  );
  requireExactFields(
    commitmentKey,
    ["g", "g_sigma_neg"],
    "SP1 wrapper verification key commitment_keys[0]",
  );

  const committed = root.public_and_commitment_committed;
  if (
    !Array.isArray(committed) ||
    committed.length !== 1 ||
    !Array.isArray(committed[0]) ||
    committed[0].length !== 0
  ) {
    throw new Error(
      "SP1 wrapper verification key public_and_commitment_committed must be [[]]",
    );
  }

  return {
    alpha_g1: requireHex(
      root.alpha_g1,
      48,
      "SP1 wrapper verification key alpha_g1",
    ),
    beta_g2: requireHex(
      root.beta_g2,
      96,
      "SP1 wrapper verification key beta_g2",
    ),
    gamma_g2: requireHex(
      root.gamma_g2,
      96,
      "SP1 wrapper verification key gamma_g2",
    ),
    delta_g2: requireHex(
      root.delta_g2,
      96,
      "SP1 wrapper verification key delta_g2",
    ),
    ic,
    commitment_key: {
      g: requireHex(
        commitmentKey.g,
        96,
        "SP1 wrapper verification key commitment_keys[0].g",
      ),
      g_sigma_neg: requireHex(
        commitmentKey.g_sigma_neg,
        96,
        "SP1 wrapper verification key commitment_keys[0].g_sigma_neg",
      ),
    },
  };
};

export const loadTendermintProofVerificationKey = async (
  filePath: string | URL,
): Promise<TendermintProofVerificationKey> => {
  return (await loadTendermintProofVerificationKeyArtifact(filePath))
    .verificationKey;
};

export const loadTendermintProofVerificationKeyArtifact = async (
  filePath: string | URL,
): Promise<{
  verificationKey: TendermintProofVerificationKey;
  sha256: string;
}> => {
  let raw: string;
  try {
    raw = await Deno.readTextFile(filePath);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Unable to read SP1 wrapper verification key ${filePath}: ${reason}`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Unable to parse SP1 wrapper verification key ${filePath}: ${reason}`,
    );
  }

  return {
    verificationKey: parseTendermintProofVerificationKey(parsed),
    sha256: await sha256Hex(raw),
  };
};

const siblingManifestPath = (filePath: string | URL): string | URL => {
  if (filePath instanceof URL) return new URL("manifest.json", filePath);
  const separator = Math.max(
    filePath.lastIndexOf("/"),
    filePath.lastIndexOf("\\"),
  );
  return `${filePath.slice(0, separator + 1)}manifest.json`;
};

export const loadTendermintProofSetup = async (
  verificationKeyPath: string | URL,
): Promise<LoadedTendermintProofSetup> => {
  const artifact = await loadTendermintProofVerificationKeyArtifact(
    verificationKeyPath,
  );
  const manifestPath = siblingManifestPath(verificationKeyPath);
  let manifest: unknown;
  try {
    manifest = JSON.parse(await Deno.readTextFile(manifestPath));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Unable to read SP1 wrapper setup manifest ${manifestPath}: ${reason}`,
    );
  }
  return {
    verificationKey: artifact.verificationKey,
    verificationKeySha256: artifact.sha256,
    setup: parseTendermintProofSetupManifest(manifest),
  };
};

export const loadConfiguredTendermintProofSetup = async (): Promise<
  LoadedTendermintProofSetup
> => {
  const filePath = Deno.env.get(TENDERMINT_PROOF_VK_PATH_ENV)?.trim();
  if (!filePath) {
    throw new Error(
      `${TENDERMINT_PROOF_VK_PATH_ENV} is required and must point to the deployment-specific wrapper verification_key.json`,
    );
  }
  return await loadTendermintProofSetup(filePath);
};

export const loadConfiguredTendermintProofVerificationKey = async (): Promise<
  TendermintProofVerificationKey
> => (await loadConfiguredTendermintProofSetup()).verificationKey;
