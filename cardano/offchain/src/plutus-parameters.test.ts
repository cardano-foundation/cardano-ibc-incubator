import { assert, assertEquals, assertThrows } from "@std/assert";
import { applyParamsToScript, Constr, Data } from "@lucid-evolution/lucid";
import blueprint from "../../onchain/plutus.json" with { type: "json" };
import { applyPlutusParameters } from "./plutus-parameters.ts";

function script(title: string): string {
  const validator = blueprint.validators.find((entry) => entry.title === title);
  assert(validator);
  return validator.compiledCode;
}

Deno.test("parameter application preserves the existing script encoding", () => {
  const source = script("host_state_nft.host_state_nft.mint");
  const params: Data[] = [new Constr(0, ["ab".repeat(32), 0n])];
  assertEquals(
    applyPlutusParameters(source, params),
    applyParamsToScript(source, params),
  );
});

Deno.test("parameter application accepts native Value builtins", () => {
  const source = script(
    "minting_tendermint_update_session.mint_tendermint_update_session.mint",
  );
  // The old parser rejects builtin 99 before a transaction can be built.
  assertThrows(() => applyParamsToScript(source, ["ab".repeat(28)]));
  assert(
    applyPlutusParameters(source, ["ab".repeat(28)]).length > source.length,
  );
});

Deno.test("parameter application retains typed parameter encoding", () => {
  const source = script("host_state_nft.host_state_nft.mint");
  type Params = [{ transactionId: string; outputIndex: bigint }];
  const schema = Data.Tuple([
    Data.Object({ transactionId: Data.Bytes(), outputIndex: Data.Integer() }),
  ]) as unknown as Params;
  const params: Params = [{ transactionId: "ab".repeat(32), outputIndex: 2n }];
  assertEquals(
    applyPlutusParameters(source, params, schema),
    applyParamsToScript(source, params, schema),
  );
});
