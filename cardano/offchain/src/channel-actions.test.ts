import { assert, assertEquals, assertRejects } from "@std/assert";
import { Data, validatorToAddress } from "@lucid-evolution/lucid";
import {
  channelActions,
  channelFixture,
  defaultChannelParameters,
} from "./testing/channel-fixture.ts";

const encode = (data: Data) => Data.to(data);

// ChannelCloseConfirm delegates continuation checks to its operation policy,
// so cover both the regular spending path and the delegated close path.
for (const action of [channelActions[2], channelActions[5]]) {
  for (
    const mutation of [
      "host_ada_sweep",
      "channel_ada_sweep",
      "host_asset_sweep",
      "channel_asset_sweep",
    ] as const
  ) {
    Deno.test(action.name + " rejects " + mutation, async () => {
      const { tx } = await channelFixture(
        action,
        defaultChannelParameters,
        mutation,
      );
      await assertRejects(
        () => tx.complete({ localUPLCEval: true }),
        Error,
        "failed script execution",
      );
    });
  }
}

for (const action of channelActions) {
  Deno.test(
    action.name + " evaluates and submits with the deployed script purposes",
    async () => {
      const { tx, emulator, lucid, channelToken, channelScripts } =
        await channelFixture(action);
      // Emulator.evaluateTx only echoes budgets. Explicitly enable real UPLC
      // evaluation so a mint routed to an Aiken spend-only script fails this test.
      const completed = await tx.complete({ localUPLCEval: true });
      const signed = await completed.sign.withWallet().complete();
      const txHash = await signed.submit();
      emulator.awaitBlock();
      const outputs = await lucid.utxosAt(channelScripts.base.address);
      assertEquals(outputs.length, 1);
      assertEquals(outputs[0].txHash, txHash);
      assertEquals(
        outputs[0]
          .assets[
            String(channelToken.fields[0]) + String(channelToken.fields[1])
          ],
        1n,
      );
      assert(completed.toTransaction().witness_set().redeemers());
    },
  );
}

for (
  const name of ["chan_open_confirm", "chan_close_init", "chan_close_confirm"]
) {
  Deno.test(name + " rejects execution as a spending validator", async () => {
    const { lucid, channelScripts, seed, reference, account, channelToken } =
      await channelFixture(channelActions[4]);
    const operation = channelScripts.referredScripts[name];
    const input = seed(validatorToAddress("Custom", operation.script), {
      lovelace: 10_000_000n,
    }, Data.void());
    await assertRejects(
      () =>
        lucid.newTx().readFrom([reference(operation.script)])
          .collectFrom([input], encode(channelToken))
          .pay.ToAddress(account.address, { lovelace: 5_000_000n })
          .complete({ localUPLCEval: true }),
      Error,
      "failed script execution Spend[",
    );
  });
}
