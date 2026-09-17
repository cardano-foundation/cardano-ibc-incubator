import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import { Emulator } from "@lucid-evolution/provider";
import { Lucid, walletFromSeed } from "@lucid-evolution/lucid";
import { migrationSubmitter } from "../src/migration-submission.ts";
import { parseMigrationArgs } from "./migrate-deployment.ts";

Deno.test("migration CLI requires explicit artifacts, funding and bounded execution", () => {
  for (
    const args of [
      [],
      ["prepare", "--handler", "original.json", "--out", "new.json"],
      ["execute", "--handler", "original.json", "--submit"],
      ["publish", "--handler", "original.json", "--plan", "plan.json"],
      [
        "resume",
        "--handler",
        "original.json",
        "--plan",
        "plan.json",
        "--out",
        "tx.json",
        "--max-steps",
        "2",
      ],
      ["inspect", "--handler", "a", "--handler", "b"],
      ["inspect", "--handler", "a", "--force"],
    ]
  ) {
    assertThrows(() => parseMigrationArgs(args));
  }
  assertEquals(
    parseMigrationArgs([
      "resume",
      "--handler",
      "original.json",
      "--plan",
      "plan.json",
      "--submit",
      "--max-steps",
      "3",
    ]).maxSteps,
    3,
  );
});

Deno.test("durable submission recovers accepted transactions after RPC loss and process restart without a second spend", async () => {
  const seed = "abandon ".repeat(11) + "about";
  const address = walletFromSeed(seed, { network: "Custom" }).address;
  const emulator = new Emulator([{
    address,
    seedPhrase: seed,
    privateKey: "",
    assets: { lovelace: 100_000_000n },
  }]);
  const lucid = await Lucid(emulator, "Custom");
  lucid.selectWallet.fromSeed(seed);
  const directory = await Deno.makeTempDir();
  let broadcasts = 0;
  const submit = emulator.submitTx.bind(emulator);
  emulator.submitTx = async (cbor) => {
    broadcasts++;
    await submit(cbor);
    emulator.awaitBlock();
    throw new Error("RPC response lost after ledger acceptance");
  };
  try {
    const first = await (await lucid.newTx().pay.ToAddress(address, {
      lovelace: 2_000_000n,
    }).complete()).sign.withWallet().complete();
    const hash = await migrationSubmitter(lucid, directory, () => {}, 1)(
      first,
      "publication-test",
    );
    assertEquals(hash, first.toHash());
    assertEquals(broadcasts, 1);
    const unused = await (await lucid.newTx().pay.ToAddress(address, {
      lovelace: 3_000_000n,
    }).complete()).sign.withWallet().complete();
    const resumed = await migrationSubmitter(lucid, directory, () => {}, 1)(
      unused,
      "publication-test",
    );
    assertEquals(resumed, first.toHash());
    assertEquals(broadcasts, 1);
    const path = `${directory}/publication-test.json`;
    const corrupt = JSON.parse(await Deno.readTextFile(path));
    corrupt.hash = "ff".repeat(32);
    await Deno.writeTextFile(path, JSON.stringify(corrupt));
    await assertRejects(
      () =>
        migrationSubmitter(lucid, directory, () => {}, 1)(
          unused,
          "publication-test",
        ),
      Error,
      "Corrupt migration submission journal",
    );
    assertEquals(broadcasts, 1);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("concurrent publication executors share the first complete signed journal record", async () => {
  const seed = "abandon ".repeat(11) + "about";
  const address = walletFromSeed(seed, { network: "Custom" }).address;
  const emulator = new Emulator([{
    address,
    seedPhrase: seed,
    privateKey: "",
    assets: { lovelace: 100_000_000n },
  }]);
  const lucid = await Lucid(emulator, "Custom");
  lucid.selectWallet.fromSeed(seed);
  const directory = await Deno.makeTempDir();
  const first =
    await (await lucid.newTx().pay.ToAddress(address, { lovelace: 2_000_000n })
      .complete()).sign.withWallet().complete();
  const second =
    await (await lucid.newTx().pay.ToAddress(address, { lovelace: 3_000_000n })
      .complete()).sign.withWallet().complete();
  const submit = emulator.submitTx.bind(emulator);
  const hashes = new Set<string>();
  emulator.submitTx = async (cbor) => {
    const hash = await submit(cbor);
    hashes.add(hash);
    emulator.awaitBlock();
    return hash;
  };
  try {
    const results = await Promise.all([
      migrationSubmitter(lucid, directory, () => {}, 1)(first, "shared"),
      migrationSubmitter(lucid, directory, () => {}, 1)(second, "shared"),
    ]);
    assertEquals(results[0], results[1]);
    assertEquals(hashes.size, 1);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("expired publication rebuilds lazily with the original input and rejects a substituted anchor", async () => {
  const seed = "abandon ".repeat(11) + "about";
  const address = walletFromSeed(seed, { network: "Custom" }).address;
  const emulator = new Emulator(Array.from({ length: 2 }, () => ({
    address,
    seedPhrase: seed,
    privateKey: "",
    assets: { lovelace: 100_000_000n },
  })));
  const lucid = await Lucid(emulator, "Custom");
  lucid.selectWallet.fromSeed(seed);
  const [original, unrelated] = await lucid.wallet().getUtxos();
  const directory = await Deno.makeTempDir();
  const realSubmit = emulator.submitTx.bind(emulator);
  let builds = 0, broadcasts = 0;
  let accept = false;
  emulator.submitTx = async (cbor) => {
    broadcasts++;
    if (!accept) throw new Error("network unavailable before acceptance");
    const hash = await realSubmit(cbor);
    emulator.awaitBlock();
    return hash;
  };
  // Submission recovery is under test, not wall-clock polling.
  lucid.awaitTx = () => Promise.resolve(false);
  const submit = migrationSubmitter(
    lucid,
    directory,
    () => {},
    1,
    () => Promise.resolve(BigInt(emulator.slot)),
  );
  const request = {
    anchor: original,
    build: async (anchor?: typeof original) => {
      builds++;
      return await (await lucid.newTx().collectFrom([anchor!])
        .validTo(emulator.now() + 10_000)
        .pay.ToAddress(address, { lovelace: 2_000_000n }).complete()).sign
        .withWallet().complete();
    },
  };
  try {
    await assertRejects(
      () => submit(request, "expiry"),
      Error,
      "remains unresolved",
    );
    assertEquals(builds, 1);
    const firstBytes = await Deno.readTextFile(`${directory}/expiry.json`);
    const first = JSON.parse(firstBytes);
    await assertRejects(
      () =>
        submit({
          build: () =>
            Promise.reject(new Error("must not build before expiry")),
        }, "expiry"),
      Error,
      "remains unresolved",
    );
    assertEquals(builds, 1);
    emulator.awaitSlot(20);
    const beforeBad = broadcasts;
    await assertRejects(
      () =>
        submit({
          build: async () =>
            await (await lucid.newTx().collectFrom([unrelated]).validTo(
              emulator.now() + 10_000,
            )
              .pay.ToAddress(address, { lovelace: 3_000_000n }).complete()).sign
              .withWallet().complete(),
        }, "expiry"),
      Error,
      "omitted its original normal input anchor",
    );
    assertEquals(broadcasts, beforeBad);
    accept = true;
    const result = await submit(request, "expiry");
    const replacement = JSON.parse(
      await Deno.readTextFile(`${directory}/expiry.r1.json`),
    );
    assertEquals(result, replacement.hash);
    assertEquals(replacement.parent, first.hash);
    assertEquals(replacement.anchor, first.anchor);
    assertEquals(
      await Deno.readTextFile(`${directory}/expiry.json`),
      firstBytes,
    );
    assertEquals(builds, 2);
    const broadcastsAfter = broadcasts;
    assertEquals(
      await submit({
        build: () =>
          Promise.reject(new Error("accepted action must not build")),
      }, "expiry"),
      result,
    );
    assertEquals(broadcasts, broadcastsAfter);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("rollback reconciliation adopts an older canonical revision instead of broadcasting its replacement", async () => {
  const seed = "abandon ".repeat(11) + "about";
  const address = walletFromSeed(seed, { network: "Custom" }).address;
  const emulator = new Emulator([{
    address,
    seedPhrase: seed,
    privateKey: "",
    assets: { lovelace: 100_000_000n },
  }]);
  const lucid = await Lucid(emulator, "Custom");
  lucid.selectWallet.fromSeed(seed);
  const [anchor] = await lucid.wallet().getUtxos();
  const directory = await Deno.makeTempDir();
  const realSubmit = emulator.submitTx.bind(emulator);
  const initialTime = emulator.time;
  const initialSlot = emulator.slot;
  let broadcasts = 0;
  emulator.submitTx = () => {
    broadcasts++;
    return Promise.reject(new Error("connection interrupted"));
  };
  lucid.awaitTx = () => Promise.resolve(false);
  const submit = migrationSubmitter(
    lucid,
    directory,
    () => {},
    1,
    () => Promise.resolve(BigInt(emulator.slot)),
  );
  const request = {
    anchor,
    build: async (pinned?: typeof anchor) =>
      await (await lucid.newTx().collectFrom([pinned!]).validTo(
        emulator.now() + 10_000,
      )
        .pay.ToAddress(address, { lovelace: 2_000_000n }).complete()).sign
        .withWallet().complete(),
  };
  try {
    await assertRejects(
      () => submit(request, "rollback"),
      Error,
      "remains unresolved",
    );
    const first = JSON.parse(
      await Deno.readTextFile(`${directory}/rollback.json`),
    );
    emulator.awaitSlot(20);
    await assertRejects(
      () => submit(request, "rollback"),
      Error,
      "remains unresolved",
    );
    await Deno.stat(`${directory}/rollback.r1.json`);
    // Isolated journal test: return to the earlier fork, then let the real
    // emulator ledger accept the original valid transaction on that fork.
    emulator.time = initialTime;
    emulator.slot = initialSlot;
    await realSubmit(first.cbor);
    emulator.awaitBlock();
    const before = broadcasts;
    assertEquals(
      await submit({
        build: () =>
          Promise.reject(new Error("must reconcile every revision first")),
      }, "rollback"),
      first.hash,
    );
    assertEquals(broadcasts, before);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("concurrent expired-publication rebuilds adopt one immutable replacement spending the original input", async () => {
  const seed = "abandon ".repeat(11) + "about";
  const address = walletFromSeed(seed, { network: "Custom" }).address;
  const emulator = new Emulator([{
    address,
    seedPhrase: seed,
    privateKey: "",
    assets: { lovelace: 100_000_000n },
  }]);
  const lucid = await Lucid(emulator, "Custom");
  lucid.selectWallet.fromSeed(seed);
  const [anchor] = await lucid.wallet().getUtxos();
  const directory = await Deno.makeTempDir();
  const realSubmit = emulator.submitTx.bind(emulator);
  const accepted = new Set<string>();
  let available = false;
  emulator.submitTx = async (cbor) => {
    if (!available) throw new Error("disconnected");
    const hash = await realSubmit(cbor);
    accepted.add(hash);
    emulator.awaitBlock();
    return hash;
  };
  lucid.awaitTx = () => Promise.resolve(false);
  const submit = () =>
    migrationSubmitter(
      lucid,
      directory,
      () => {},
      1,
      () => Promise.resolve(BigInt(emulator.slot)),
    );
  const build = async (amount: bigint) =>
    await (await lucid.newTx().collectFrom([anchor]).validTo(
      emulator.now() + 10_000,
    )
      .pay.ToAddress(address, { lovelace: amount }).complete()).sign
      .withWallet().complete();
  try {
    await assertRejects(
      () => submit()({ anchor, build: () => build(2_000_000n) }, "race-expiry"),
      Error,
      "remains unresolved",
    );
    const original = JSON.parse(
      await Deno.readTextFile(`${directory}/race-expiry.json`),
    );
    emulator.awaitSlot(20);
    const candidates = [await build(3_000_000n), await build(4_000_000n)];
    let arrivals = 0;
    let release!: () => void;
    const bothBuilt = new Promise<void>((resolve) => {
      release = resolve;
    });
    available = true;
    const results = await Promise.all(candidates.map((candidate) =>
      submit()({
        anchor,
        build: async (pinned) => {
          assertEquals(pinned?.txHash, anchor.txHash);
          assertEquals(pinned?.outputIndex, anchor.outputIndex);
          if (++arrivals === 2) release();
          await bothBuilt;
          return candidate;
        },
      }, "race-expiry")
    ));
    const winner = JSON.parse(
      await Deno.readTextFile(`${directory}/race-expiry.r1.json`),
    );
    assertEquals(results, [winner.hash, winner.hash]);
    assertEquals(winner.parent, original.hash);
    assertEquals(winner.anchor, original.anchor);
    assertEquals(accepted.size, 1);
    const files = [];
    for await (const file of Deno.readDir(directory)) files.push(file.name);
    assertEquals(files.sort(), ["race-expiry.json", "race-expiry.r1.json"]);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("emergency authority rotation requires an exact authority and cannot request permission changes", () => {
  const args = [
    "rotate-emergency",
    "--handler",
    "baseline.json",
    "--out",
    "unsigned.json",
  ];
  assertThrows(() => parseMigrationArgs(args), Error, "--emergency-authority");
  const exact = [...args, "--emergency-authority", "reviewed-keys.json"];
  assertEquals(parseMigrationArgs(exact).command, "rotate-emergency");
  assertThrows(
    () => parseMigrationArgs([...exact, "--mask", "0"]),
    Error,
    "does not accept --mask",
  );
});
