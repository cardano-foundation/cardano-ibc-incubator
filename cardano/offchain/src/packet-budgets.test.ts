import { assert } from "@std/assert";
import { CML } from "@lucid-evolution/lucid";
import { sendPacketFixture } from "./testing/send-budget-fixture.ts";
import {
  prunePacketFixture,
  receivePacketFixture,
} from "./testing/packet-budget-fixture.ts";
import { channelActions, channelFixture } from "./testing/channel-fixture.ts";

const scenarios = [
  {
    name: "First native SendPacket creates escrow at 64 commitments",
    build: sendPacketFixture,
  },
  ...[false, true].flatMap((ordered) => [
    {
      name: `PrunePacketHistory ${
        ordered ? "ordered" : "unordered"
      } at capacity`,
      build: () => prunePacketFixture(ordered),
    },
    {
      name: `RecvPacket generic application ${
        ordered ? "ordered" : "unordered"
      } fills history capacity`,
      build: () => receivePacketFixture(ordered),
    },
  ]),
  ...channelActions.map((action) => ({
    name: action.name,
    build: () => channelFixture(action),
  })),
];

for (const { name, build } of scenarios) {
  Deno.test(`${name} fits ledger limits`, async () => {
    const { tx, emulator, lucid } = await build();
    // Emulator.evaluateTx only echoes budgets. This evaluates the compiled UPLC.
    const completed = await tx.complete({ localUPLCEval: true });
    const signed = await completed.sign.withWallet().complete();
    const redeemers = signed.toTransaction().witness_set().redeemers();
    assert(redeemers, "transaction must execute scripts");
    const units = CML.compute_total_ex_units(redeemers);
    const bytes = signed.toCBOR().length / 2;
    const limits = lucid.config().protocolParameters;
    assert(limits);
    console.log({ bytes, memory: units.mem(), cpu: units.steps() });
    assert(
      bytes <= limits.maxTxSize,
      `signed transaction is ${bytes} bytes, limit is ${limits.maxTxSize}`,
    );
    assert(
      units.mem() <= limits.maxTxExMem,
      `memory is ${units.mem()}, limit is ${limits.maxTxExMem}`,
    );
    assert(
      units.steps() <= limits.maxTxExSteps,
      `CPU is ${units.steps()}, limit is ${limits.maxTxExSteps}`,
    );
    await signed.submit();
    emulator.awaitBlock();
  });
}
