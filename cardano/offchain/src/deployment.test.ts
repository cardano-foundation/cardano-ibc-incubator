import {
  assert,
  assertEquals,
  assertNotEquals,
  assertThrows,
} from "@std/assert";
import {
  CML,
  Data,
  Emulator,
  fromText,
  generateEmulatorAccount,
  getAddressDetails,
  Lucid,
  type LucidEvolution,
  type Script,
  type UTxO,
  validatorToAddress,
  validatorToScriptHash,
} from "@lucid-evolution/lucid";
import blueprint from "../../onchain/plutus.json" with { type: "json" };

import {
  assertAttachedValidatorBatchFits,
  assertTerminalReclamationScriptsFit,
  buildFinalizedReferenceHostDatum,
  buildReferenceRegistrationBatches,
  buildReferenceRegistrationBatchHostDatum,
  buildReferenceRegistrationJournal,
  buildReferenceScriptRegistrationPlan,
  buildReferenceValidatorBatches,
  buildReferenceValidatorSizeReport,
  DeploymentIbcTree,
  GENERIC_MODULE_SPEND_VALIDATOR_TITLE,
  parseReferenceRegistrationJournal,
  readMintLifecyclePacketMarkerValidator,
  readMintVoucherValidator,
  readReferenceScriptRegistrationProgress,
  sortPortRegistrations,
  uniqueReferenceUtxos,
  uniqueReferenceValidators,
} from "./deployment.ts";
import {
  EMPTY_REFERENCE_SCRIPT_INVENTORY_ROOT,
  foldReferenceScriptInventory,
  generatePortTokenName,
  readValidator,
  referenceScriptIdentityCbor,
} from "./utils.ts";
import { buildTerminalShutdownTx } from "../scripts/shutdown-deployment.ts";
import {
  type AuthToken,
  AuthTokenSchema,
  HostStateDatum,
  type OutputReference,
  OutputReferenceSchema,
} from "../types/index.ts";

const makeValidator = (byteLength: number): Script => ({
  type: "PlutusV3",
  script: "ab".repeat(byteLength),
});

const makeReferenceUtxo = (scriptBytes: number, outputIndex: number) => ({
  txHash: (outputIndex + 1).toString(16).padStart(2, "0").repeat(32),
  outputIndex,
  address: "addr_test1_reference",
  assets: { lovelace: 2_000_000n },
  scriptRef: {
    type: "PlutusV3" as const,
    script: (outputIndex + 1).toString(16).padStart(2, "0") +
      "ab".repeat(scriptBytes - 1),
  },
});

const EMPTY_HASH = "00".repeat(32);

Deno.test("generatePortTokenName matches the cross-language transfer vector", () => {
  assertEquals(
    generatePortTokenName(fromText("transfer")),
    "04c1bb73a4a1a77a59b16e461d6ea244bac88d36050557ba026d36f46dd0f873",
  );
});

Deno.test("reference inventory hash chain matches the cross-language vector", () => {
  assertEquals(
    referenceScriptIdentityCbor({
      txHash: "11".repeat(32),
      outputIndex: 0,
      scriptHash: "aa".repeat(28),
    }),
    "d8799fd8799f5820111111111111111111111111111111111111111111111111111111111111111100ff581caaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaff",
  );
  assertEquals(
    foldReferenceScriptInventory([
      {
        txHash: "11".repeat(32),
        outputIndex: 0,
        scriptHash: "aa".repeat(28),
      },
      {
        txHash: "22".repeat(32),
        outputIndex: 7,
        scriptHash: "bb".repeat(28),
      },
    ]),
    "8ab929a509199835bfa494bc353cd86a2b86eac5599e1e24ac4f6aed3690094f",
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

Deno.test("voucher and packet marker deployment parameters preserve the on-chain ABI", () => {
  const validatorParameterTitles = (title: string): string[] => {
    const validator = blueprint.validators.find((candidate) =>
      candidate.title === title
    ) as { parameters?: Array<{ title: string }> } | undefined;
    return validator?.parameters?.map((parameter) => parameter.title) ?? [];
  };

  assertEquals(
    validatorParameterTitles("minting_voucher.mint_voucher.mint"),
    [
      "module_token",
      "directory_auth_token",
      "voucher_metadata_script_hash",
      "channel_minting_policy_id",
      "host_state_nft_policy_id",
      "port_id",
    ],
  );
  assertEquals(
    validatorParameterTitles(
      "minting_lifecycle_packet_marker.mint_lifecycle_packet_marker.mint",
    ),
    [
      "host_policy",
      "channel_script_hash",
      "channel_policy",
      "voucher_minting_policy_id",
    ],
  );

  const lucid = {
    config: () => ({ network: "Preview" }),
  } as unknown as LucidEvolution;
  const voucherParameters = {
    moduleToken: { policy_id: "11".repeat(28), name: "aa" },
    directoryAuthToken: { policy_id: "22".repeat(28), name: "bb" },
    voucherMetadataScriptHash: "33".repeat(28),
    channelMintingPolicyId: "44".repeat(28),
    hostStateNftPolicyId: "55".repeat(28),
    portId: fromText("transfer"),
  };
  const [, voucherPolicyId] = readMintVoucherValidator(
    lucid,
    voucherParameters,
  );
  const [, otherPortVoucherPolicyId] = readMintVoucherValidator(lucid, {
    ...voucherParameters,
    portId: fromText("other-port"),
  });
  assertNotEquals(voucherPolicyId, otherPortVoucherPolicyId);

  const packetMarkerParameters = {
    hostStateNftPolicyId: voucherParameters.hostStateNftPolicyId,
    spendChannelScriptHash: "66".repeat(28),
    mintChannelSttPolicyId: voucherParameters.channelMintingPolicyId,
    voucherMintingPolicyId: voucherPolicyId,
  };
  const [, packetMarkerPolicyId] = readMintLifecyclePacketMarkerValidator(
    lucid,
    packetMarkerParameters,
  );
  const [, otherVoucherPacketMarkerPolicyId] =
    readMintLifecyclePacketMarkerValidator(lucid, {
      ...packetMarkerParameters,
      voucherMintingPolicyId: otherPortVoucherPolicyId,
    });
  assertNotEquals(packetMarkerPolicyId, otherVoucherPacketMarkerPolicyId);
});

Deno.test("the production transfer validator fits the safe reference-script ceiling", () => {
  const lucid = {
    config: () => ({ network: "Preview" }),
  } as unknown as LucidEvolution;
  const portId = fromText("transfer");
  const portToken: AuthToken = {
    policy_id: "11".repeat(28),
    name: generatePortTokenName(portId),
  };
  const moduleToken: AuthToken = {
    policy_id: "22".repeat(28),
    name: "33".repeat(32),
  };
  const [transferValidator] = readValidator(
    "spending_transfer_module.spend_transfer_module.spend",
    lucid,
    [
      portToken,
      moduleToken,
      portId,
      "44".repeat(28),
      "55".repeat(28),
      "66".repeat(28),
      "77".repeat(28),
      "88".repeat(28),
    ],
    Data.Tuple([
      AuthTokenSchema,
      AuthTokenSchema,
      Data.Bytes(),
      Data.Bytes(),
      Data.Bytes(),
      Data.Bytes(),
      Data.Bytes(),
      Data.Bytes(),
    ]) as unknown as [
      AuthToken,
      AuthToken,
      string,
      string,
      string,
      string,
      string,
      string,
    ],
  );

  const appliedScriptBytes = transferValidator.script.length / 2;
  // Keep 750 bytes for the signed transaction and 200 bytes for the reference
  // output around the script itself: 16,384 - 750 - 200 = 15,434 bytes.
  const safeReferenceScriptCeiling = 16_384 - 750 - 200;
  assertEquals(appliedScriptBytes, 15_387);
  assertEquals(safeReferenceScriptCeiling, 15_434);
  assert(
    appliedScriptBytes <= safeReferenceScriptCeiling,
    `Applied transfer validator ${appliedScriptBytes} bytes exceeds the ${safeReferenceScriptCeiling}-byte safe reference-script ceiling`,
  );
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

Deno.test("reference deployment emits one output per unique script hash", () => {
  const shared = makeValidator(10);
  const distinct = makeValidator(11);
  assertEquals(
    uniqueReferenceValidators([shared, { ...shared }, distinct]),
    [shared, distinct],
  );
});

Deno.test("reference deployment keeps one exact out-ref per script hash", () => {
  const first = {
    txHash: "11".repeat(32),
    outputIndex: 0,
    address: "addr_test1_reference",
    assets: { lovelace: 2_000_000n },
    scriptRef: makeValidator(10),
  };
  assertEquals(uniqueReferenceUtxos([first, { ...first }]), [first]);

  assertThrows(
    () =>
      uniqueReferenceUtxos([first, {
        ...first,
        txHash: "22".repeat(32),
      }]),
    Error,
    "has distinct outputs",
  );
  assertThrows(
    () => uniqueReferenceUtxos([{ ...first, scriptRef: undefined }]),
    Error,
    "has no reference script",
  );
  assertThrows(
    () =>
      uniqueReferenceUtxos([first, {
        ...first,
        scriptRef: makeValidator(11),
      }]),
    Error,
    "assigned to distinct scripts",
  );
});

Deno.test("reference registration batches accumulate an incomplete negative count", () => {
  const references = [
    makeReferenceUtxo(10, 0),
    makeReferenceUtxo(11, 1),
    makeReferenceUtxo(12, 2),
  ];
  const plan = buildReferenceScriptRegistrationPlan(
    references,
    validatorToScriptHash(references[0].scriptRef),
    100,
    2,
  );
  const datum = {
    state: {
      version: 3n,
      ibc_state_root: "aa".repeat(32),
      last_update_time: 100n,
    },
    shutdown: "Active",
    live_reference_script_count: null,
    reference_script_inventory_root: EMPTY_REFERENCE_SCRIPT_INVENTORY_ROOT,
    reference_script_registration: null,
  } as unknown as Parameters<
    typeof buildReferenceRegistrationBatchHostDatum
  >[0];
  assertEquals(readReferenceScriptRegistrationProgress(datum, plan), {
    registeredCount: 0,
    finalized: false,
  });
  const firstBatch = buildReferenceRegistrationBatchHostDatum(
    datum,
    plan.entries.slice(0, 2),
    plan.entries.length,
    plan.targetRoot,
    101,
  );
  const secondBatch = buildReferenceRegistrationBatchHostDatum(
    firstBatch,
    plan.entries.slice(2),
    plan.entries.length,
    plan.targetRoot,
    102,
  );
  assertEquals(firstBatch.live_reference_script_count, -2n);
  assertEquals(
    readReferenceScriptRegistrationProgress(firstBatch, plan),
    { registeredCount: 2, finalized: false },
  );
  assertEquals(secondBatch.state.version, 5n);
  assertEquals(secondBatch.state.ibc_state_root, datum.state.ibc_state_root);
  assertEquals(secondBatch.state.last_update_time, 102n);
  assertEquals(secondBatch.shutdown, "Active");
  assertEquals(secondBatch.live_reference_script_count, -3n);
  assertEquals(secondBatch.reference_script_inventory_root, plan.targetRoot);

  const registered = buildFinalizedReferenceHostDatum(secondBatch, 103);
  assertEquals(registered.state.version, 6n);
  assertEquals(registered.state.ibc_state_root, datum.state.ibc_state_root);
  assertEquals(registered.live_reference_script_count, 3n);
  assertEquals(
    readReferenceScriptRegistrationProgress(registered, plan),
    { registeredCount: 3, finalized: true },
  );
  assertThrows(
    () =>
      buildReferenceRegistrationBatchHostDatum(
        registered,
        [plan.entries[0]],
        plan.entries.length,
        plan.targetRoot,
        104,
      ),
    Error,
    "already finalized",
  );
  assertThrows(
    () => buildFinalizedReferenceHostDatum(firstBatch, 102),
    Error,
    "precommitted target",
  );
});

Deno.test("reference inventory places Host first and canonically orders its tail", () => {
  const references = [
    makeReferenceUtxo(10, 0),
    makeReferenceUtxo(11, 1),
    makeReferenceUtxo(12, 2),
  ];
  const hostReference = references[2];
  const plan = buildReferenceScriptRegistrationPlan(
    references,
    validatorToScriptHash(hostReference.scriptRef),
  );
  assertEquals(
    plan.entries.map(({ outputIndex }) => outputIndex),
    [2, 0, 1],
  );
  assertEquals(
    plan.entries[0].scriptHash,
    validatorToScriptHash(
      hostReference.scriptRef,
    ),
  );
  assertEquals(plan.batches[0].length >= 2, true);
});

Deno.test("reference registration journal resumes after a committed batch and rejects drift", () => {
  const references = [
    makeReferenceUtxo(80_000, 0),
    makeReferenceUtxo(80_000, 1),
    makeReferenceUtxo(80_000, 2),
  ];
  const hostValidator = references[0].scriptRef;
  const plan = buildReferenceScriptRegistrationPlan(
    references,
    validatorToScriptHash(hostValidator),
  );
  const referenceValidator = makeValidator(12);
  const deployment = {
    schemaVersion: 6,
    deployedAt: "2026-08-22T12:00:00.000Z",
    referenceOutRefs: plan.entries,
    referenceScriptInventoryRoot: plan.targetRoot,
    referenceValidator: {
      script: referenceValidator.script,
      scriptHash: validatorToScriptHash(referenceValidator),
      address: validatorToAddress("Preview", referenceValidator),
    },
    hostStateNFT: {
      policyId: "11".repeat(28),
      name: "6962635f686f73745f7374617465",
      script: "590100",
    },
    validators: {
      hostStateStt: {
        title: "host_state_stt.host_state_stt.spend",
        script: hostValidator.script,
        scriptHash: validatorToScriptHash(hostValidator),
        address: validatorToAddress("Preview", hostValidator),
        refUtxo: plan.batches[0][0],
      },
    },
  } as unknown as Parameters<typeof buildReferenceRegistrationJournal>[0];
  const journal = buildReferenceRegistrationJournal(deployment, plan);
  const restored = parseReferenceRegistrationJournal(
    JSON.parse(JSON.stringify(journal)),
  );
  assertEquals(restored.plan.entries, plan.entries);

  const mismatchedHostAddress = structuredClone(journal);
  mismatchedHostAddress.deployment.validators.hostStateStt.address =
    validatorToAddress("Preview", referenceValidator);
  assertThrows(
    () => parseReferenceRegistrationJournal(mismatchedHostAddress),
    Error,
    "HostState validator address does not match its script hash",
  );

  const initialDatum = {
    state: {
      version: 3n,
      ibc_state_root: "aa".repeat(32),
      last_update_time: 100n,
    },
    shutdown: "Active",
    live_reference_script_count: null,
    reference_script_inventory_root: EMPTY_REFERENCE_SCRIPT_INVENTORY_ROOT,
    reference_script_registration: null,
  } as unknown as Parameters<
    typeof buildReferenceRegistrationBatchHostDatum
  >[0];
  const afterCrash = buildReferenceRegistrationBatchHostDatum(
    initialDatum,
    restored.plan.entries.slice(0, 2),
    restored.plan.entries.length,
    restored.plan.targetRoot,
    101,
  );
  assertEquals(
    readReferenceScriptRegistrationProgress(afterCrash, restored.plan),
    { registeredCount: 2, finalized: false },
  );
  assertEquals(restored.plan.batches.slice(1).flat()[0].outputIndex, 2);

  const drifted = structuredClone(journal) as unknown as {
    referenceUtxos: Array<{ scriptRef?: { script: string } }>;
  };
  drifted.referenceUtxos[1].scriptRef!.script = "ff";
  assertThrows(
    () => parseReferenceRegistrationJournal(drifted),
    Error,
    "does not match its canonical inventory",
  );
});

Deno.test("reference registration batches cover the full inventory within safe limits", () => {
  const refs = [70_000, 70_000, 70_000, 10_000].map(makeReferenceUtxo);
  const hostHash = validatorToScriptHash(refs[0].scriptRef);
  const batches = buildReferenceRegistrationBatches(
    refs,
    hostHash,
    150_000,
    3,
  );
  assertEquals(batches.map((batch) => batch.length), [2, 2]);
  assertEquals(
    batches.flat().map(({ txHash, outputIndex }) => `${txHash}#${outputIndex}`),
    refs.map(({ txHash, outputIndex }) => `${txHash}#${outputIndex}`),
  );
  for (const [index, batch] of batches.entries()) {
    assertEquals(
      batch.reduce(
            (sum, utxo) => sum + utxo.scriptRef!.script.length / 2,
            0,
          ) + (index === 0 ? 0 : 70_000) <= 150_000,
      true,
    );
  }
  assertThrows(
    () =>
      buildReferenceRegistrationBatches(
        [refs[0], makeReferenceUtxo(1, 8)],
        hostHash,
        60_000,
        3,
      ),
    Error,
    "exceeding the 60000-byte registration budget",
  );
});

Deno.test("reference registration enforces the consensus inventory-count boundary", () => {
  const references = Array.from(
    { length: 129 },
    (_, index) => makeReferenceUtxo(2, index),
  );
  const hostHash = validatorToScriptHash(references[0].scriptRef);
  assertEquals(
    buildReferenceRegistrationBatches(
      references.slice(0, 128),
      hostHash,
    ).flat().length,
    128,
  );
  assertThrows(
    () => buildReferenceRegistrationBatches(references, hostHash),
    Error,
    "exceeding the consensus maximum 128",
  );
});

Deno.test("final reference reclamation preflights attached script size", () => {
  assertAttachedValidatorBatchFits(
    [makeValidator(10_000), makeValidator(1_000)],
    16_384,
    "final batch",
  );
  assertThrows(
    () =>
      assertAttachedValidatorBatchFits(
        [makeValidator(14_000), makeValidator(1_000)],
        16_384,
        "final batch",
      ),
    Error,
    "final batch",
  );
});

Deno.test("terminal preflight excludes input-provided Host but includes both attached scripts", () => {
  assertTerminalReclamationScriptsFit(
    makeValidator(15_000),
    makeValidator(4_000),
    makeValidator(4_000),
    16_384,
    "terminal batch",
  );
  assertThrows(
    () =>
      assertTerminalReclamationScriptsFit(
        makeValidator(15_000),
        makeValidator(8_000),
        makeValidator(7_000),
        16_384,
        "terminal batch",
      ),
    Error,
    "terminal batch",
  );
});

Deno.test("a consumed reference-script input can provide its own spending witness without input overlap", async () => {
  const account = generateEmulatorAccount({ lovelace: 1_000_000_000n });
  const emulator = new Emulator([account]);
  const lucid = await Lucid(emulator, "Custom");
  lucid.selectWallet.fromSeed(account.seedPhrase);
  const validator = {
    type: "PlutusV3" as const,
    script: "4e4d01000033222220051200120011",
  };
  const validatorAddress = validatorToAddress("Custom", validator);
  const create = await lucid
    .newTx()
    .pay.ToContract(
      validatorAddress,
      { kind: "inline", value: Data.void() },
      { lovelace: 5_000_000n },
      validator,
    )
    .complete();
  const createHash = await (await create.sign.withWallet().complete()).submit();
  emulator.awaitBlock(1);
  const selfWitness = (await lucid.utxosAt(validatorAddress)).find(
    ({ txHash, scriptRef }) => txHash === createHash && scriptRef !== undefined,
  );
  assert(selfWitness);

  const spend = await lucid
    .newTx()
    // attach registers the script with Lucid/CML, while the same script carried
    // by the normal input lets CML omit it from the witness set. It must not be
    // added as a reference input because ledger input sets are disjoint.
    .attach.SpendingValidator(validator)
    .collectFrom([selfWitness], Data.void())
    .pay.ToAddress(account.address, { lovelace: 2_000_000n })
    .complete();
  const transaction = spend.toTransaction();
  const referenceInputs = transaction.body().reference_inputs();
  assertEquals(referenceInputs?.len() ?? 0, 0);
  assertEquals(transaction.witness_set().plutus_v3_scripts()?.len() ?? 0, 0);
  assert(transaction.to_cbor_bytes().length < 16_384);
  await (await spend.sign.withWallet().complete()).submit();
});

Deno.test("the actual terminal builder omits Host and carries only required attached scripts", async () => {
  const account = generateEmulatorAccount({ lovelace: 1_000_000_000n });
  const emulator = new Emulator([account]);
  const lucid = await Lucid(emulator, "Custom");
  lucid.selectWallet.fromSeed(account.seedPhrase);
  const nonce: OutputReference = {
    transaction_id: "90".repeat(32),
    output_index: 0n,
  };
  const [hostNftPolicy, hostNftPolicyId] = readValidator(
    "host_state_nft.host_state_nft.mint",
    lucid,
    [nonce],
    Data.Tuple([OutputReferenceSchema]) as unknown as [OutputReference],
  );
  const [referenceValidator, referenceValidatorHash, referenceAddress] =
    readValidator(
      "reference_validator.refer_only.else",
      lucid,
      [hostNftPolicyId],
      Data.Tuple([Data.Bytes()]) as unknown as [string],
    );
  const dummyHash = "ab".repeat(28);
  const hostParameters = [
    hostNftPolicyId,
    dummyHash,
    dummyHash,
    dummyHash,
    dummyHash,
    dummyHash,
    dummyHash,
    dummyHash,
    dummyHash,
    dummyHash,
    dummyHash,
    referenceValidatorHash,
  ] as const;
  const [hostValidator, hostValidatorHash, hostAddress] = readValidator(
    "host_state_stt.host_state_stt.spend",
    lucid,
    [...hostParameters],
    Data.Tuple(hostParameters.map(() => Data.Bytes())) as unknown as [
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
    ],
  );
  assert(
    hostValidator.script.length / 2 <= 15_434,
    `Applied HostState validator ${
      hostValidator.script.length / 2
    } bytes exceeds the 15,434-byte reference-output ceiling`,
  );
  const signer = getAddressDetails(account.address).paymentCredential;
  assert(signer?.type === "Key");
  const hostTokenName = fromText("ibc_host_state");
  const hostUnit = hostNftPolicyId + hostTokenName;
  const terminalHostReference: UTxO = {
    txHash: "71".repeat(32),
    outputIndex: 0,
    address: referenceAddress,
    assets: { lovelace: 2_000_000n },
    datum: Data.void(),
    scriptRef: hostValidator,
  };
  const terminalRoot = foldReferenceScriptInventory([{
    txHash: terminalHostReference.txHash,
    outputIndex: terminalHostReference.outputIndex,
    scriptHash: hostValidatorHash,
  }]);
  const hostDatum = {
    state: {
      version: 10n,
      ibc_state_root: "00".repeat(32),
      next_client_sequence: 0n,
      next_connection_sequence: 0n,
      next_channel_sequence: 0n,
      bound_port: new Map(),
      last_update_time: 1n,
      live_client_count: 0n,
      live_connection_count: 0n,
      live_channel_count: 0n,
    },
    nft_policy: hostNftPolicyId,
    deployer: signer.hash,
    shutdown: {
      Sealed: { sealed_at: 0n, proof_window_end: 0n },
    },
    live_reference_script_count: 1n,
    reference_script_inventory_root: terminalRoot,
    reference_script_registration: {
      target_count: 2n,
      target_root: "55".repeat(32),
      last_out_ref: {
        transaction_id: "72".repeat(32),
        output_index: 1n,
      },
    },
  };
  const hostUtxo: UTxO = {
    txHash: "70".repeat(32),
    outputIndex: 0,
    address: hostAddress,
    assets: { lovelace: 10_000_000n, [hostUnit]: 1n },
    datum: Data.to(hostDatum, HostStateDatum, { canonical: true }),
  };
  emulator.ledger[hostUtxo.txHash + hostUtxo.outputIndex] = {
    utxo: hostUtxo,
    spent: false,
  };
  emulator.ledger[
    terminalHostReference.txHash + terminalHostReference.outputIndex
  ] = { utxo: terminalHostReference, spent: false };

  emulator.evaluateTx = (tx) => {
    const redeemers = CML.Transaction.from_cbor_hex(tx)
      .witness_set()
      .redeemers()
      ?.to_flat_format();
    const tagName = (tag: CML.RedeemerTag) => {
      switch (tag) {
        case CML.RedeemerTag.Spend:
          return "spend" as const;
        case CML.RedeemerTag.Mint:
          return "mint" as const;
        default:
          throw new Error(`Unexpected terminal redeemer tag ${tag}`);
      }
    };
    return Promise.resolve(Array.from(
      { length: redeemers?.len() ?? 0 },
      (_, index) => {
        const redeemer = redeemers!.get(index);
        return {
          ex_units: { mem: 1_000_000, steps: 1_000_000 },
          redeemer_index: Number(redeemer.index()),
          redeemer_tag: tagName(redeemer.tag()),
        };
      },
    ));
  };
  const deployment = {
    schemaVersion: 6,
    hostStateNFT: {
      policyId: hostNftPolicyId,
      name: hostTokenName,
      script: hostNftPolicy.script,
    },
    referenceValidator: {
      script: referenceValidator.script,
      scriptHash: referenceValidatorHash,
      address: referenceAddress,
    },
    validators: {
      hostStateStt: {
        script: hostValidator.script,
        scriptHash: hostValidatorHash,
        address: hostAddress,
        refUtxo: {
          txHash: terminalHostReference.txHash,
          outputIndex: terminalHostReference.outputIndex,
        },
      },
    },
  } as unknown as Parameters<typeof buildTerminalShutdownTx>[1];
  const completed = await buildTerminalShutdownTx(
    lucid,
    deployment,
    hostUtxo,
    terminalHostReference,
    signer.hash,
    account.address,
    emulator.now(),
  ).complete({ localUPLCEval: false });
  const signed = await completed.sign.withWallet().complete();
  const transaction = signed.toTransaction();
  assertEquals(transaction.body().reference_inputs()?.len() ?? 0, 0);
  const inputs = transaction.body().inputs();
  assert(
    Array.from({ length: inputs.len() }, (_, index) => inputs.get(index)).some(
      (input) =>
        input.transaction_id().to_hex() === terminalHostReference.txHash &&
        Number(input.index()) === terminalHostReference.outputIndex,
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
  assertEquals(witnessHashes.has(hostNftPolicyId), true);
  assertEquals(witnessHashes.size, 2);
  assert(signed.toCBOR().length / 2 < 16_384);
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
