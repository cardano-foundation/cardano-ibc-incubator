import { assert, assertEquals, assertThrows } from "@std/assert";
import {
  Data,
  fromText,
  getAddressDetails,
  Lucid,
  type LucidEvolution,
  type Script,
  type UTxO,
  validatorToScriptHash,
} from "@lucid-evolution/lucid";
import { Emulator, generateEmulatorAccount } from "@lucid-evolution/provider";
import { type DeploymentTemplate, readValidator } from "../src/utils.ts";
import {
  HostStateDatum,
  HostStateNftRedeemer,
  HostStateRedeemer,
  OutputReferenceSchema,
} from "../types/index.ts";
import {
  buildFinalizeShutdownTx,
  partitionShutdownReferences,
} from "./shutdown-deployment.ts";

const HOST_STATE_TOKEN_NAME = "6962635f686f73745f7374617465";
const MAINNET_MAX_TX_SIZE = 16_384;
const TX_SIZE_HEADROOM = 750;
const HOST_STATE_POLICY = {
  type: "PlutusV3",
  script: "590100",
} as const satisfies Script;
const HOST_STATE_SCRIPT = {
  type: "PlutusV3",
  script: "590101",
} as const satisfies Script;

type RecordedCall = {
  mintingPolicies: Script[];
  spendingValidators: Script[];
  collections: Array<{ utxos: UTxO[]; redeemer: string }>;
  mints: Array<{ assets: Record<string, bigint>; redeemer: string }>;
  payments: Array<{ address: string; assets: Record<string, bigint> }>;
};

function recordingLucid() {
  const calls: RecordedCall = {
    mintingPolicies: [],
    spendingValidators: [],
    collections: [],
    mints: [],
    payments: [],
  };
  const builder: Record<string, unknown> = {};

  builder.attach = {
    MintingPolicy: (policy: Script) => {
      calls.mintingPolicies.push(policy);
      return builder;
    },
    SpendingValidator: (validator: Script) => {
      calls.spendingValidators.push(validator);
      return builder;
    },
  };
  builder.collectFrom = (utxos: UTxO[], redeemer: string) => {
    calls.collections.push({ utxos, redeemer });
    return builder;
  };
  builder.mintAssets = (
    assets: Record<string, bigint>,
    redeemer: string,
  ) => {
    calls.mints.push({ assets, redeemer });
    return builder;
  };
  builder.pay = {
    ToAddress: (address: string, assets: Record<string, bigint>) => {
      calls.payments.push({ address, assets });
      return builder;
    },
  };
  builder.addSignerKey = () => builder;
  builder.validFrom = () => builder;
  builder.validTo = () => builder;

  return {
    lucid: {
      config: () => ({ network: "Preprod" }),
      newTx: () => builder,
    } as unknown as LucidEvolution,
    calls,
  };
}

function testDeployment(): DeploymentTemplate {
  return {
    hostStateNFT: {
      policyId: validatorToScriptHash(HOST_STATE_POLICY),
      name: HOST_STATE_TOKEN_NAME,
      script: HOST_STATE_POLICY.script,
    },
    validators: {
      hostStateStt: {
        script: HOST_STATE_SCRIPT.script,
        scriptHash: validatorToScriptHash(HOST_STATE_SCRIPT),
        refUtxo: testTerminalReference(),
      },
      spendClient: {
        refUtxo: testReclaimableReference(),
      },
    },
  } as unknown as DeploymentTemplate;
}

function testHostUtxo(nftUnit: string): UTxO {
  return {
    txHash: "aa".repeat(32),
    outputIndex: 0,
    address: "addr_test1_host_state",
    assets: {
      lovelace: 5_000_000n,
      [nftUnit]: 1n,
      ["bb".repeat(28) + "01"]: 7n,
    },
  };
}

function testTerminalReference(): UTxO {
  return {
    txHash: "dd".repeat(32),
    outputIndex: 0,
    address: "addr_test1_reference",
    assets: { lovelace: 70_000_000n },
    scriptRef: HOST_STATE_SCRIPT,
  };
}

function testReclaimableReference(): UTxO {
  return {
    ...testTerminalReference(),
    txHash: "ee".repeat(32),
    scriptRef: HOST_STATE_POLICY,
  };
}

Deno.test("reference reclamation uses only known deployment outrefs", () => {
  const deployment = testDeployment();
  const terminalReference = testTerminalReference();
  const reclaimableReference = testReclaimableReference();
  const thirdPartyHostReference = {
    ...testTerminalReference(),
    txHash: "ff".repeat(32),
  };

  assertEquals(
    partitionShutdownReferences(
      deployment,
      [reclaimableReference, thirdPartyHostReference, terminalReference],
    ),
    {
      terminalReference,
      reclaimableReferences: [reclaimableReference],
    },
  );
});

Deno.test("finalize shutdown atomically burns the HostState NFT and its reference", () => {
  const deployment = testDeployment();
  const nftUnit = deployment.hostStateNFT!.policyId +
    deployment.hostStateNFT!.name;
  const unrelatedUnit = "bb".repeat(28) + "01";
  const hostUtxo = testHostUtxo(nftUnit);
  const terminalReference = testTerminalReference();
  const { lucid, calls } = recordingLucid();

  buildFinalizeShutdownTx(
    lucid,
    deployment,
    hostUtxo,
    terminalReference,
    "addr_test1_deployer",
    "cc".repeat(28),
    1_000,
  );

  assertEquals(calls.mintingPolicies, [HOST_STATE_POLICY]);
  assertEquals(calls.spendingValidators[0], HOST_STATE_SCRIPT);
  assertEquals(calls.spendingValidators.length, 2);
  assertEquals(calls.collections.length, 2);
  assertEquals(calls.collections[0].utxos, [hostUtxo]);
  assertEquals(
    Data.from(calls.collections[0].redeemer, HostStateRedeemer),
    "FinalizeShutdown",
  );
  assertEquals(calls.collections[1].utxos, [terminalReference]);
  assertEquals(calls.collections[1].redeemer, Data.void());
  assertEquals(calls.mints.length, 1);
  assertEquals(calls.mints[0].assets, { [nftUnit]: -1n });
  assertEquals(
    Data.from(calls.mints[0].redeemer, HostStateNftRedeemer),
    "BurnFinal",
  );
  assertEquals(calls.payments, [{
    address: "addr_test1_deployer",
    assets: {
      lovelace: 5_000_000n,
      [unrelatedUnit]: 7n,
    },
  }]);
});

Deno.test("finalize shutdown rejects a handler without its NFT policy", () => {
  const deployment = testDeployment();
  deployment.hostStateNFT!.script = undefined;
  const nftUnit = deployment.hostStateNFT!.policyId +
    deployment.hostStateNFT!.name;
  const { lucid } = recordingLucid();

  assertThrows(
    () =>
      buildFinalizeShutdownTx(
        lucid,
        deployment,
        testHostUtxo(nftUnit),
        testTerminalReference(),
        "addr_test1_deployer",
        "cc".repeat(28),
        1_000,
      ),
    Error,
    "must be migrated instead of finalized",
  );
});

Deno.test("finalize shutdown rejects the wrong terminal reference script", () => {
  const deployment = testDeployment();
  const nftUnit = deployment.hostStateNFT!.policyId +
    deployment.hostStateNFT!.name;
  const terminalReference = {
    ...testTerminalReference(),
    scriptRef: HOST_STATE_POLICY,
  };
  const { lucid } = recordingLucid();

  assertThrows(
    () =>
      buildFinalizeShutdownTx(
        lucid,
        deployment,
        testHostUtxo(nftUnit),
        terminalReference,
        "addr_test1_deployer",
        "cc".repeat(28),
        1_000,
      ),
    Error,
    "does not match the deployed validator",
  );
});

Deno.test("atomic finalization stays below the mainnet transaction size", async () => {
  const account = generateEmulatorAccount({ lovelace: 1_000_000_000n });
  const emulator = new Emulator([account]);
  const lucid = await Lucid(emulator, "Preprod");
  lucid.selectWallet.fromSeed(account.seedPhrase);

  const nonce = {
    transaction_id: "10".repeat(32),
    output_index: 0n,
  };
  const [nftPolicy, nftPolicyId] = readValidator(
    "host_state_nft.host_state_nft.mint",
    lucid,
    [nonce],
    Data.Tuple([OutputReferenceSchema]) as unknown as [typeof nonce],
  );
  const dummyHash = "20".repeat(28);
  const [hostValidator, hostValidatorHash, hostAddress] = readValidator(
    "host_state_stt.host_state_stt.spend",
    lucid,
    [nftPolicyId, dummyHash, dummyHash, dummyHash],
    Data.Tuple([
      Data.Bytes(),
      Data.Bytes(),
      Data.Bytes(),
      Data.Bytes(),
    ]) as unknown as [string, string, string, string],
  );
  const [, referenceValidatorHash, referenceAddress] = readValidator(
    "reference_validator.refer_only.else",
    lucid,
    [nftPolicyId],
    Data.Tuple([Data.Bytes()]) as unknown as [string],
  );
  const signer = getAddressDetails(account.address).paymentCredential;
  assert(signer?.type === "Key");
  const hostUnit = nftPolicyId + fromText("ibc_host_state");
  const now = emulator.now();
  const hostDatum = Data.to(
    {
      state: {
        version: 1n,
        ibc_state_root: "00".repeat(32),
        next_client_sequence: 0n,
        next_connection_sequence: 0n,
        next_channel_sequence: 0n,
        bound_port: [],
        last_update_time: BigInt(now),
      },
      nft_policy: nftPolicyId,
      deployer: signer.hash,
      control: {
        port_registry: new Map(),
        shutdown: {
          ShuttingDown: {
            initiated_at: BigInt(now),
            grace_period_end: BigInt(now),
          },
        },
      },
    },
    HostStateDatum,
    { canonical: true },
  );
  const hostUtxo: UTxO = {
    txHash: "30".repeat(32),
    outputIndex: 0,
    address: hostAddress,
    assets: { lovelace: 10_000_000n, [hostUnit]: 1n },
    datum: hostDatum,
  };
  const terminalReference: UTxO = {
    txHash: "40".repeat(32),
    outputIndex: 0,
    address: referenceAddress,
    assets: { lovelace: 70_000_000n },
    datum: Data.void(),
    scriptRef: hostValidator,
  };
  emulator.ledger[hostUtxo.txHash + hostUtxo.outputIndex] = {
    utxo: hostUtxo,
    spent: false,
  };
  emulator.ledger[
    terminalReference.txHash + terminalReference.outputIndex
  ] = { utxo: terminalReference, spent: false };

  const deployment = {
    hostStateNFT: {
      policyId: nftPolicyId,
      name: fromText("ibc_host_state"),
      script: nftPolicy.script,
    },
    validators: {
      hostStateStt: {
        script: hostValidator.script,
        scriptHash: hostValidatorHash,
        address: hostAddress,
        refUtxo: terminalReference,
      },
    },
  } as unknown as DeploymentTemplate;
  const completed = await buildFinalizeShutdownTx(
    lucid,
    deployment,
    hostUtxo,
    terminalReference,
    account.address,
    signer.hash,
    now,
  ).complete({ localUPLCEval: true });
  const signed = await completed.sign.withWallet().complete();
  const transaction = signed.toTransaction();

  assertEquals(transaction.body().reference_inputs()?.len() ?? 0, 0);
  const inputs = transaction.body().inputs();
  assert(
    Array.from({ length: inputs.len() }, (_, index) => inputs.get(index)).some(
      (input) =>
        input.transaction_id().to_hex() === terminalReference.txHash &&
        Number(input.index()) === terminalReference.outputIndex,
    ),
  );
  const scripts = transaction.witness_set().plutus_v3_scripts();
  const witnessHashes = new Set(
    Array.from(
      { length: scripts?.len() ?? 0 },
      (_, index) => scripts!.get(index).hash().to_hex(),
    ),
  );
  assertEquals(witnessHashes.has(hostValidatorHash), false);
  assertEquals(witnessHashes.has(referenceValidatorHash), true);
  assertEquals(witnessHashes.has(nftPolicyId), true);
  assertEquals(witnessHashes.size, 2);
  const signedBytes = signed.toCBOR().length / 2;
  assert(
    signedBytes <= MAINNET_MAX_TX_SIZE - TX_SIZE_HEADROOM,
    `Atomic finalization is ${signedBytes} bytes, above the safe transaction budget`,
  );
  assertEquals(await signed.submit(), signed.toHash());
});
