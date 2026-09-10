/// <reference no-default-lib="true" />
/// <reference lib="deno.worker" />

import { assertEquals } from "@std/assert";
import { Data } from "@lucid-evolution/lucid";
import {
  type ChannelAction,
  channelFixture,
  type ChannelParameters,
} from "./channel-fixture.ts";
import {
  assertTransactionAccepted,
  assertTransactionRejected,
} from "./transaction-fuzz.ts";

interface ChannelCase {
  action: ChannelAction;
  parameters: ChannelParameters;
}

async function checkCase({ action, parameters }: ChannelCase) {
  const fixture = await channelFixture(action, parameters);
  const txHash = await assertTransactionAccepted(fixture);
  const outputs = await fixture.lucid.utxosAt(
    fixture.channelScripts.base.address,
  );
  assertEquals(outputs.length, 1);
  assertEquals(outputs[0].txHash, txHash);
  assertEquals(Data.from(outputs[0].datum!), fixture.expectedChannelDatum);

  // Check the valid case first so a broken fixture cannot make all its
  // mutations appear to be correctly rejected.
  if ("policy" in action) {
    for (
      const mutation of [
        "missing_marker",
        "extra_marker",
        "wrong_marker_name",
      ] as const
    ) {
      try {
        await assertTransactionRejected(
          await channelFixture(action, parameters, mutation),
        );
      } catch (error) {
        throw new Error(`${action.name}: ${mutation}`, { cause: error });
      }
    }
  }
}

function describeError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const cause = error.cause === undefined
    ? ""
    : "\n" + describeError(error.cause);
  return (error.stack ?? error.message) + cause;
}

self.onmessage = async ({ data }: MessageEvent<ChannelCase>) => {
  try {
    await checkCase(data);
    self.postMessage({});
  } catch (error) {
    self.postMessage({ error: describeError(error) });
  }
};
