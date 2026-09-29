// Signed, balanced reference-script transactions for the commitment kernels.
// These include runtime redeemer decoding. They deliberately do not claim to
// include the remaining HostState, client, channel or application validators.
import {
  applyDoubleCborEncoding,
  CML,
  credentialToAddress,
  Data,
  Lucid,
  PROTOCOL_PARAMETERS_DEFAULT,
  type Script,
  type UTxO,
  validatorToAddress,
} from "@lucid-evolution/lucid";
import { Emulator, generateEmulatorAccount } from "@lucid-evolution/provider";
import { isolateEvaluation } from "../../cardano/offchain/src/testing/isolated-evaluation.ts";

const blueprint = JSON.parse(await Deno.readTextFile("plutus.json"));
const fixtures: { name: string; validator: string; redeemer: string }[] = JSON
  .parse(await Deno.readTextFile("artifacts/transactions.json"));
const results = [];
for (const fixture of fixtures) {
  const validator = blueprint.validators.find((v: { title: string }) =>
    v.title === fixture.validator
  );
  if (!validator) throw new Error(`Missing validator ${fixture.validator}`);
  const script: Script = {
    type: "PlutusV3",
    script: validator.compiledCode,
  };
  const account = generateEmulatorAccount({ lovelace: 1_000_000_000n });
  const emulator = new Emulator([account], {
    ...PROTOCOL_PARAMETERS_DEFAULT,
    maxTxSize: 16_384,
    maxTxExMem: 16_500_000n,
    maxTxExSteps: 10_000_000_000n,
  });
  const lucid = await Lucid(emulator, "Custom");
  lucid.selectWallet.fromSeed(account.seedPhrase);
  isolateEvaluation(lucid, emulator);
  const address = validatorToAddress("Custom", script);
  const input: UTxO = {
    txHash: "ab".repeat(32),
    outputIndex: 0,
    address,
    assets: { lovelace: 20_000_000n },
    datum: Data.void(),
  };
  const reference: UTxO = {
    txHash: "ab".repeat(32),
    outputIndex: 1,
    address: credentialToAddress("Custom", {
      type: "Script",
      hash: "fe".repeat(28),
    }),
    assets: { lovelace: 100_000_000n },
    datum: Data.void(),
    scriptRef: {
      ...script,
      script: applyDoubleCborEncoding(script.script),
    },
  };
  for (const utxo of [input, reference]) {
    emulator.ledger[utxo.txHash + utxo.outputIndex] = { utxo, spent: false };
  }
  try {
    const tx = lucid.newTx()
      .readFrom([reference])
      .collectFrom([input], fixture.redeemer)
      .pay.ToContract(address, { kind: "inline", value: Data.void() }, {
        lovelace: 20_000_000n,
      });
    const completed = await tx.complete({ localUPLCEval: false });
    const signed = await completed.sign.withWallet().complete();
    const transaction = signed.toTransaction();
    const redeemers = transaction.witness_set().redeemers();
    if (!redeemers) throw new Error("Missing evaluated redeemers");
    const units = CML.compute_total_ex_units(redeemers);
    const result = {
      name: fixture.name,
      signed_bytes: signed.toCBOR().length / 2,
      redeemer_bytes: fixture.redeemer.length / 2,
      memory: Number(units.mem()),
      cpu: Number(units.steps()),
      fee_lovelace: Number(transaction.body().fee()),
      script_bytes: validator.compiledCode.length / 2,
    };
    if (
      result.signed_bytes > 16_384 || result.memory > 16_500_000 ||
      result.cpu > 10_000_000_000
    ) {
      throw new Error(
        `Kernel transaction exceeds ledger limits: ${JSON.stringify(result)}`,
      );
    }
    await signed.submit();
    emulator.awaitBlock();
    results.push(result);
    console.log(result);
  } catch (error) {
    const result = { name: fixture.name, error: String(error) };
    results.push(result);
    console.error(result);
  }
}
await Deno.writeTextFile(
  "artifacts/transaction-costs.json",
  JSON.stringify(results, null, 2) + "\n",
);
if (results.some((r) => "error" in r)) Deno.exit(1);
