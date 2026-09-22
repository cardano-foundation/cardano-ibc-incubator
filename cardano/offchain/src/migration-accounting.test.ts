import { assert, assertEquals, assertRejects, assertThrows } from "@std/assert";
import {
  Constr,
  Data,
  type TxBuilder,
  type UTxO,
} from "@lucid-evolution/lucid";
import {
  HostStateDatum,
  ModuleRegistration,
} from "../types/plutus/HostState.ts";
import {
  Registry,
  RegistryRedeemer,
  type RegistryRedeemer as Action,
} from "../types/plutus/Migration.ts";
import { MIGRATION_SPEND } from "./migration-transactions.ts";
import {
  type AccountingFixture,
  accountingFixture,
  AccountingOracle,
  EMPTY,
  oracleRoot,
} from "./testing/migration-accounting.ts";

function random(seed: number) {
  let state = seed | 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return state >>> 0;
  };
}

Deno.test("independent economic oracle preserves pending liabilities across partial moves and rejects duplicate settlement", () => {
  for (const seed of [408, 462, 631, 681, 737, 0x12345678]) {
    const next = random(seed);
    const model = new AccountingOracle();
    // Both transfer directions, native success/refund and remote burn/return.
    for (let n = 0; n < 20; n++) {
      const amount = BigInt(1 + next() % 1000);
      const id = `${seed}/native/${n}`;
      model.sendNative(id, amount);
      if (n % 3 !== 0) {
        const success = n % 2 === 0;
        model.settle(id, success);
        assertThrows(
          () => model.settle(id, !success),
          Error,
          "already settled",
        );
        if (success) {
          model.burnRemoteNative(`${id}/return`, amount);
          if (n % 4 === 0) model.settle(`${id}/return`, n % 8 === 0);
        }
      }
      model.receiveForeign(`${seed}/foreign/${n}`, amount);
      assertThrows(
        () => model.receiveForeign(`${seed}/foreign/${n}`, amount),
        Error,
        "duplicate",
      );
    }
    // A second burn with the same packet ID must fail even with ample balance.
    model.burnForeign(`${seed}/duplicate-burn`, 1n);
    assertThrows(
      () => model.burnForeign(`${seed}/duplicate-burn`, 1n),
      Error,
      "duplicate",
    );
    model.settle(`${seed}/duplicate-burn`, false);
    assertThrows(
      () => model.settle(`${seed}/duplicate-burn`, false),
      Error,
      "already settled",
    );
    // Zero circulating supply still leaves a refund obligation for a pending burn.
    const burned = model.cardanoForeignVouchers;
    model.burnForeign(`${seed}/return-all`, burned);
    assertEquals(model.cardanoForeignVouchers, 0n);
    assert(model.foreignBacking > 0n);
    assertThrows(
      () => model.burnForeign(`${seed}/return-all`, 1n),
      Error,
      "insufficient",
    );
    const frozen = model.economicSnapshot();
    const objects = Array.from(
      { length: 2 + next() % 9 },
      (_, n) => `object-${n}`,
    );
    model.begin(objects);
    for (const id of objects.sort(() => (next() & 1) ? 1 : -1)) {
      assertThrows(() => model.activate(), Error, "unfinished");
      assertThrows(
        () => model.receiveForeign("late-mint", 1n),
        Error,
        "frozen",
      );
      assertThrows(() => model.burnForeign("late-burn", 1n), Error, "frozen");
      assertThrows(() => model.sendNative("late-send", 1n), Error, "frozen");
      assertThrows(
        () => model.settle(`${seed}/return-all`, false),
        Error,
        "frozen",
      );
      model.move(id);
      assertThrows(() => model.move(id), Error, "already migrated");
      assertEquals(
        model.economicSnapshot(),
        frozen,
        `seed ${seed}: moving ${id} changed obligations`,
      );
    }
    model.activate();
    model.settle(`${seed}/return-all`, false);
    assertEquals(model.cardanoForeignVouchers, burned);
    assertThrows(
      () => model.settle(`${seed}/return-all`, false),
      Error,
      "already settled",
    );
    for (const id of [...model.pending.keys()]) {
      model.settle(id, (next() & 1) === 0);
    }
    model.check();
    const saved = model.nativeEscrow;
    model.nativeEscrow--;
    assertThrows(() => model.check(), Error, "backing mismatch");
    model.nativeEscrow = saved;
    model.check();
  }
});

async function accepted(tx: TxBuilder) {
  const complete = await tx.complete({ localUPLCEval: true });
  assert(complete.toTransaction().witness_set().redeemers());
  return complete;
}
async function rejected(tx: TxBuilder) {
  // Builder errors or ledger conservation errors are not script rejection evidence.
  await assertRejects(
    () => tx.complete({ localUPLCEval: true }),
    Error,
    "failed script execution",
  );
}
function rawMove(
  f: AccountingFixture,
  object: UTxO,
  reference: UTxO,
  action: Action,
  next: Registry,
  outputs: Array<
    { address: string; assets: Record<string, bigint>; datum: string }
  >,
  extraInputs: UTxO[] = [],
  registry = f.registry,
) {
  let tx = f.lucid.newTx().readFrom([f.registryReference, reference])
    .collectFrom([registry], Data.to(action, RegistryRedeemer))
    .collectFrom([object, ...extraInputs], MIGRATION_SPEND)
    .pay.ToContract(registry.address, {
      kind: "inline",
      value: Data.to(next, Registry),
    }, { ...registry.assets })
    .validFrom(f.emulator.now()).validTo(f.emulator.now() + 60_000);
  for (const output of outputs) {
    tx = tx.pay.ToContract(output.address, {
      kind: "inline",
      value: output.datum,
    }, output.assets);
  }
  return tx;
}

const escrowAttacks = [
  "divert-principal",
  "sweep-reserve",
  "change-principal-datum",
  "change-denom",
  "change-channel",
  "remove-nft",
  "skip-inventory",
  "double-satisfaction",
  "extra-mint",
  "extra-burn",
] as const;
Deno.test("seeded compiled escrow migration rejects balanced accounting attacks, each with a valid builder control", async (t) => {
  for (const attack of escrowAttacks) {
    await t.step(attack, async () => {
      const f = await accountingFixture();
      const shard = f.shards[1];
      const action: Action = {
        MoveEscrow: { siblings: await f.inventoryTree.getSiblings(shard.key) },
      };
      const positive = await f.build(shard.utxo, f.transferReference, action);
      await accepted(positive.tx);
      const next = structuredClone(positive.next);
      let datum = shard.utxo.datum!;
      const assets = { ...shard.utxo.assets };
      const extra: UTxO[] = [];
      if (attack === "divert-principal") assets[f.nativeUnit]--;
      if (attack === "sweep-reserve") assets.lovelace -= 1_000_000n;
      if (attack.startsWith("change-")) {
        const decoded = Data.from(datum) as Constr<Data>;
        if (attack === "change-principal-datum") {
          decoded.fields[2] = shard.amount - 1n;
        }
        if (attack === "change-denom") decoded.fields[1] = "6c6f76656c616365";
        if (attack === "change-channel") {
          decoded.fields[0] = "6368616e6e656c2d31";
        }
        datum = Data.to(decoded);
      }
      if (attack === "remove-nft") delete assets[shard.nft];
      if (attack === "skip-inventory") {
        assert(typeof next.phase === "object" && "Moving" in next.phase);
        next.phase.Moving.escrow_remaining = EMPTY;
      }
      if (attack === "double-satisfaction") {
        extra.push(f.shards[0].utxo);
        for (
          const [unit, quantity] of Object.entries(extra[0].assets)
        ) assets[unit] = (assets[unit] ?? 0n) + quantity;
      }
      let malicious = rawMove(
        f,
        shard.utxo,
        f.transferReference,
        action,
        next,
        [{ address: f.targetTransfer, assets, datum }],
        extra,
      );
      if (attack === "extra-mint" || attack === "extra-burn") {
        // Always-succeed production mock policy isolates the registry's no-mint rule.
        // This establishes the blanket barrier, not voucher-policy correctness.
        malicious = malicious.attach.MintingPolicy(f.plan.mockToken.script)
          .mintAssets(
            { [f.sideUnit]: attack === "extra-mint" ? 1n : -1n },
            Data.void(),
          );
      }
      await rejected(malicious);
    });
  }
});

Deno.test("seeded compiled channel migration rejects deletion of pending commitments", async () => {
  const f = await accountingFixture(631);
  const action: Action = { MoveCore: { role: 3n } };
  const positive = await f.build(f.channel, f.channelReference, action);
  await accepted(positive.tx);
  const decoded = Data.from(f.channel.datum!) as Constr<Data>;
  (decoded.fields[0] as Constr<Data>).fields[4] = new Map();
  await rejected(
    rawMove(f, f.channel, f.channelReference, action, positive.next, [{
      address: f.successor.validators[3].address,
      assets: { ...f.channel.assets },
      datum: Data.to(decoded),
    }]),
  );
});

Deno.test("seeded compiled partial migration preserves all obligations, rejects replay, and changes only the port commitment on activation", async (t) => {
  for (const seed of [462, 737]) {
    await t.step(`seed ${seed}`, async () => {
      const f = await accountingFixture(seed);
      const originals = new Map<string, UTxO>([
        [f.channelUnit, f.channel],
        [
          f.registration.module_token.policy_id +
          f.registration.module_token.name,
          f.root,
        ],
        ...f.shards.map((shard) => [shard.nft, shard.utxo] as [string, UTxO]),
      ]);
      assertEquals(oracleRoot(f.inventory), await f.inventoryTree.getRoot());
      assertEquals(oracleRoot(f.committed), f.hostDatum.state.ibc_state_root);
      const remaining = new Map(f.inventory);
      let registry = f.registry;
      const moved = new Set<string>();
      let replayChecked = false;
      const order = seed === 462
        ? ["shard1", "channel", "root", "shard0"]
        : ["root", "shard0", "shard1", "channel"];
      for (const objectName of order) {
        f.lucid.clearUTxOOverride();
        const shard = objectName.startsWith("shard")
          ? f.shards[Number(objectName.slice(-1))]
          : undefined;
        const object = shard?.utxo ??
          (objectName === "root" ? f.root : f.channel);
        const reference = objectName === "channel"
          ? f.channelReference
          : f.transferReference;
        const action: Action = shard
          ? {
            MoveEscrow: {
              siblings: await f.inventoryTree.getSiblings(shard.key),
            },
          }
          : objectName === "root"
          ? "MoveTransferRoot"
          : { MoveCore: { role: 3n } };
        const built = await f.build(object, reference, action, registry);
        const signed = await (await accepted(built.tx)).sign.withWallet()
          .complete();
        await signed.submit();
        f.emulator.awaitBlock();
        registry = await f.lucid.utxoByUnit(f.registryUnit);
        assertEquals(Data.from(registry.datum!, Registry), built.next);
        if (shard) {
          remaining.delete(shard.key);
          f.inventoryTree.set(shard.key, "");
          assert(
            typeof built.next.phase === "object" &&
              "Moving" in built.next.phase,
          );
          assertEquals(
            built.next.phase.Moving.escrow_remaining,
            oracleRoot(remaining),
          );
        }
        const unit = shard?.nft ??
          (objectName === "root"
            ? f.registration.module_token.policy_id +
              f.registration.module_token.name
            : f.channelUnit);
        moved.add(unit);
        for (const [token, original] of originals) {
          const actual = await f.lucid.utxoByUnit(token);
          assertEquals(
            actual.assets,
            original.assets,
            `seed ${seed}: assets ${token}`,
          );
          assertEquals(
            actual.datum,
            original.datum,
            `seed ${seed}: datum ${token}`,
          );
          assertEquals(
            actual.address,
            moved.has(token)
              ? token === f.channelUnit
                ? f.successor.validators[3].address
                : f.targetTransfer
              : original.address,
          );
        }
        assertEquals(
          (await f.lucid.utxoByUnit(f.hostUnit)).datum,
          f.host.datum,
        );
        const voucherSupply = Object.values(f.emulator.ledger).filter((entry) =>
          !entry.spent
        ).reduce(
          (sum, entry) => sum + (entry.utxo.assets[f.voucherUnit] ?? 0n),
          0n,
        );
        assertEquals(voucherSupply, f.supply);
        if (!replayChecked && shard) {
          replayChecked = true;
          // Ledger replay rejection and script-level replay are separate assertions.
          await assertRejects(() => signed.submit());
          const movedShard = await f.lucid.utxoByUnit(shard.nft);
          await rejected(
            rawMove(
              f,
              movedShard,
              f.reference(f.successor.validators[4].script),
              action,
              built.next,
              [{
                address: f.targetTransfer,
                assets: movedShard.assets,
                datum: movedShard.datum!,
              }],
              [],
              registry,
            ),
          );
        }
        if (moved.size < originals.size) {
          await assertRejects(
            () =>
              f.build(f.host, f.successorHostReference, {
                Activate: { port_siblings: [] },
              }, registry),
            Error,
            "incomplete",
          );
        }
      }
      f.lucid.clearUTxOOverride();
      const activation = await f.build(f.host, f.successorHostReference, {
        Activate: {
          port_siblings: await f.ibcTree.getSiblings("ports/transfer"),
        },
      }, registry);
      const signed = await (await accepted(activation.tx)).sign.withWallet()
        .complete();
      await signed.submit();
      f.emulator.awaitBlock();
      const host = Data.from(
        (await f.lucid.utxoByUnit(f.hostUnit)).datum!,
        HostStateDatum,
      );
      const expectedRegistration = {
        ...f.registration,
        module_script_hash: f.successor.validators[4].hash,
      };
      f.committed.set(
        "ports/transfer",
        Data.to(expectedRegistration, ModuleRegistration),
      );
      assertEquals(host.state.ibc_state_root, oracleRoot(f.committed));
      assertEquals(host, {
        ...f.hostDatum,
        state: {
          ...f.hostDatum.state,
          version: f.hostDatum.state.version + 1n,
          last_update_time: host.state.last_update_time,
          ibc_state_root: oracleRoot(f.committed),
        },
        control: {
          ...f.hostDatum.control,
          port_registry: new Map([["7472616e73666572", expectedRegistration]]),
        },
      });
      assertEquals(
        Data.from((await f.lucid.utxoByUnit(f.registryUnit)).datum!, Registry)
          .phase,
        "Ready",
      );
      assertEquals(
        (await f.lucid.utxoByUnit(f.channelUnit)).datum,
        f.channel.datum,
      );
      assertEquals(
        (await f.lucid.utxoByUnit(
          f.registration.module_token.policy_id +
            f.registration.module_token.name,
        )).datum,
        f.root.datum,
      );
    });
  }
});
