import { assertEquals, assertNotEquals, assertThrows } from "@std/assert";
import {
  Data,
  fromText,
  getAddressDetails,
  type LucidEvolution,
  type Script,
} from "@lucid-evolution/lucid";
import blueprint from "../../onchain/plutus.json" with { type: "json" };

import {
  buildReferenceValidatorBatches,
  buildReferenceValidatorSizeReport,
  buildTendermintProofStakeRegistration,
  DeploymentIbcTree,
  ensureTendermintProofStakeRegistration,
  GENERIC_MODULE_SPEND_VALIDATOR_TITLE,
  parseRewardAccountRegistration,
  sortPortRegistrations,
  TENDERMINT_PROOF_VALIDATOR_TITLE,
  tendermintProofRewardAddress,
} from "./deployment.ts";
import { parseTendermintProofVerificationKey } from "./tendermint_proof_verification_key.ts";
import { generatePortTokenName, readValidator } from "./utils.ts";
import { TendermintProofVerificationKeySchema } from "../types/index.ts";

const makeValidator = (byteLength: number): Script => ({
  type: "PlutusV3",
  script: "ab".repeat(byteLength),
});

const EMPTY_HASH = "00".repeat(32);

Deno.test("generatePortTokenName matches the cross-language transfer vector", () => {
  assertEquals(
    generatePortTokenName(fromText("transfer")),
    "04c1bb73a4a1a77a59b16e461d6ea244bac88d36050557ba026d36f46dd0f873",
  );
});

Deno.test("generic module deployments pin the spend handler from the blueprint", () => {
  const genericModuleSpendHandler = blueprint.validators.find(
    ({ title }) => title === GENERIC_MODULE_SPEND_VALIDATOR_TITLE,
  ) as { title: string; parameters?: Array<{ title: string }> } | undefined;

  assertEquals(
    genericModuleSpendHandler?.title,
    GENERIC_MODULE_SPEND_VALIDATOR_TITLE,
  );
  assertEquals(
    genericModuleSpendHandler?.parameters?.map(({ title }) => title) ?? [],
    ["host_state_nft_policy_id"],
  );
});

Deno.test("SP1 deployment validators expose the pinned parameters", () => {
  const parameters = (title: string): string[] => {
    const handler = blueprint.validators.find((validator) =>
      validator.title === title
    ) as { parameters?: Array<{ title: string }> } | undefined;
    return handler?.parameters?.map((parameter) => parameter.title) ?? [];
  };

  assertEquals(parameters(TENDERMINT_PROOF_VALIDATOR_TITLE), ["wrapper_vk"]);
  assertEquals(parameters("spending_client.spend_client.spend"), [
    "host_state_nft_policy_id",
    "proof_validator_hash",
  ]);
  assertEquals(parameters("spending_client_legacy.spend_client.spend"), [
    "host_state_nft_policy_id",
  ]);
});

Deno.test("mock and icq share the host-policy-bound generic module hash", () => {
  const lucid = {
    config: () => ({ network: "Preview" }),
  } as unknown as LucidEvolution;
  const parameterSchema = Data.Tuple([Data.Bytes()]) as unknown as [string];
  const hostPolicy = "11".repeat(28);
  const [, mockHash] = readValidator(
    GENERIC_MODULE_SPEND_VALIDATOR_TITLE,
    lucid,
    [hostPolicy],
    parameterSchema,
  );
  const [, icqHash] = readValidator(
    GENERIC_MODULE_SPEND_VALIDATOR_TITLE,
    lucid,
    [hostPolicy],
    parameterSchema,
  );
  const [, otherHostHash] = readValidator(
    GENERIC_MODULE_SPEND_VALIDATOR_TITLE,
    lucid,
    ["22".repeat(28)],
    parameterSchema,
  );

  assertEquals(mockHash, icqHash);
  assertNotEquals(mockHash, otherHostHash);
});

Deno.test("spend client pins the deployed Tendermint proof validator hash", () => {
  const lucid = {
    config: () => ({ network: "Preview" }),
  } as unknown as LucidEvolution;
  const hex = (byte: string, byteLength: number) => byte.repeat(byteLength);
  const wrapperVk = parseTendermintProofVerificationKey({
    alpha_g1: hex("11", 48),
    beta_g2: hex("22", 96),
    gamma_g2: hex("33", 96),
    delta_g2: hex("44", 96),
    ic: [
      hex("51", 48),
      hex("52", 48),
      hex("53", 48),
      hex("54", 48),
    ],
    n_public: 2,
    commitment_keys: [{
      g: hex("61", 96),
      g_sigma_neg: hex("62", 96),
    }],
    public_and_commitment_committed: [[]],
    commitment_hash_domain: "cardano-ibc:gnark-bsb22:v1:",
  });
  const [proofValidator, proofHash] = readValidator(
    TENDERMINT_PROOF_VALIDATOR_TITLE,
    lucid,
    [wrapperVk],
    Data.Tuple([TendermintProofVerificationKeySchema]) as unknown as [
      typeof wrapperVk,
    ],
  );
  const hostPolicy = "71".repeat(28);
  const [spendClientValidator, spendClientHash] = readValidator(
    "spending_client.spend_client.spend",
    lucid,
    [hostPolicy, proofHash],
    Data.Tuple([Data.Bytes(), Data.Bytes()]) as unknown as [string, string],
  );
  const [, otherSpendClientHash] = readValidator(
    "spending_client.spend_client.spend",
    lucid,
    [hostPolicy, "72".repeat(28)],
    Data.Tuple([Data.Bytes(), Data.Bytes()]) as unknown as [string, string],
  );

  assertNotEquals(spendClientHash, otherSpendClientHash);
  assertEquals(
    buildReferenceValidatorSizeReport(
      [proofValidator, spendClientValidator],
      16_384,
    ).map(({ oversized }) => oversized),
    [false, false],
  );
});

Deno.test("deployment registers the proof-validator stake credential with the deployer signer", () => {
  const calls: Array<[string, string]> = [];
  const tx: Record<string, unknown> = {};
  Object.assign(tx, {
    register: {
      Stake: (rewardAddress: string) => {
        calls.push(["register", rewardAddress]);
        return tx;
      },
    },
    addSignerKey: (keyHash: string) => {
      calls.push(["signer", keyHash]);
      return tx;
    },
  });
  const lucid = {
    config: () => ({ network: "Preview" }),
    newTx: () => tx,
  } as unknown as LucidEvolution;
  const proofHash = "81".repeat(28);
  const deployerHash = "82".repeat(28);
  const rewardAddress = tendermintProofRewardAddress(lucid, proofHash);

  buildTendermintProofStakeRegistration(
    lucid,
    rewardAddress,
    deployerHash,
  );

  assertEquals(getAddressDetails(rewardAddress).stakeCredential, {
    type: "Script",
    hash: proofHash,
  });
  assertEquals(calls, [
    ["register", rewardAddress],
    ["signer", deployerHash],
  ]);
});

Deno.test("deployment skips an already-registered proof stake credential", async () => {
  const rewardAddress = "stake_test1uproof";
  let registrations = 0;
  const didRegister = await ensureTendermintProofStakeRegistration(
    rewardAddress,
    () => {
      registrations += 1;
      return Promise.resolve();
    },
    (queriedAddress) => {
      assertEquals(queriedAddress, rewardAddress);
      return Promise.resolve(true);
    },
  );

  assertEquals(didRegister, false);
  assertEquals(registrations, 0);
});

Deno.test("reward-account registration parsing rejects a different result", () => {
  const scriptHash = "83".repeat(28);

  assertEquals(parseRewardAccountRegistration(null, scriptHash), false);
  assertEquals(parseRewardAccountRegistration({}, scriptHash), false);
  assertEquals(parseRewardAccountRegistration([], scriptHash), false);
  assertEquals(
    parseRewardAccountRegistration({ [scriptHash]: {} }, scriptHash),
    true,
  );
  assertEquals(
    parseRewardAccountRegistration(
      [{ from: "script", credential: scriptHash }],
      scriptHash,
    ),
    true,
  );
  assertThrows(
    () =>
      parseRewardAccountRegistration(
        { ["84".repeat(28)]: {} },
        scriptHash,
      ),
    Error,
    `did not return script ${scriptHash}`,
  );
  assertThrows(
    () =>
      parseRewardAccountRegistration(
        [{ from: "verificationKey", credential: scriptHash }],
        scriptHash,
      ),
    Error,
    `did not return script ${scriptHash}`,
  );
});

Deno.test("sortPortRegistrations uses canonical bytes-key ordering", () => {
  const registration = {
    module_script_hash: "00".repeat(28),
    port_token: { policy_id: "11".repeat(28), name: "22" },
    module_token: { policy_id: "33".repeat(28), name: "44" },
  };
  const registrations = new Map([
    [fromText("transfer"), registration],
    [fromText("icqhost"), registration],
    [fromText("mock"), registration],
  ]);

  assertEquals(
    [...sortPortRegistrations(registrations).keys()],
    [fromText("mock"), fromText("icqhost"), fromText("transfer")],
  );
});

const concatBytes = (...parts: Uint8Array[]): Uint8Array => {
  const length = parts.reduce((sum, part) => sum + part.length, 0);
  const result = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
};

const hexToBytes = (hex: string): Uint8Array => {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
};

const bytesToHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

const sha256Hex = async (bytes: Uint8Array): Promise<string> =>
  bytesToHex(
    new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        bytes as unknown as BufferSource,
      ),
    ),
  );

const expectedSingleLeafRoot = async (
  key: string,
  valueHex: string,
): Promise<string> => {
  const keyHash = await sha256Hex(new TextEncoder().encode(key));
  const valueHash = await sha256Hex(hexToBytes(valueHex));
  let current = await sha256Hex(
    concatBytes(
      new Uint8Array([0]),
      hexToBytes(keyHash),
      hexToBytes(valueHash),
    ),
  );
  let index = BigInt(`0x${keyHash.slice(0, 16)}`);

  for (let depth = 0; depth < 64; depth += 1) {
    const currentBytes = hexToBytes(current);
    current = (index & 1n) === 0n
      ? await sha256Hex(
        concatBytes(new Uint8Array([1]), currentBytes, hexToBytes(EMPTY_HASH)),
      )
      : await sha256Hex(
        concatBytes(new Uint8Array([1]), hexToBytes(EMPTY_HASH), currentBytes),
      );
    index >>= 1n;
  }

  return current;
};

Deno.test("buildReferenceValidatorBatches groups validators within the tx budget", () => {
  const validators = [
    makeValidator(100),
    makeValidator(100),
    makeValidator(100),
  ];

  const batches = buildReferenceValidatorBatches(validators, 5_600);

  assertEquals(batches.length, 2);
  assertEquals(batches.map((batch) => batch.startIndex), [0, 2]);
  assertEquals(
    batches.map((batch) => batch.validators.length),
    [2, 1],
  );
});

Deno.test("buildReferenceValidatorBatches keeps an oversized validator in its own batch", () => {
  const validators = [
    makeValidator(900),
    makeValidator(100),
  ];

  const batches = buildReferenceValidatorBatches(validators, 5_600);

  assertEquals(batches.length, 2);
  assertEquals(batches.map((batch) => batch.startIndex), [0, 1]);
  assertEquals(
    batches.map((batch) => batch.validators.length),
    [1, 1],
  );
});

Deno.test("buildReferenceValidatorSizeReport allows single validators that exceed the batch budget", () => {
  const validators = [
    makeValidator(1_200),
    makeValidator(100),
  ];

  const report = buildReferenceValidatorSizeReport(validators, 5_600);

  assertEquals(report[0].index, 0);
  assertEquals(report[0].scriptBytes, 1_200);
  assertEquals(report[0].estimatedReferenceOutputBytes, 1_400);
  assertEquals(report[0].oversized, false);
  assertEquals(report[1].oversized, false);
});

Deno.test("buildReferenceValidatorSizeReport flags validators that cannot fit alone", () => {
  const validators = [
    makeValidator(5_000),
    makeValidator(100),
  ];

  const report = buildReferenceValidatorSizeReport(validators, 5_600);

  assertEquals(report[0].index, 0);
  assertEquals(report[0].scriptBytes, 5_000);
  assertEquals(report[0].estimatedReferenceOutputBytes, 5_200);
  assertEquals(report[0].oversized, true);
  assertEquals(report[1].oversized, false);
});

Deno.test("DeploymentIbcTree commits leaves with key hash included", async () => {
  const tree = new DeploymentIbcTree();
  const key = "ports/transfer";
  const value = Data.to(100n as never, Data.Integer() as never, {
    canonical: true,
  });

  tree.set(key, value);

  assertEquals(await tree.getRoot(), await expectedSingleLeafRoot(key, value));
});
