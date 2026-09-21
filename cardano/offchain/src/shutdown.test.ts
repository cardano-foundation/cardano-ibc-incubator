import { assert, assertEquals, assertRejects, assertThrows } from "@std/assert";
import { Constr, Data, fromText } from "@lucid-evolution/lucid";
import {
  rejectClientReclaimMutation,
  shutdownFixture as fixture,
} from "./testing/shutdown-fixture.ts";
import {
  assertNoDeploymentState,
  assertStateDrained,
  buildReclaimEscrowTx,
  buildReclaimStateTx,
  datumFields,
  scanDeploymentState,
} from "./shutdown.ts";
import { buildReclaimRecoveryStakeTx } from "../scripts/shutdown-deployment.ts";
const record = (...fields: Data[]) => new Constr(0, fields);
const encode = (data: Data) => Data.to(data);
const EMPTY_ROOT = "00".repeat(32);

for (const clientMode of ["legacy", "staged"] as const) {
  Deno.test(`shutdown reclaims every state family and its recovery staking deposit (${clientMode})`, async () => {
    const f = await fixture(0n, clientMode);
    let groups = await scanDeploymentState(f.lucid, f.deployment);
    assertThrows(
      () => assertNoDeploymentState(groups),
      Error,
      "before removing",
    );
    const transfer = groups.find((group) => group.kind === "transfer")!;
    await f.submit(
      await buildReclaimEscrowTx(
        f.lucid,
        f.deployment,
        f.hostUtxo,
        transfer,
        f.shard,
        f.account.address,
        f.emulator.now(),
      ),
    ).catch((cause) => {
      throw new Error("Escrow cleanup failed", { cause });
    });
    for (
      const kind of [
        "channel",
        "connection",
        "client",
        "transfer",
        "module",
        "trace",
        "metadata",
      ] as const
    ) {
      groups = await scanDeploymentState(f.lucid, f.deployment);
      const group = groups.find((entry) => entry.kind === kind)!;
      const transferRoot = groups.find((entry) => entry.kind === "transfer")
        ?.utxos.find((utxo) =>
          utxo.assets[f.deployment.modules.transfer.identifier] === 1n
        );
      assert(group.utxos.length > 0);
      const refund = group.utxos.reduce(
        (total, utxo) => total + utxo.assets.lovelace,
        0n,
      );
      const before = (await f.lucid.utxosAt(f.account.address)).reduce(
        (total, utxo) => total + utxo.assets.lovelace,
        0n,
      );
      await f.submit(
        buildReclaimStateTx(
          f.lucid,
          f.deployment,
          f.hostUtxo,
          group,
          f.account.address,
          f.emulator.now(),
          transferRoot,
        ),
      ).catch((cause) => {
        throw new Error(`${kind} cleanup failed`, { cause });
      });
      assertEquals((await f.lucid.utxosAt(group.validator.address)).length, 0);
      const after = (await f.lucid.utxosAt(f.account.address)).reduce(
        (total, utxo) => total + utxo.assets.lovelace,
        0n,
      );
      assert(after > before + refund - 2_000_000n);
    }
    assertNoDeploymentState(await scanDeploymentState(f.lucid, f.deployment));
    const credential = f.deployment.validators.recoverClient!;
    assert(f.emulator.chain[credential.address].registeredStake);
    const balance = async () =>
      (await f.lucid.utxosAt(f.account.address)).reduce(
        (total, utxo) => total + utxo.assets.lovelace,
        0n,
      );
    const before = await balance();
    const body = await f.submit(
      buildReclaimRecoveryStakeTx(
        f.lucid,
        f.deployment,
        f.hostUtxo,
        f.hostDatum.deployer,
        f.emulator.now(),
      ),
    );
    // The pinned emulator only updates its stake map for pre-Conway certificates.
    // Evaluate the actual Conway deregistration and check its deposit refund.
    const certificate = body.certs()!.get(0).as_unreg_cert()!;
    assertEquals(
      certificate.stake_credential().as_script()!.to_hex(),
      credential.scriptHash,
    );
    assertEquals(
      certificate.deposit(),
      f.lucid.config().protocolParameters!.keyDeposit,
    );
    assertEquals(await balance(), before + certificate.deposit() - body.fee());
  });
}

Deno.test("shutdown blocks user deposits even when an escrow has enough ADA to pay a refund", async () => {
  const f = await fixture(1n);
  const groups = await scanDeploymentState(f.lucid, f.deployment);
  assertThrows(
    () => assertStateDrained(groups, f.deployment),
    Error,
    "user deposits",
  );
  const siblings = await f.tree.getSiblings(
    `escrowShards/${f.shardUnit.slice(56)}`,
  );
  const registration = f.hostDatum.control.port_registry.get(
    fromText("transfer"),
  )!;
  const recovery = f.deployment.validators.recoverClient!;
  const withdrawal = encode(
    new Constr(3, [
      registration.port_token.policy_id + registration.port_token.name,
      registration.module_token.policy_id + registration.module_token.name,
      f.deployment.validators.mintTransferEscrowShard.scriptHash,
    ]),
  );
  const tx = f.lucid.newTx().readFrom([
    f.hostUtxo,
    f.deployment.validators.spendTransferModule.refUtxo,
    f.deployment.validators.mintTransferEscrowShard.refUtxo,
    f.deployment.validators.recoverClient!.refUtxo,
  ])
    .collectFrom([f.root, f.shard], encode(new Constr(2, [])))
    .mintAssets(
      { [f.shardUnit]: -1n },
      encode(new Constr(1, [f.channelId, f.denom, siblings])),
    )
    .pay.ToContract(f.root.address, {
      kind: "inline",
      value: encode(record(EMPTY_ROOT)),
    }, f.root.assets)
    .pay.ToAddress(f.account.address, { lovelace: f.shard.assets.lovelace })
    .withdraw(recovery.address, 0n, withdrawal)
    .addSignerKey(f.hostDatum.deployer).validFrom(f.emulator.now());
  await assertRejects(() => tx.complete({ localUPLCEval: true }));
});

Deno.test("shutdown rejects outstanding channel packets before reclaiming dependencies", async () => {
  const f = await fixture();
  const raw = Data.from(f.channel.datum!);
  const state = datumFields(datumFields(raw, 3)[0], 9);
  state[4] = new Map([[1n, "00".repeat(32)]]);
  f.channel.datum = encode(raw);
  const groups = await scanDeploymentState(f.lucid, f.deployment);
  assertThrows(
    () => assertStateDrained(groups, f.deployment),
    Error,
    "unsettled packets",
  );
  const recovery = f.deployment.validators.recoverClient!;
  const policy = f.deployment.validators.mintChannelStt;
  const unit = Object.keys(f.channel.assets).find((unit) =>
    unit.startsWith(policy.scriptHash)
  )!;
  const tx = f.lucid.newTx()
    .readFrom([
      f.hostUtxo,
      f.deployment.validators.spendChannel.refUtxo,
      policy.refUtxo,
      recovery.refUtxo,
    ])
    .collectFrom([f.channel], encode(new Constr(10, [])))
    .mintAssets({ [unit]: -1n }, Data.void())
    .withdraw(recovery.address, 0n, encode(new Constr(2, [])))
    .pay.ToAddress(f.account.address, { lovelace: f.channel.assets.lovelace })
    .addSignerKey(f.hostDatum.deployer).validFrom(f.emulator.now());
  await assertRejects(() => tx.complete({ localUPLCEval: true }));
});

Deno.test("independent session deposits cannot veto bridge-state cleanup", async () => {
  const f = await fixture();
  const session = f.deployment.validators.spendTendermintUpdateSession;
  const sessionUnit =
    f.deployment.validators.mintTendermintUpdateSession.scriptHash + "01";
  f.seed(
    session.address,
    { lovelace: 5_000_000n, [sessionUnit]: 1n },
    Data.void(),
  );
  const groups = await scanDeploymentState(f.lucid, f.deployment);
  assert(groups.every((group) => group.validator.address !== session.address));
  assertStateDrained(groups, f.deployment);
  assertEquals((await f.lucid.utxosAt(session.address)).length, 1);
});

Deno.test("shutdown refuses an unknown client validator instead of guessing its redeemer", async () => {
  const f = await fixture();
  const group = (await scanDeploymentState(f.lucid, f.deployment)).find((
    { kind },
  ) => kind === "client")!;
  f.deployment.validators.spendClient.title = "unknown.spend";
  assertThrows(
    () =>
      buildReclaimStateTx(
        f.lucid,
        f.deployment,
        f.hostUtxo,
        group,
        f.account.address,
        f.now,
      ),
    Error,
    "Unknown client validator",
  );
});

for (
  const mutation of [
    "active",
    "grace-period",
    "missing-authority",
    "missing-burn",
    "legacy-redeemer",
    "wrong-refund",
  ] as const
) {
  Deno.test(`staged client reclaim rejects ${mutation} at ledger evaluation`, async () => {
    const f = await fixture();
    await rejectClientReclaimMutation(f, mutation);
  });
}
