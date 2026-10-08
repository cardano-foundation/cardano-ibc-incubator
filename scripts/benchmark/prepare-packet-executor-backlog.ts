/** Fund requests with public fixture keys on an explicitly owned magic-42 devnet. */
import { fromText, walletFromSeed } from "@lucid-evolution/lucid";
import { buildOperationalLucid } from "../../cardano/offchain/scripts/shutdown-deployment.ts";
import { buildTransferIntent } from "../../cardano/offchain/src/packet-lane-transactions.ts";
import { generateTokenName } from "../../cardano/offchain/src/utils.ts";
import { migrationTiming } from "../../cardano/offchain/src/migration-timing.ts";

const runtime = await Deno.realPath(Deno.args[0]);
const repository = await Deno.realPath(new URL("../../", import.meta.url));
if (!runtime.startsWith(repository + "/.deployment-smoke/")) {
  throw new Error("Select an owned runtime inside .deployment-smoke");
}
const genesis = JSON.parse(
  await Deno.readTextFile(runtime + "/runtime/genesis-shelley.json"),
);
if (genesis.networkMagic !== 42) {
  throw new Error("Only disposable magic-42 networks are supported");
}
const ports = JSON.parse(
  await Deno.readTextFile(runtime + "/benchmark-ports.json"),
);
for (const key of ["KUPO_API_KEY", "OGMIOS_API_KEY"]) Deno.env.delete(key);
Deno.env.set("KUPO_URL", `http://127.0.0.1:${ports.DEVKIT_KUPO_PORT}`);
Deno.env.set("OGMIOS_URL", `http://127.0.0.1:${ports.DEVKIT_OGMIOS_PORT}`);
Deno.env.set("CARDANO_NETWORK_MAGIC", "42");
const defaults = await Deno.readTextFile(
  repository + "/cardano/offchain/.env.default",
);
const key = defaults.match(/ed25519_sk[0-9a-z]+/)?.[0];
if (!key) throw new Error("Public devnet fixture key missing");
Deno.env.set("BENCHMARK_FIXTURE_KEY", key);
const lucid = await buildOperationalLucid({
  keyEnvironment: "BENCHMARK_FIXTURE_KEY",
});
const userSeed =
  "legal winner thank year wave sausage worth useful legal winner thank yellow";
const user = walletFromSeed(userSeed, { network: "Custom" }).address;
async function requireNewReceipt(path: string) {
  try {
    await Deno.stat(path);
    throw new Error(
      "Receipt already exists. Reconcile it before funding again",
    );
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  }
}
if (Deno.args[1] === "wallets") {
  await requireNewReceipt(runtime + "/benchmark-wallets.json");
  const signer = await lucid.wallet().address();
  const timing = await migrationTiming(lucid, Deno.env.get("OGMIOS_URL")!);
  let tx = lucid.newTx().validFrom(timing.validFrom).validTo(timing.validTo)
    .pay.ToAddress(user, { lovelace: 1_000_000_000n });
  for (let i = 0; i < 32; i++) {
    tx = tx.pay.ToAddress(signer, { lovelace: 30_000_000n });
  }
  const signed = await (await tx.complete({ localUPLCEval: false })).sign
    .withWallet().complete();
  const hash = await signed.submit();
  await lucid.awaitTx(hash);
  const receipt = { transaction: hash, signer, user, feeOutputs: 32 };
  await Deno.writeTextFile(
    runtime + "/benchmark-wallets.json",
    JSON.stringify(receipt, null, 2) + "\n",
    { createNew: true },
  );
  console.log(JSON.stringify(receipt));
} else {
  const channels = Deno.args[1].split(",");
  const perChannel = Number(Deno.args[2]);
  const receiptPath = Deno.args[3];
  if (
    !channels.length || channels.some((c) => !/^channel-\d+$/.test(c)) ||
    !Number.isInteger(perChannel) || perChannel < 1 || perChannel > 16
  ) {
    throw new Error(
      "Supply actual channel IDs and 1 to 16 requests per channel",
    );
  }
  if (!receiptPath.startsWith(runtime + "/")) {
    throw new Error("Retain receipts inside the owned runtime");
  }
  await requireNewReceipt(receiptPath);
  const handler = JSON.parse(
    await Deno.readTextFile(runtime + "/handler.json"),
  );
  lucid.selectWallet.fromSeed(userSeed);
  const timing = await migrationTiming(lucid, Deno.env.get("OGMIOS_URL")!);
  let tx = lucid.newTx().validFrom(timing.validFrom).validTo(timing.validTo);
  for (const channel of channels) {
    const name = await generateTokenName(
      {
        policy_id: handler.hostStateNFT.policyId,
        name: handler.hostStateNFT.name,
      },
      fromText("channel"),
      BigInt(channel.slice(8)),
    );
    const authenticated = await lucid.utxoByUnit(
      handler.validators.mintChannelStt.scriptHash + name,
    );
    for (let i = 0; i < perChannel; i++) {
      tx = tx.compose(
        await buildTransferIntent(lucid, {
          channel: authenticated,
          guardAddress: handler.packetState.guard.address,
        }, {
          amount: 2_000_000n,
          receiver: "cosmos1rnr5jrt4exl0samwj0yegv99jeskl0hsge5zwt",
          timeoutTimestamp: BigInt(timing.validFrom + 3_600_000) * 1_000_000n,
        }),
      );
    }
  }
  const signed = await (await tx.complete({ localUPLCEval: false })).sign
    .withWallet().complete();
  const hash = await signed.submit();
  await lucid.awaitTx(hash);
  const outputs = (await lucid.utxosAt(handler.packetState.guard.address))
    .filter((u) => u.txHash === hash);
  if (outputs.length !== channels.length * perChannel) {
    throw new Error("Backlog is not fully indexed");
  }
  const receipt = {
    transaction: hash,
    channels,
    perChannel,
    packets: outputs.length,
    intents: outputs.map((u) => ({
      txHash: u.txHash,
      outputIndex: u.outputIndex,
    })),
  };
  await Deno.writeTextFile(
    receiptPath,
    JSON.stringify(receipt, null, 2) + "\n",
    { createNew: true },
  );
  console.log(JSON.stringify(receipt));
}
