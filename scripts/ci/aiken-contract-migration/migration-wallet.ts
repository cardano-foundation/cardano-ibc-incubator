/** Owned devnet fixture funding; never reads an operator's wallet/key files. */
import {
  credentialToAddress,
  fromText,
  getAddressDetails,
  scriptFromNative,
  type UTxO,
  validatorToScriptHash,
  walletFromSeed,
} from "@lucid-evolution/lucid";
import { join, resolve } from "@std/path";
import { buildOperationalLucid } from "../../../cardano/offchain/scripts/shutdown-deployment.ts";
import { migrationTiming } from "../../../cardano/offchain/src/migration-timing.ts";
import { migrationSubmitter } from "../../../cardano/offchain/src/migration-submission.ts";
import { validateOwnedRuntime } from "./owned-migration-runtime.ts";

const root = resolve(import.meta.dirname!, "../../..");
const runtime = await Deno.realPath(Deno.args[0] ?? "missing-runtime");
if (!runtime.startsWith(join(root, ".deployment-smoke") + "/")) {
  throw new Error("Explicit disposable runtime required");
}
const genesis = JSON.parse(
  await Deno.readTextFile(join(runtime, "runtime/genesis-shelley.json")),
);
const genesisSha256 = await validateOwnedRuntime(runtime);
if (genesis.networkMagic !== 42) {
  throw new Error("Only the owned magic-42 devnet is supported");
}
for (
  const name of ["KUPO_API_KEY", "OGMIOS_API_KEY", "MIGRATION_EXECUTOR_SK"]
) Deno.env.delete(name);
Deno.env.set("KUPO_URL", "http://127.0.0.1:2742");
Deno.env.set("OGMIOS_URL", "http://127.0.0.1:2637");
Deno.env.set("CARDANO_NETWORK_MAGIC", "42");
// Public, checked-in devnet fixture only. No private material is printed.
const defaults = await Deno.readTextFile(
  join(root, "cardano/offchain/.env.default"),
);
const key = defaults.match(/ed25519_sk[0-9a-z]+/)?.[0];
if (!key) throw new Error("Public local devnet fixture key missing");
Deno.env.set("MIGRATION_EXECUTOR_SK", key);
const lucid = await buildOperationalLucid({
  keyEnvironment: "MIGRATION_EXECUTOR_SK",
});
const primary = await lucid.wallet().address();
const primaryCredential = getAddressDetails(primary).paymentCredential!;
// Published BIP-39 test vector, used only inside this disposable network.
const secondary = walletFromSeed(
  "legal winner thank year wave sausage worth useful legal winner thank yellow",
  { network: "Custom" },
);
const secondaryCredential = getAddressDetails(secondary.address)
  .paymentCredential!;
const secondaryAddress = credentialToAddress("Custom", secondaryCredential);
const policy = scriptFromNative({
  type: "sig",
  keyHash: primaryCredential.hash,
});
const policyId = validatorToScriptHash(policy);
const units = ["MIGRATION462A", "MIGRATION462B"].map((name) =>
  policyId + fromText(name)
);
const provider = lucid.config().provider as
  & NonNullable<ReturnType<typeof lucid.config>["provider"]>
  & {
    getTransactionOutputs?: (hash: string) => Promise<UTxO[]>;
  };
async function canonicalOutputs(transaction: string): Promise<UTxO[]> {
  if (!/^[0-9a-f]{64}$/.test(transaction) || !provider.getTransactionOutputs) {
    throw new Error(
      "Canonical transaction history is required to resume fixture funding",
    );
  }
  const outputs = await provider.getTransactionOutputs(transaction);
  if (
    !outputs.length || outputs.some((output) => output.txHash !== transaction)
  ) {
    throw new Error(
      "Fixture receipt is not in canonical history; reconcile before funding again",
    );
  }
  return outputs;
}
const receiptFile = join(runtime, "wallet-population.json");
try {
  const previous = JSON.parse(await Deno.readTextFile(receiptFile));
  if (
    previous.genesisSha256 !== genesisSha256 ||
    previous.primary !== primary || previous.secondary !== secondaryAddress ||
    JSON.stringify(previous.units) !== JSON.stringify(units)
  ) throw new Error("Fixture population identity changed");
  const outputs = await canonicalOutputs(previous.transaction);
  for (
    const [address, amount] of [[primary, 900_000n], [
      secondaryAddress,
      100_000n,
    ]] as const
  ) {
    if (
      !outputs.some((output) =>
        output.address === address &&
        units.every((unit) => output.assets[unit] === amount)
      )
    ) {
      throw new Error(
        "Canonical fixture funding differs from the recorded population",
      );
    }
  }
  console.log(JSON.stringify(previous));
} catch (error) {
  if (!(error instanceof Deno.errors.NotFound)) throw error;
  const timing = await migrationTiming(lucid, Deno.env.get("OGMIOS_URL")!);
  const signed = await (await lucid.newTx().validFrom(timing.validFrom).validTo(
    timing.validTo,
  )
    .mintAssets({ [units[0]]: 1_000_000n, [units[1]]: 1_000_000n }).attach
    .MintingPolicy(policy)
    .pay.ToAddress(secondaryAddress, {
      lovelace: 100_000_000n,
      [units[0]]: 100_000n,
      [units[1]]: 100_000n,
    })
    .pay.ToAddress(primary, {
      lovelace: 10_000_000n,
      [units[0]]: 900_000n,
      [units[1]]: 900_000n,
    })
    .complete({ localUPLCEval: false })).sign.withWallet().complete();
  const transaction = await migrationSubmitter(
    lucid,
    join(runtime, "wallet-outbox"),
  )(signed, "fund-public-test-users");
  const receipt = {
    genesisSha256,
    transaction,
    primary,
    secondary: secondaryAddress,
    primaryCredential: primaryCredential.hash,
    secondaryCredential: secondaryCredential.hash,
    units,
    mintedPerUnit: "1000000",
  };
  await Deno.writeTextFile(
    receiptFile,
    JSON.stringify(receipt, null, 2) + "\n",
    { createNew: true },
  );
  console.log(JSON.stringify(receipt));
}

const fundingFile = join(runtime, "wallet-secondary-fees.json");
try {
  const previous = JSON.parse(await Deno.readTextFile(fundingFile));
  const outputs = await canonicalOutputs(previous.transaction);
  if (
    previous.address !== secondaryAddress ||
    !outputs.some((output) =>
      output.address === secondaryAddress &&
      output.assets.lovelace === 20_000_000n
    )
  ) {
    throw new Error("Canonical secondary fee funding differs from its receipt");
  }
} catch (error) {
  if (!(error instanceof Deno.errors.NotFound)) throw error;
  const timing = await migrationTiming(lucid, Deno.env.get("OGMIOS_URL")!);
  const signed = await (await lucid.newTx().validFrom(timing.validFrom).validTo(
    timing.validTo,
  )
    .pay.ToAddress(secondaryAddress, { lovelace: 20_000_000n })
    .complete({ localUPLCEval: false })).sign.withWallet().complete();
  const transaction = await migrationSubmitter(
    lucid,
    join(runtime, "wallet-outbox"),
  )(signed, "fund-secondary-fees");
  await Deno.writeTextFile(
    fundingFile,
    JSON.stringify({
      transaction,
      address: secondaryAddress,
      lovelace: "20000000",
    }) + "\n",
    { createNew: true },
  );
  console.log(JSON.stringify({ secondaryFeeFunding: transaction }));
}

// A separate published test vector funds migration without using either
// voucher holder's signing key. This wallet never receives a bridge asset.
const executor = walletFromSeed(
  "letter advice cage absurd amount doctor acoustic avoid letter advice cage above",
  { network: "Custom" },
);
const executorCredential = getAddressDetails(executor.address)
  .paymentCredential!;
const executorAddress = credentialToAddress("Custom", executorCredential);
const executorFile = join(runtime, "wallet-migration-executor.json");
try {
  const previous = JSON.parse(await Deno.readTextFile(executorFile));
  const outputs = await canonicalOutputs(previous.transaction);
  if (
    previous.genesisSha256 !== genesisSha256 ||
    previous.address !== executorAddress ||
    !outputs.some((output) =>
      output.address === executorAddress &&
      output.assets.lovelace === 200_000_000n &&
      Object.keys(output.assets).length === 1
    )
  ) {
    throw new Error(
      "Canonical migration executor funding differs from its receipt",
    );
  }
} catch (error) {
  if (!(error instanceof Deno.errors.NotFound)) throw error;
  const timing = await migrationTiming(lucid, Deno.env.get("OGMIOS_URL")!);
  const signed = await (await lucid.newTx().validFrom(timing.validFrom).validTo(
    timing.validTo,
  )
    .pay.ToAddress(executorAddress, { lovelace: 200_000_000n })
    .complete({ localUPLCEval: false })).sign.withWallet().complete();
  const transaction = await migrationSubmitter(
    lucid,
    join(runtime, "wallet-outbox"),
  )(
    signed,
    "fund-independent-migration-executor",
  );
  await Deno.writeTextFile(
    executorFile,
    JSON.stringify({
      genesisSha256,
      transaction,
      address: executorAddress,
      credential: executorCredential.hash,
      lovelace: "200000000",
    }) + "\n",
    { createNew: true },
  );
  console.log(
    JSON.stringify({
      independentExecutorFunding: transaction,
      address: executorAddress,
    }),
  );
}
