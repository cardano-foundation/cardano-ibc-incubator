import { assert, assertEquals, assertRejects } from "@std/assert";
import { Constr, Data, type TxBuilder } from "@lucid-evolution/lucid";
import { generateEmulatorAccount } from "@lucid-evolution/provider";
import { shutdownFixture } from "../src/testing/shutdown-fixture.ts";
import { evaluatedUpdateBudget } from "../src/tendermint-cache-routing.ts";
import { HostStateDatum, HostStateRedeemer } from "../types/index.ts";

type Mutation =
  | "none"
  | "leave-cache"
  | "leave-cache-token"
  | "short-refund"
  | "wrong-owner"
  | "no-authority";

async function retirement(mutation: Mutation) {
  // This fixture is an assumed authenticated shutdown snapshot. Every candidate
  // executes the real client, cache, mint and HostState validators together.
  const f = await shutdownFixture(0n, "cached");
  assert(f.cached && f.cache && f.cacheUnit);
  const mint = f.deployment.validators.mintClientStt;
  const spend = f.deployment.validators.spendClient;
  const host = f.deployment.validators.hostStateStt;
  const subjectUnit = mint.scriptHash + "11";
  const old = {
    ...f.hostDatum,
    control: {
      ...f.hostDatum.control,
      live_channels: 0n,
      live_connections: 0n,
    },
  };
  f.hostUtxo.datum = Data.to(old, HostStateDatum);
  const module = Data.from(f.root.datum!) as Constr<Data>;
  module.fields[0] = "00".repeat(32);
  f.root.datum = Data.to(module);
  const next = {
    ...old,
    state: { ...old.state, version: old.state.version + 1n },
    control: { ...old.control, live_clients: 0n },
  };
  const refund = f.client.assets.lovelace + f.cache.assets.lovelace;
  const other = generateEmulatorAccount({}).address;
  let tx: TxBuilder = f.lucid.newTx().readFrom([
    host.refUtxo!,
    spend.refUtxo!,
    mint.refUtxo!,
    f.cached.cacheSpend.refUtxo,
    f.cached.cacheMint.refUtxo,
    f.root,
  ]).collectFrom(
    [f.hostUtxo],
    Data.to({ RetireState: { kind: 0n, token_name: "11" } }, HostStateRedeemer),
  )
    .collectFrom([f.client], Data.to(new Constr(4, [])))
    .mintAssets({ [subjectUnit]: -1n }, Data.void())
    .pay.ToContract(f.hostUtxo.address, {
      kind: "inline",
      value: Data.to(next, HostStateDatum),
    }, f.hostUtxo.assets)
    .pay.ToAddress(mutation === "wrong-owner" ? other : f.account.address, {
      lovelace: mutation === "short-refund" ? f.client.assets.lovelace : refund,
    })
    .validFrom(f.emulator.now()).validTo(f.emulator.now() + 60_000);
  if (mutation !== "leave-cache") tx = tx.collectFrom([f.cache], Data.void());
  if (mutation !== "leave-cache" && mutation !== "leave-cache-token") {
    tx = tx.mintAssets(
      { [f.cacheUnit]: -1n },
      Data.to(new Constr(1, [f.clientToken])),
    );
  }
  if (mutation !== "no-authority") tx = tx.addSignerKey(f.hostDatum.deployer);
  const built = await tx.complete({
    localUPLCEval: true,
    changeAddress: mutation === "short-refund" || mutation === "wrong-owner"
      ? other
      : f.account.address,
  });
  const signed = await built.sign.withWallet().complete();
  assert(
    evaluatedUpdateBudget(signed, f.emulator.protocolParameters, 0)
      .withinLedger,
  );
  const balance = async () =>
    (await f.lucid.utxosAt(f.account.address)).reduce(
      (sum, u) => sum + u.assets.lovelace,
      0n,
    );
  const before = await balance();
  await signed.submit();
  f.emulator.awaitBlock();
  assertEquals((await f.lucid.utxosAt(spend.address)).length, 0);
  assertEquals((await f.lucid.utxosAt(f.cached.cacheSpend.address)).length, 0);
  assertEquals(
    await balance(),
    before + refund - signed.toTransaction().body().fee(),
  );
}

Deno.test("cached client retirement burns both identities and refunds both reserves", () =>
  retirement("none"));
for (
  const mutation of [
    "leave-cache",
    "leave-cache-token",
    "short-refund",
    "wrong-owner",
    "no-authority",
  ] as const
) {
  Deno.test(`cached client retirement rejects ${mutation}`, async () => {
    await assertRejects(
      () => retirement(mutation),
      Error,
      "failed script execution",
    );
  });
}
