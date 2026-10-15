import { assert, assertEquals, assertRejects } from "@std/assert";
import {
  Data,
  getAddressDetails,
  Lucid,
  PROTOCOL_PARAMETERS_DEFAULT,
  walletFromSeed,
} from "@lucid-evolution/lucid";
import { Emulator } from "@lucid-evolution/provider";
import { createDeployment } from "./deployment.ts";
import {
  createCardanoScalusEvaluator,
  customEmulatorSlotConfig,
} from "./scalus-evaluator.ts";
import { migrationControl } from "./migration-operations.ts";
import { accountingFixture } from "./testing/migration-accounting.ts";
import {
  buildMigrationTransaction,
  readRegistry,
} from "./migration-transactions.ts";
import { HostStateDatum } from "../types/plutus/HostState.ts";
import { HostStateRedeemer } from "../types/plutus/HostStateRedeemer.ts";
import { Registry, RegistryRedeemer } from "../types/plutus/Migration.ts";

// Public vectors: deployer, two governors, successor and emergency authority.
const seeds = [
  "abandon ".repeat(11) + "about",
  "legal winner thank year wave sausage worth useful legal winner thank yellow",
  "letter advice cage absurd amount doctor acoustic avoid letter advice cage above",
  "ozone drill grab fiber curtain grace pudding thank cruise elder eight picnic",
  "zoo ".repeat(11) + "wrong",
];
Deno.test("compiled governance graduates the deployer without its signature and preserves bridge state", async () => {
  const wallets = seeds.map((seed) =>
    walletFromSeed(seed, { network: "Custom" })
  );
  const keys = wallets.map((wallet) =>
    getAddressDetails(wallet.address).paymentCredential!.hash
  );
  const emulator = new Emulator(
    wallets.map((wallet, i) => ({
      address: wallet.address,
      seedPhrase: seeds[i],
      privateKey: "",
      assets: { lovelace: 10_000_000_000n },
    })),
    { ...PROTOCOL_PARAMETERS_DEFAULT, maxTxSize: 16384 },
  );
  emulator.time = 1_700_000_000_000;
  const lucid = await Lucid(emulator, "Custom", {
    evaluator: createCardanoScalusEvaluator(),
    slotConfig: customEmulatorSlotConfig(emulator),
  });
  lucid.selectWallet.fromSeed(seeds[0]);
  const realNow = Date.now;
  Date.now = () => emulator.now();
  const newTx = lucid.newTx.bind(lucid);
  lucid.newTx = () => {
    const tx = newTx();
    const complete = tx.complete.bind(tx);
    tx.complete = (options) => complete({ ...options, localUPLCEval: true });
    return tx;
  };
  const originalSubmit = emulator.submitTx.bind(emulator);
  emulator.submitTx = async (cbor) => {
    assert(cbor.length / 2 <= 16384);
    const hash = await originalSubmit(cbor);
    emulator.awaitBlock();
    return hash;
  };
  try {
    const deployment = await createDeployment(lucid, "emulator", {
      deploymentMode: "upgradeable",
      migration: {
        governance: {
          signers: [keys[1], keys[2]],
          quorum: 2n,
          delay_ms: 86_400_000n,
        },
        emergency: { signers: [keys[4]], quorum: 1n },
        bootstrapSigners: [keys[1], keys[2]],
        signRegistryBootstrap: (tx) =>
          tx.sign.withWallet().sign.withPrivateKey(wallets[1].paymentKey).sign
            .withPrivateKey(wallets[2].paymentKey).complete(),
      },
    });
    assert(deployment.migration && deployment.hostStateNFT);
    const unit = deployment.migration.registryUnit;
    const hostUnit = deployment.hostStateNFT.policyId +
      deployment.hostStateNFT.name;
    const beforeUtxo = await lucid.utxoByUnit(hostUnit);
    const before = Data.from(beforeUtxo.datum!, HostStateDatum);
    const beforeRegistry = readRegistry(await lucid.utxoByUnit(unit), unit);
    const timing = () => ({
      validFrom: emulator.now(),
      validTo: emulator.now() + 1000,
    });
    const proposal: RegistryRedeemer = {
      Propose: {
        proposal: {
          NominateDeployer: {
            nonce: beforeRegistry.nonce + 1n,
            source_generation: beforeRegistry.current.generation,
            successor: keys[3],
          },
        },
        expires_at: BigInt(emulator.now() + 3 * 86_400_000),
      },
    };
    await assertRejects(
      () => migrationControl(lucid, deployment, proposal, timing(), [keys[0]]),
      Error,
      "governance quorum",
    );
    lucid.selectWallet.fromSeed(seeds[1]);
    lucid.clearUTxOOverride();
    const registryUtxo = await lucid.utxoByUnit(unit);
    assert(typeof proposal === "object" && "Propose" in proposal);
    const next: Registry = {
      ...beforeRegistry,
      nonce: beforeRegistry.nonce + 1n,
      phase: {
        Proposed: {
          proposal: proposal.Propose.proposal,
          ready_at: BigInt(emulator.now() + 1000) +
            beforeRegistry.governance.delay_ms,
          expires_at: proposal.Propose.expires_at,
        },
      },
    };
    // Bypass offchain quorum validation and evaluate the real registry script.
    await assertRejects(
      () =>
        lucid.newTx()
          .readFrom([deployment.migration!.registryReference])
          .collectFrom([registryUtxo], Data.to(proposal, RegistryRedeemer))
          .pay.ToContract(registryUtxo.address, {
            kind: "inline",
            value: Data.to(next, Registry),
          }, registryUtxo.assets)
          .addSignerKey(keys[1]).validFrom(emulator.now()).validTo(
            emulator.now() + 1000,
          ).complete(),
      Error,
      "failed script execution",
    );
    const approval = await migrationControl(
      lucid,
      deployment,
      proposal,
      timing(),
      [keys[1], keys[2]],
    );
    await (await (await approval.tx.complete()).sign.withWallet().sign
      .withPrivateKey(wallets[2].paymentKey).complete()).submit();
    lucid.clearUTxOOverride();
    await assertRejects(
      () => migrationControl(lucid, deployment, "GraduateDeployer", timing()),
      Error,
      "delayed or expired",
    );
    emulator.awaitSlot(86_402);
    lucid.selectWallet.fromSeed(seeds[3]);
    lucid.clearUTxOOverride();
    const execute = await migrationControl(
      lucid,
      deployment,
      "GraduateDeployer",
      timing(),
    );
    await (await (await execute.tx.complete()).sign.withWallet().complete())
      .submit();
    lucid.clearUTxOOverride();
    const afterUtxo = await lucid.utxoByUnit(hostUnit);
    const after = Data.from(afterUtxo.datum!, HostStateDatum);
    assertEquals(after, {
      ...before,
      deployer: keys[3],
      state: { ...before.state, version: before.state.version + 1n },
    });
    assertEquals(afterUtxo.assets, beforeUtxo.assets);
    assertEquals(afterUtxo.address, beforeUtxo.address);
    assertEquals(readRegistry(await lucid.utxoByUnit(unit), unit), {
      ...beforeRegistry,
      nonce: beforeRegistry.nonce + 1n,
    });
    await assertRejects(
      () => migrationControl(lucid, deployment, "GraduateDeployer", timing()),
      Error,
      "No approved plan",
    );
    await assertRejects(
      () =>
        migrationControl(lucid, deployment, proposal, timing(), [
          keys[1],
          keys[2],
        ]),
      Error,
      "Stale approval nonce",
    );
    const heartbeat = async (
      key: string,
      redeemer: HostStateRedeemer = "Heartbeat",
    ) => {
      const host = await lucid.utxoByUnit(hostUnit);
      const datum = Data.from(host.datum!, HostStateDatum);
      return lucid.newTx().readFrom([
        await lucid.utxoByUnit(unit),
        deployment.validators.hostStateStt.refUtxo,
      ])
        .collectFrom([host], Data.to(redeemer, HostStateRedeemer))
        .pay.ToContract(host.address, {
          kind: "inline",
          value: Data.to(
            {
              ...datum,
              state: {
                ...datum.state,
                version: datum.state.version + 1n,
                last_update_time: BigInt(emulator.now()),
              },
            },
            HostStateDatum,
            { canonical: true },
          ),
        }, host.assets)
        .addSignerKey(key).validFrom(emulator.now()).validTo(
          emulator.now() + 1000,
        ).complete();
    };
    lucid.selectWallet.fromSeed(seeds[0]);
    lucid.clearUTxOOverride();
    await assertRejects(
      () => heartbeat(keys[0]),
      Error,
      "failed script execution",
    );
    lucid.selectWallet.fromSeed(seeds[3]);
    lucid.clearUTxOOverride();
    await assertRejects(
      () => heartbeat(keys[3], "ClaimBackup"),
      Error,
      "failed script execution",
    );
    await (await (await heartbeat(keys[3])).sign.withWallet().complete())
      .submit();
    // Becoming admin does not make the successor a migration governor.
    await assertRejects(
      () => migrationControl(lucid, deployment, proposal, timing(), [keys[3]]),
      Error,
      "governance quorum",
    );
  } finally {
    Date.now = realNow;
  }
});

Deno.test("compiled graduation preserves populated escrow, vouchers and pending packet objects", async () => {
  for (const size of [2, 8]) {
    // Seeded existing state, not a claim to exercise packet creation. Both
    // handover transactions execute the actual compiled validators.
    const f = await accountingFixture(829, {
      escrowShards: size,
      channelCount: 2n,
      populateAllChannels: true,
      packetEntries: size,
    });
    const { lucid, emulator, plan } = f;
    assert(plan.registry);
    f.host.address = plan.hostState.address;
    f.registry.datum = Data.to(plan.registry, Registry);
    const hostReference = f.reference(plan.hostState.script);
    const before = structuredClone(f.hostDatum);
    const protectedObjects = structuredClone([
      f.root,
      ...f.shards.map((shard) => shard.utxo),
      ...f.channels,
    ]);
    const submit = async (action: RegistryRedeemer, execution = false) => {
      const built = await buildMigrationTransaction(lucid, f.registryUnit, {
        registry: await lucid.utxoByUnit(f.registryUnit),
        registryReference: f.registryReference,
        object: execution ? await lucid.utxoByUnit(f.hostUnit) : undefined,
        objectReference: execution ? hostReference : undefined,
        signers: execution ? [] : plan.registry!.governance.signers,
        validFrom: emulator.now(),
        validTo: emulator.now() + 1000,
      }, action);
      const signed = await (await built.tx.complete({ localUPLCEval: true }))
        .sign.withWallet().complete();
      assert(signed.toCBOR().length / 2 <= 16384);
      await signed.submit();
      emulator.awaitBlock();
      lucid.clearUTxOOverride();
    };
    await submit({
      Propose: {
        proposal: {
          NominateDeployer: {
            nonce: 1n,
            source_generation: 1n,
            successor: "44".repeat(28),
          },
        },
        expires_at: BigInt(emulator.now() + 3 * 86_400_000),
      },
    });
    emulator.awaitSlot(86_402);
    await submit("GraduateDeployer", true);
    const after = await lucid.utxoByUnit(f.hostUnit);
    assertEquals(Data.from(after.datum!, HostStateDatum), {
      ...before,
      deployer: "44".repeat(28),
      state: { ...before.state, version: before.state.version + 1n },
    });
    assertEquals(after.assets, f.host.assets);
    for (const object of protectedObjects) {
      assertEquals(await lucid.utxosByOutRef([object]), [object]);
    }
  }
});
