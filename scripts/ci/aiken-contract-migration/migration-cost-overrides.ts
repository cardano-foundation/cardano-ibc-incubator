/** Offline comparison only: preserves captured context/IDs while swapping code
 * in Aiken's simulator. This is NEVER evidence of acceptance by deployed code. */
import {
  applySingleCborEncoding,
  Data,
  Emulator,
  Lucid,
} from "@lucid-evolution/lucid";
import { AuthTokenSchema } from "../../../cardano/offchain/types/plutus/AuthToken.ts";
import {
  generateIdentifierTokenName,
  readValidator,
} from "../../../cardano/offchain/src/utils.ts";
import { loadMigrationBaseline } from "../../../cardano/offchain/src/migration.ts";
const [handlerPath, blueprintPath, outputPath] = Deno.args;
const h = JSON.parse(await Deno.readTextFile(handlerPath));
const b = await loadMigrationBaseline(h);
const bp = JSON.parse(await Deno.readTextFile(blueprintPath));
const lucid = await Lucid(new Emulator([]), "Custom");
const validators: unknown[] = [], overrides: string[] = [];
function add(
  title: string,
  originalHash: string,
  params: unknown[],
  schema: unknown,
) {
  const [script, hash] = readValidator(
    title,
    lucid,
    params as Data[],
    schema as Data[],
    bp,
  );
  validators.push({
    ...bp.validators.find((v: { title: string }) => v.title === title),
    compiledCode: applySingleCborEncoding(script.script),
    hash,
    parameters: [],
  });
  overrides.push(`${originalHash}:${hash}`);
}
add("upgradeable/host_state.host_state.spend", b.hostState.hash, [
  b.mintImplementationRegistry!.hash,
  1n,
], Data.Tuple([Data.Bytes(), Data.Integer()]));
add(
  "minting_voucher.mint_voucher.mint",
  b.mintVoucher.hash,
  [
    {
      policy_id: b.mintIdentifier.hash,
      name: await generateIdentifierTokenName(b.inputs.transferModuleNonce),
    },
    b.directoryAuthToken,
    b.voucherMetadata.hash,
    b.mintChannel.hash,
    b.hostNft.hash,
  ],
  Data.Tuple([
    AuthTokenSchema,
    AuthTokenSchema,
    Data.Bytes(),
    Data.Bytes(),
    Data.Bytes(),
  ]),
);
add(
  "trace_registry.spend_trace_registry.spend",
  b.traceRegistry.hash,
  [
    b.mintIdentifier.hash,
    b.directoryAuthToken,
    b.mintVoucher.hash,
    b.benchmarkVoucher?.hash ?? "",
    b.hostNft.hash,
  ],
  Data.Tuple([
    Data.Bytes(),
    AuthTokenSchema,
    Data.Bytes(),
    Data.Bytes(),
    Data.Bytes(),
  ]),
);
add(
  "spending_channel/recv_packet.recv_packet.mint",
  b.spendingChannel.referredScripts.recv_packet.hash,
  [
    b.mintClient.hash,
    b.mintConnection.hash,
    b.mintPort.hash,
    b.verifyProof.hash,
    b.hostNft.hash,
  ],
  Data.Tuple([
    Data.Bytes(),
    Data.Bytes(),
    Data.Bytes(),
    Data.Bytes(),
    Data.Bytes(),
  ]),
);
await Deno.writeTextFile(
  outputPath,
  JSON.stringify({ ...bp, validators }, null, 2) + "\n",
);
console.log(JSON.stringify({ overrides }));
