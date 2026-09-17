/** Export public, canonical UTxOs for offline Aiken cost evaluation. Does not sign. */
import { CML, type UTxO, utxoToCore } from "@lucid-evolution/lucid";
import { buildOperationalLucid } from "../../cardano/offchain/scripts/shutdown-deployment.ts";
const [capturePath, outputDirectory] = Deno.args;
if (!capturePath || !outputDirectory) {
  throw new Error("Usage: capture.json output-directory");
}
const capture = JSON.parse(await Deno.readTextFile(capturePath));
const cbor = capture.details.cbor ?? capture.details.txCbor;
const tx = CML.Transaction.from_cbor_hex(cbor);
const lucid = await buildOperationalLucid({ readOnly: true });
const provider = lucid.config().provider as
  & NonNullable<ReturnType<typeof lucid.config>["provider"]>
  & { getTransactionOutputs(hash: string): Promise<UTxO[]> };
const refs = new Map<string, CML.TransactionInput>();
for (
  const list of [
    tx.body().inputs(),
    tx.body().reference_inputs(),
    tx.body().collateral_inputs(),
  ]
) {
  if (!list) continue;
  for (let i = 0; i < list.len(); i++) {
    const input = list.get(i);
    refs.set(input.to_cbor_hex(), input);
  }
}
const inputs: string[] = [], outputs: string[] = [];
for (const [encoded, input] of refs) {
  const hash = input.transaction_id().to_hex();
  const candidates = await provider.getTransactionOutputs(hash);
  const output = candidates.find((u) =>
    BigInt(u.outputIndex) === input.index()
  );
  if (!output) {
    throw new Error(`Canonical output missing: ${hash}#${input.index()}`);
  }
  inputs.push(encoded);
  outputs.push(utxoToCore(output).output().to_cbor_hex());
}
function array(items: string[]) {
  return "9f" + items.join("") + "ff";
}
await Deno.mkdir(outputDirectory, { recursive: true });
for (
  const [name, content] of [["transaction", cbor], ["inputs", array(inputs)], [
    "outputs",
    array(outputs),
  ]]
) {
  await Deno.writeTextFile(`${outputDirectory}/${name}.cbor`, content + "\n", {
    createNew: true,
  });
}
console.log(
  JSON.stringify({
    outputDirectory,
    inputs: inputs.length,
    transactionBytes: cbor.length / 2,
  }),
);
