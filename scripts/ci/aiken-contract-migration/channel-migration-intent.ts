/** Fund, observe or cancel one actual intent without sending a packet. */
import { Data, fromText, getAddressDetails } from "@lucid-evolution/lucid";
import { join, resolve } from "@std/path";
import { buildOperationalLucid } from "../../../cardano/offchain/scripts/shutdown-deployment.ts";
import { migrationTiming } from "../../../cardano/offchain/src/migration-timing.ts";
import { migrationSubmitter } from "../../../cardano/offchain/src/migration-submission.ts";
import { generateTokenName } from "../../../cardano/offchain/src/utils.ts";
import {
  buildTransferIntent,
  buildTransferIntentCancellation,
  type PacketLaneDeployment,
} from "../../../packages/cardano-ibc-tx-builder-runtime/src/packetLaneTransactions.ts";
import { ownedRuntimeProviders } from "./owned-migration-runtime.ts";

const [runtimeArg, action] = Deno.args;
if (!runtimeArg || !["fund", "verify", "cancel"].includes(action)) {
  throw new Error(
    "Usage: channel-migration-intent.ts OWNED_RUNTIME fund|verify|cancel",
  );
}
const root = resolve(import.meta.dirname!, "../../..");
const runtime = await Deno.realPath(runtimeArg);
if (!runtime.startsWith(join(root, ".deployment-smoke") + "/")) {
  throw new Error("Explicit owned runtime required");
}
const providers = ownedRuntimeProviders(runtime, true);
const handler = JSON.parse(
  await Deno.readTextFile(join(runtime, "handler.json")),
);
const population = JSON.parse(
  await Deno.readTextFile(join(runtime, "wallet-population.json")),
);
if (
  !handler.packetState || population.genesisSha256 !== providers.genesisSha256
) {
  throw new Error("Owned packet-lane population required");
}
for (
  const name of ["KUPO_API_KEY", "OGMIOS_API_KEY", "MIGRATION_EXECUTOR_SK"]
) Deno.env.delete(name);
Deno.env.set("KUPO_URL", `http://${providers.kupo}`);
Deno.env.set("OGMIOS_URL", `http://${providers.ogmios}`);
Deno.env.set("CARDANO_NETWORK_MAGIC", "42");
const defaults = await Deno.readTextFile(
  join(root, "cardano/offchain/.env.default"),
);
const key = defaults.match(/ed25519_sk[0-9a-z]+/)?.[0];
if (!key) throw new Error("Published fixture key is absent");
Deno.env.set("MIGRATION_EXECUTOR_SK", key);
const lucid = await buildOperationalLucid({
  keyEnvironment: "MIGRATION_EXECUTOR_SK",
});
const address = await lucid.wallet().address();
if (address !== population.primary) throw new Error("Unexpected fixture owner");
const owner = getAddressDetails(address).paymentCredential!;
const receiptFile = join(runtime, "channel-migration-funded-intent.json");
const outbox = join(runtime, "channel-migration-intent-outbox");
const submit = migrationSubmitter(lucid, outbox);
const guard = handler.packetState.guard.address;
const asset = population.units[0];
const amount = 17n;
const encode = (value: unknown) =>
  JSON.stringify(
    value,
    (_, item) => typeof item === "bigint" ? item.toString() : item,
  );

if (action === "fund") {
  const host = {
    policy_id: handler.hostStateNFT.policyId,
    name: handler.hostStateNFT.name,
  };
  const channelUnit = handler.validators.mintChannelStt.scriptHash +
    await generateTokenName(host, fromText("channel"), 0n);
  const channel = await lucid.utxoByUnit(channelUnit);
  const transaction = await submit({
    build: async () => {
      const response = await fetch("http://127.0.0.1:28757/status");
      if (!response.ok) throw new Error("Owned counterparty is unavailable");
      const block = (await response.json()).result;
      if (block.node_info.network !== "migration-462-1") {
        throw new Error("Unexpected counterparty");
      }
      const timestamp = Date.parse(block.sync_info.latest_block_time);
      if (!Number.isSafeInteger(timestamp)) {
        throw new Error("Invalid counterparty time");
      }
      const timing = await migrationTiming(lucid, Deno.env.get("OGMIOS_URL")!);
      const builder = await buildTransferIntent(lucid, {
        channel,
        guardAddress: guard,
      }, {
        assetUnit: asset,
        fullDenom: asset,
        amount,
        receiver: "cosmos1rnr5jrt4exl0samwj0yegv99jeskl0hsge5zwt",
        memo: "unsent-through-channel-migration",
        timeoutTimestamp: BigInt(timestamp + 5 * 86400000) * 1000000n,
      });
      return await (await builder.validFrom(timing.validFrom).validTo(
        timing.validTo,
      )
        .complete({ localUPLCEval: false })).sign.withWallet().complete();
    },
  }, "fund-unsent-channel-migration-intent");
  const candidates = (await lucid.utxosAt(guard)).filter((output) =>
    output.txHash === transaction && output.assets[asset] === amount
  );
  if (candidates.length !== 1 || !candidates[0].datum) {
    throw new Error("Unique live funded intent is absent");
  }
  const output = candidates[0];
  const receipt = {
    genesisSha256: providers.genesisSha256,
    transaction,
    outputIndex: output.outputIndex,
    owner: owner.hash,
    asset,
    amount: amount.toString(),
    address: guard,
    datum: output.datum,
  };
  try {
    const existing = JSON.parse(await Deno.readTextFile(receiptFile));
    if (encode(existing) !== encode(receipt)) {
      throw new Error("Retained intent receipt changed");
    }
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
    await Deno.writeTextFile(receiptFile, encode(receipt) + "\n", {
      createNew: true,
    });
  }
  console.log(encode({ funded: true, ...receipt }));
} else {
  const receipt = JSON.parse(await Deno.readTextFile(receiptFile));
  if (
    receipt.genesisSha256 !== providers.genesisSha256 ||
    receipt.address !== guard ||
    receipt.asset !== asset || receipt.amount !== amount.toString() ||
    receipt.owner !== owner.hash
  ) {
    throw new Error("Retained intent belongs to another fixture or request");
  }
  const originalIntent = async () => {
    const [intent] = await lucid.utxosByOutRef([{
      txHash: receipt.transaction,
      outputIndex: receipt.outputIndex,
    }]);
    if (
      !intent || intent.address !== guard || intent.datum !== receipt.datum ||
      intent.assets[asset] !== amount
    ) {
      throw new Error("Original funded intent was spent or changed");
    }
    // Decode the actual guard datum rather than trusting the receipt's label.
    const raw = Data.from(intent.datum!) as {
      index: number;
      fields: unknown[];
    };
    if (
      raw.index !== 0 || raw.fields.length !== 5 ||
      raw.fields[0] !== fromText("transfer") ||
      raw.fields[1] !== fromText("channel-0") || raw.fields[2] !== owner.hash
    ) {
      throw new Error(
        "Original guard output does not encode the intended owner and route",
      );
    }
    const payload = raw.fields[3] as { index: number; fields: unknown[] };
    const expected = [
      asset,
      amount.toString(),
      owner.hash,
      "cosmos1rnr5jrt4exl0samwj0yegv99jeskl0hsge5zwt",
      "unsent-through-channel-migration",
    ].map(fromText);
    if (
      payload.index !== 0 || encode(payload.fields) !== encode(expected) ||
      BigInt(String(raw.fields[4])) <= 0n
    ) {
      throw new Error(
        "Funded intent payload differs from the original request",
      );
    }
    return intent;
  };
  if (action === "cancel") {
    const [guardReference] = await lucid.utxosByOutRef([
      handler.packetState.guard.refUtxo,
    ]);
    if (!guardReference?.scriptRef) {
      throw new Error("Published guard reference is unavailable");
    }
    const transaction = await submit({
      build: async () => {
        const intent = await originalIntent();
        const timing = await migrationTiming(
          lucid,
          Deno.env.get("OGMIOS_URL")!,
        );
        const builder = await buildTransferIntentCancellation(
          lucid,
          { scripts: [guardReference] } as PacketLaneDeployment,
          intent,
        );
        return await (await builder.validFrom(timing.validFrom).validTo(
          timing.validTo,
        )
          .complete({ localUPLCEval: false })).sign.withWallet().complete();
      },
    }, "cancel-unsent-channel-migration-intent");
    console.log(
      encode({
        cancelled: true,
        transaction,
        original: receipt.transaction,
        asset,
        amount,
      }),
    );
  } else {
    await originalIntent();
    console.log(encode({ verified: true, ...receipt }));
  }
}
