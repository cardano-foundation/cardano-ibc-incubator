import { assert } from "@std/assert";
import { validatorToScriptHash } from "@lucid-evolution/lucid";
import { completeReferenceBatchTx } from "./deployment-transactions.ts";
import { packetLaneFixture } from "./testing/packet-lane-fixture.ts";
import { readValidator } from "./utils.ts";

Deno.test("membership verifier standalone reference publication", async () => {
  const f = await packetLaneFixture(1);
  const wallet = await f.wallet();
  const [script, hash] = readValidator(
    "verifying_membership.verify_membership.mint",
    wallet,
  );
  const [, , referenceAddress] = readValidator(
    "reference_validator.refer_only.else",
    wallet,
    [f.packetContext.hostPolicy],
  );
  const publication = await completeReferenceBatchTx(
    wallet,
    referenceAddress,
    [script],
  );
  const output = publication.outputs.find((u) =>
    u.scriptRef && validatorToScriptHash(u.scriptRef) === hash
  );
  assert(output);
  console.log(JSON.stringify({
    profile: "standalone membership verifier reference publication",
    signedBytes: publication.signedTx.toCBOR().length / 2,
    feeLovelace: publication.signedTx.toTransaction().body().fee().toString(),
    outputLovelace: output.assets.lovelace.toString(),
  }));
  await publication.signedTx.submit();
  f.emulator.awaitBlock();
});
