import {
  assert,
  assertEquals,
  assertNotEquals,
  assertRejects,
} from "@std/assert";
import {
  Data,
  getAddressDetails,
  Lucid,
  PROTOCOL_PARAMETERS_DEFAULT,
  type UTxO,
  walletFromSeed,
} from "@lucid-evolution/lucid";
import { Emulator } from "@lucid-evolution/provider";
import { type DeploymentPlan, loadDeploymentPlan } from "./deployment-plan.ts";
import {
  loadSuccessorImplementation,
  roleValidators,
} from "./migration-plan.ts";
import {
  buildMigrationTransaction,
  readRegistry,
} from "./migration-transactions.ts";
import { generateIdentifierTokenName } from "./utils.ts";
import {
  Proposal,
  Registry,
  type RegistryRedeemer,
} from "../types/plutus/Migration.ts";
import {
  buildReferenceBatchTx,
  completeReferenceBatchTx,
} from "./deployment-transactions.ts";
import { createDeployment, DeploymentIbcTree } from "./deployment.ts";
import {
  authorizeMigration,
  inspectMigration,
  nextMigrationStep,
  prepareMigration,
} from "./migration.ts";
import {
  migrationReference,
  withMigrationReference,
} from "../../../packages/cardano-ibc-tx-builder-runtime/src/migrationRuntime.ts";
import { verifyAndInstallMigration } from "./migration-operations.ts";
import { HostStateRedeemer } from "../types/plutus/HostStateRedeemer.ts";
import {
  HostStateDatum,
  ModuleRegistration,
} from "../types/plutus/HostState.ts";

// Public test vector, never a configured production authority.
const SEED = "abandon ".repeat(11) + "about";
const START = 1_700_000_000_000;
async function fixture() {
  const address = walletFromSeed(SEED, { network: "Custom" }).address;
  const emulator = new Emulator(
    Array.from(
      { length: 12 },
      () => ({
        address,
        seedPhrase: SEED,
        privateKey: "",
        assets: { lovelace: 200_000_000n },
      }),
    ),
    { ...PROTOCOL_PARAMETERS_DEFAULT, maxTxSize: 16_384 },
  );
  emulator.time = START;
  const lucid = await Lucid(emulator, "Custom");
  lucid.selectWallet.fromSeed(SEED);
  const utxos = await lucid.wallet().getUtxos();
  const authority = getAddressDetails(address).paymentCredential!.hash;
  const outref = (index: number) => ({
    transaction_id: utxos[index].txHash,
    output_index: BigInt(utxos[index].outputIndex),
  });
  const plan = await loadDeploymentPlan(lucid, {
    hostStateNonce: outref(0),
    transferModuleNonce: outref(1),
    traceDirectoryNonce: outref(2),
    benchmarkVoucherEnabled: false,
    deployerPaymentKeyHash: authority,
    migration: {
      registryNonce: outref(3),
      governance: { signers: [authority], quorum: 1n, delay_ms: 86_400_000n },
    },
  });
  assert(
    plan.registry && plan.mintImplementationRegistry &&
      plan.implementationRegistry,
  );
  const unit = plan.registry.token.policy_id + plan.registry.token.name;
  const moduleToken = {
    policy_id: plan.mintIdentifier.hash,
    name: await generateIdentifierTokenName(plan.inputs.transferModuleNonce),
  };
  const successor = await loadSuccessorImplementation(
    lucid,
    plan,
    2n,
    moduleToken,
  );
  return {
    lucid,
    emulator,
    address,
    authority,
    utxos,
    plan,
    unit,
    moduleToken,
    successor,
  };
}

async function deployedRegistry() {
  const context = await fixture();
  const { lucid, emulator, authority, plan, unit, utxos } = context;
  const mint = await lucid.newTx().collectFrom([utxos[3]])
    .attach.MintingPolicy(plan.mintImplementationRegistry!.script).mintAssets({
      [unit]: 1n,
    }, Data.void())
    .addSignerKey(authority)
    .pay.ToContract(plan.implementationRegistry!.address, {
      kind: "inline",
      value: Data.to(plan.registry!, Registry),
    }, { [unit]: 1n, lovelace: 20_000_000n })
    .pay.ToContract(
      plan.referenceHolder.address,
      { kind: "inline", value: Data.void() },
      { lovelace: 60_000_000n },
      plan.implementationRegistry!.script,
    )
    .complete({ localUPLCEval: true });
  const signed = await mint.sign.withWallet().complete();
  await signed.submit();
  emulator.awaitBlock();
  const registry = await lucid.utxoByUnit(unit);
  const registryReference = (await lucid.utxosAt(plan.referenceHolder.address))
    .find((utxo) => utxo.scriptRef)!;
  assert(registryReference);
  return { ...context, registry, registryReference };
}

function replacement(
  context: Awaited<ReturnType<typeof fixture>>,
): RegistryRedeemer {
  return {
    Propose: {
      proposal: {
        Replace: {
          source_generation: 1n,
          nonce: 1n,
          target: context.successor.implementation,
          maximum: { clients: 4n, connections: 2n, channels: 4n },
          escrow_inventory: "00".repeat(32),
        },
      },
      expires_at: BigInt(START + 3 * 86_400_000),
    },
  };
}

Deno.test("upgrade profile round-trips the full registry and retains policies across two successors", async () => {
  const context = await fixture();
  const { plan, lucid, moduleToken, successor } = context;
  assertEquals(
    Data.from(Data.to(plan.registry!, Registry), Registry),
    plan.registry,
  );
  for (let index = 0; index < 5; index++) {
    assertNotEquals(
      successor.validators[index].hash,
      roleValidators(plan)[index].hash,
    );
  }
  const second = await loadSuccessorImplementation(
    lucid,
    {
      ...plan,
      registry: { ...plan.registry!, current: successor.implementation },
    },
    3n,
    moduleToken,
  );
  for (let index = 0; index < 5; index++) {
    assertNotEquals(
      second.validators[index].hash,
      successor.validators[index].hash,
    );
  }
  assertEquals(
    second.implementation.compatibility,
    plan.registry!.current.compatibility,
  );
  assertEquals(
    plan.mintVoucher.hash,
    plan.validators.find((entry) =>
      entry.title === "minting_voucher.mint_voucher.mint"
    )!.hash,
  );
});

Deno.test("successor preparation rejects retained dependency and module identity substitution", async () => {
  const { plan, lucid, moduleToken } = await fixture();
  await assertRejects(
    () =>
      loadSuccessorImplementation(
        lucid,
        {
          ...plan,
          verifyProof: { ...plan.verifyProof, hash: "ff".repeat(28) },
        },
        2n,
        moduleToken,
      ),
    Error,
    "compatibility digest",
  );
  await assertRejects(
    () =>
      loadSuccessorImplementation(lucid, plan, 2n, {
        ...moduleToken,
        name: "00",
      }),
    Error,
    "module identity",
  );
});

Deno.test("upgradeable reference publication fits exact signed transactions under production size limits", async (t) => {
  const inventory = await fixture();
  for (
    const validator of [
      ...roleValidators(inventory.plan),
      inventory.plan.mintChannel,
    ]
  ) {
    await t.step(validator.title, async () => {
      const { lucid, emulator, address, plan } = await fixture();
      const scripts = [validator.script];
      const { totalOutputAssets } = await buildReferenceBatchTx(
        lucid,
        plan.referenceHolder.address,
        scripts,
      ).config();
      const deposit = totalOutputAssets.lovelace + 1_500_000n;
      const funding =
        await (await lucid.newTx().pay.ToAddress(address, { lovelace: deposit })
          .complete()).sign.withWallet().complete();
      const hash = await funding.submit();
      emulator.awaitBlock();
      const dedicated = (await lucid.wallet().getUtxos()).find((utxo) =>
        utxo.txHash === hash && utxo.assets.lovelace === deposit
      )!;
      assert(dedicated);
      const { signedTx } = await completeReferenceBatchTx(
        lucid,
        plan.referenceHolder.address,
        scripts,
        dedicated,
      );
      const bytes = signedTx.toCBOR().length / 2;
      console.log(
        `${validator.title}: ${bytes} signed bytes; reference deposit ${totalOutputAssets.lovelace} lovelace`,
      );
      assert(
        bytes <= 16_384,
        `Reference publication exceeds production maxTxSize: ${bytes}`,
      );
      await signedTx.submit();
      emulator.awaitBlock();
    });
  }
});

Deno.test("actual registry policy mints and delayed governance can approve then cancel", async () => {
  const context = await deployedRegistry();
  const { lucid, emulator, unit, authority, registryReference } = context;
  const built = await buildMigrationTransaction(lucid, unit, {
    registry: context.registry,
    registryReference,
    validFrom: emulator.now(),
    validTo: emulator.now() + 60_000,
    signers: [authority],
  }, replacement(context));
  const tx = await built.tx.complete({ localUPLCEval: true });
  const signed = await tx.sign.withWallet().complete();
  console.log(
    `approve: ${
      signed.toCBOR().length / 2
    } bytes, fee ${signed.toTransaction().body().fee()} lovelace`,
  );
  await signed.submit();
  emulator.awaitBlock();
  const approved = await lucid.utxoByUnit(unit);
  assertEquals(readRegistry(approved, unit), built.next);
  const cancelled = await buildMigrationTransaction(lucid, unit, {
    registry: approved,
    registryReference,
    validFrom: emulator.now(),
    validTo: emulator.now() + 60_000,
    signers: [authority],
  }, "Cancel");
  await (await (await cancelled.tx.complete({ localUPLCEval: true })).sign
    .withWallet().complete()).submit();
  emulator.awaitBlock();
  assertEquals(readRegistry(await lucid.utxoByUnit(unit), unit).phase, "Ready");
  assertEquals(readRegistry(await lucid.utxoByUnit(unit), unit).nonce, 1n);
});

Deno.test("compiled registry rejects an approval without authority even when the builder is bypassed", async () => {
  const context = await deployedRegistry();
  const { lucid, emulator, unit, registry, registryReference, authority } =
    context;
  const action = replacement(context);
  const { next } = await buildMigrationTransaction(lucid, unit, {
    registry,
    registryReference,
    validFrom: emulator.now(),
    validTo: emulator.now() + 60_000,
    signers: [authority],
  }, action);
  const { RegistryRedeemer } = await import("../types/plutus/Migration.ts");
  const bypass = lucid.newTx().readFrom([registryReference])
    .collectFrom([registry], Data.to(action, RegistryRedeemer))
    .pay.ToContract(registry.address, {
      kind: "inline",
      value: Data.to(next, Registry),
    }, registry.assets)
    .validFrom(emulator.now()).validTo(emulator.now() + 60_000);
  await assertRejects(() => bypass.complete({ localUPLCEval: true }));
});

Deno.test("builder refuses premature execution and counterfeit registry identities", async () => {
  const context = await deployedRegistry();
  const { lucid, emulator, registry, registryReference, unit, authority } =
    context;
  const { next } = await buildMigrationTransaction(lucid, unit, {
    registry,
    registryReference,
    validFrom: emulator.now(),
    validTo: emulator.now() + 60_000,
    signers: [authority],
  }, replacement(context));
  const proposed: UTxO = { ...registry, datum: Data.to(next, Registry) };
  await assertRejects(
    () =>
      buildMigrationTransaction(lucid, unit, {
        registry: proposed,
        registryReference,
        validFrom: emulator.now(),
        validTo: emulator.now() + 60_000,
      }, "Begin"),
    Error,
    "delayed",
  );
  await assertRejects(
    () =>
      buildMigrationTransaction(lucid, "00".repeat(28) + next.token.name, {
        registry,
        registryReference,
        validFrom: emulator.now(),
        validTo: emulator.now() + 60_000,
      }, "Cancel"),
    Error,
    "authenticated registry NFT",
  );
});

Deno.test("real deployment stack bootstraps an explicitly authorized upgrade-capable baseline", async () => {
  const address = walletFromSeed(SEED, { network: "Custom" }).address;
  const authority = getAddressDetails(address).paymentCredential!.hash;
  const emulator = new Emulator(
    Array.from(
      { length: 50 },
      () => ({
        address,
        seedPhrase: SEED,
        privateKey: "",
        assets: { lovelace: 200_000_000n },
      }),
    ),
    { ...PROTOCOL_PARAMETERS_DEFAULT, maxTxSize: 16_384 },
  );
  emulator.time = Math.floor(Date.now() / 1000) * 1000;
  const submit = emulator.submitTx.bind(emulator);
  emulator.submitTx = async (cbor: string) => {
    const hash = await submit(cbor);
    emulator.awaitBlock();
    return hash;
  };
  const lucid = await Lucid(emulator, "Custom");
  lucid.selectWallet.fromSeed(SEED);
  // The provider emulator estimates budgets without executing scripts. Require
  // actual UPLC evaluation for every bootstrap and migration transaction.
  emulator.evaluateTx = () => {
    throw new Error("Provider-only evaluation is forbidden in this rehearsal");
  };
  const newTx = lucid.newTx.bind(lucid);
  lucid.newTx = () => {
    const tx = newTx();
    const complete = tx.complete.bind(tx);
    tx.complete = (options) => complete({ ...options, localUPLCEval: true });
    return tx;
  };
  let deployment = await createDeployment(lucid, "emulator", {
    migration: {
      governance: { signers: [authority], quorum: 1n, delay_ms: 86_400_000n },
      bootstrapSigners: [authority],
    },
  });
  assert(deployment.migration);
  const runtimeDeployment = () => {
    assert(deployment.hostStateNFT);
    return { ...deployment, hostStateNFT: deployment.hostStateNFT };
  };
  const registryUtxo = await lucid.utxoByUnit(
    deployment.migration.registryUnit,
  );
  const registry = readRegistry(
    registryUtxo,
    deployment.migration.registryUnit,
  );
  assertEquals(registry.phase, "Ready");
  assertEquals(registry.current.generation, 1n);
  assertEquals(
    (await lucid.utxoByUnit(deployment.modules.transfer.identifier)).address,
    deployment.validators.spendTransferModule.address,
  );
  const heartbeat = async (window: number) => {
    const hostUtxo = await lucid.utxoByUnit(
      deployment.hostStateNFT!.policyId + deployment.hostStateNFT!.name,
    );
    const host = Data.from(hostUtxo.datum!, HostStateDatum);
    host.state.version += 1n;
    host.state.last_update_time = BigInt(emulator.now() + window);
    const tx = await withMigrationReference(
      lucid,
      lucid.newTx(),
      runtimeDeployment(),
    );
    return tx.readFrom([deployment.validators.hostStateStt.refUtxo])
      .collectFrom([hostUtxo], Data.to("Heartbeat", HostStateRedeemer))
      .pay.ToContract(hostUtxo.address, {
        kind: "inline",
        value: Data.to(host, HostStateDatum, { canonical: true }),
      }, hostUtxo.assets)
      .validFrom(emulator.now()).validTo(emulator.now() + window).addSignerKey(
        authority,
      );
  };
  // Valid before the release, rejected by the successor's new code constraint.
  await (await heartbeat(7_200_000)).complete({ localUPLCEval: true });
  const releasePaths = [
    Deno.env.get("MIGRATION_SUCCESSOR_V2_BLUEPRINT"),
    Deno.env.get("MIGRATION_SUCCESSOR_V3_BLUEPRINT"),
  ];
  if (releasePaths.some(Boolean) && !releasePaths.every(Boolean)) {
    throw new Error("Both rehearsal successor blueprints are required");
  }
  for (const generation of [2n, 3n]) {
    lucid.overrideUTxOs([]);
    const releasePath = releasePaths[Number(generation - 2n)];
    const release = releasePath
      ? JSON.parse(await Deno.readTextFile(releasePath))
      : undefined;
    const artifact = await prepareMigration(lucid, deployment, release);
    const { registry: current } = await inspectMigration(lucid, deployment);
    const hostUnit = current.host_policy + "6962635f686f73745f7374617465";
    const before = Data.from(
      (await lucid.utxoByUnit(hostUnit)).datum!,
      HostStateDatum,
    );
    const tree = new DeploymentIbcTree();
    for (const [port, registration] of before.control.port_registry) {
      tree.set(
        `ports/${
          new TextDecoder().decode(
            Uint8Array.from(
              port.match(/../g)!.map((byte) => parseInt(byte, 16)),
            ),
          )
        }`,
        Data.to(registration, ModuleRegistration),
      );
    }
    assertEquals(await tree.getRoot(), before.state.ibc_state_root);
    const { bech32Address } = await import("../types/plutus/Migration.ts");
    const referenceAddress = bech32Address(
      "Custom",
      current.identity.reference_holder,
    );
    for (const validator of artifact.validators) {
      const scripts = [validator.script];
      const { totalOutputAssets } = await buildReferenceBatchTx(
        lucid,
        referenceAddress,
        scripts,
      ).config();
      const funding = await (await lucid.newTx().pay.ToAddress(address, {
        lovelace: totalOutputAssets.lovelace + 1_500_000n,
      }).complete()).sign.withWallet().complete();
      const hash = await funding.submit();
      lucid.overrideUTxOs([]);
      const dedicated = (await lucid.wallet().getUtxos()).find((utxo) =>
        utxo.txHash === hash &&
        utxo.assets.lovelace === totalOutputAssets.lovelace + 1_500_000n
      )!;
      const { signedTx } = await completeReferenceBatchTx(
        lucid,
        referenceAddress,
        scripts,
        dedicated,
      );
      await signedTx.submit();
      lucid.overrideUTxOs([]);
    }
    const approved = await authorizeMigration(lucid, deployment, artifact, {
      validFrom: emulator.now(),
      validTo: emulator.now() + 60_000,
      expiresAt: BigInt(emulator.now() + 3 * 86_400_000),
    }, [authority]);
    await (await (await approved.tx.complete({ localUPLCEval: true })).sign
      .withWallet().complete()).submit();
    assert(await migrationReference(lucid, runtimeDeployment()));
    await assertRejects(
      () => migrationReference(lucid, runtimeDeployment(), true),
      Error,
      "New state objects are paused",
    );
    emulator.awaitSlot(86_500);
    let steps = 0;
    while (true) {
      lucid.overrideUTxOs([]);
      const step = await nextMigrationStep(lucid, deployment, artifact, {
        validFrom: emulator.now(),
        validTo: emulator.now() + 60_000,
      }, await tree.getSiblings("ports/transfer"));
      if (step.complete) break;
      console.log(
        `building migration generation ${generation}: ${
          typeof step.action === "string"
            ? step.action
            : Object.keys(step.action)[0]
        }`,
      );
      const signed = await (await step.tx.complete({ localUPLCEval: true }))
        .sign.withWallet().complete();
      console.log(
        `generation ${generation}, ${
          typeof step.action === "string"
            ? step.action
            : Object.keys(step.action)[0]
        }: ${
          signed.toCBOR().length / 2
        } bytes, fee ${signed.toTransaction().body().fee()} lovelace`,
      );
      await signed.submit();
      if (step.action === "Begin") {
        await assertRejects(
          () => migrationReference(lucid, runtimeDeployment()),
          Error,
          "migration is in progress",
        );
      }
      assert(++steps <= 3);
    }
    assertEquals(steps, 3);
    const after = Data.from(
      (await lucid.utxoByUnit(hostUnit)).datum!,
      HostStateDatum,
    );
    assertEquals(after.nft_policy, before.nft_policy);
    assertEquals(after.state.version, before.state.version + 2n);
    assertEquals(
      (await inspectMigration(lucid, deployment)).registry.current.generation,
      generation,
    );
    assertNotEquals(
      after.control.port_registry.get("7472616e73666572")!.module_script_hash,
      before.control.port_registry.get("7472616e73666572")!.module_script_hash,
    );
    await assertRejects(
      () => migrationReference(lucid, runtimeDeployment()),
      Error,
      "Stale implementation manifest",
    );
    for (
      const field of [
        "mintVoucher",
        "spendTendermintUpdateSession",
        "verifyProof",
      ] as const
    ) {
      const substituted = structuredClone(deployment);
      substituted.validators[field].scriptHash = "ff".repeat(28);
      await assertRejects(
        () => verifyAndInstallMigration(lucid, substituted, artifact),
        Error,
        `Substituted retained manifest field ${field}`,
      );
    }
    const substitutedModule = structuredClone(deployment);
    substitutedModule.modules.transfer.identifier = "ff".repeat(32);
    await assertRejects(
      () => verifyAndInstallMigration(lucid, substitutedModule, artifact),
      Error,
      "Substituted application capability transfer",
    );
    const substitutedAlias = structuredClone(deployment);
    const aliasBaseline = substitutedAlias.migration!
      .baseline as DeploymentPlan;
    aliasBaseline.sessionSpend = aliasBaseline.recoverClient;
    await assertRejects(
      () => verifyAndInstallMigration(lucid, substitutedAlias, artifact),
      Error,
      "Substituted baseline alias sessionSpend",
    );
    const verified = await verifyAndInstallMigration(
      lucid,
      deployment,
      artifact,
    );
    deployment = verified.deployment;
    assertEquals(verified.evidence.generation, generation.toString());
    assert(await migrationReference(lucid, runtimeDeployment()));
    if (release) {
      await assertRejects(
        async () =>
          (await heartbeat(7_200_000)).complete({ localUPLCEval: true }),
        Error,
        "failed script execution",
      );
    }
    await (await (await (await heartbeat(60_000)).complete({
      localUPLCEval: true,
    })).sign.withWallet().complete()).submit();
    const forged = structuredClone(artifact);
    const forgedProposal = Data.from(forged.proposal, Proposal);
    assert("Replace" in forgedProposal);
    forgedProposal.Replace.nonce += 100n;
    forged.proposal = Data.to(forgedProposal, Proposal);
    await assertRejects(
      () =>
        nextMigrationStep(lucid, deployment, forged, {
          validFrom: emulator.now(),
          validTo: emulator.now() + 60_000,
        }),
      Error,
      "No approved migration",
    );
    // Eager attachment survives Lucid composition and its alternative completion API.
    const child = await withMigrationReference(
      lucid,
      lucid.newTx(),
      runtimeDeployment(),
    );
    const ordinary = await lucid.newTx().compose(child).pay.ToAddress(address, {
      lovelace: 2_000_000n,
    }).completeSafe({ localUPLCEval: true });
    assert(ordinary._tag === "Right");
    assertEquals(
      ordinary.right.toTransaction().body().reference_inputs()!.len(),
      1,
    );
  }
});
