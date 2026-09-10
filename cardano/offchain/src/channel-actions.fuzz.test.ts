import fc from "fast-check";
import {
  channelActions,
  type ChannelParameters,
} from "./testing/channel-fixture.ts";
import {
  runTransactionCase,
  transactionFuzzParameters,
} from "./testing/transaction-fuzz.ts";

const identifier = fc.stringOf(
  fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz0123456789"),
  { minLength: 2, maxLength: 16 },
);
const sequence = fc.integer({ min: 0, max: 65_535 });
const parameters: fc.Arbitrary<ChannelParameters> = fc.record({
  channelSequence: sequence,
  clientSequence: sequence,
  connectionSequence: sequence,
  remoteChannelSequence: sequence,
  remoteConnectionSequence: sequence,
  port: identifier,
  remotePort: identifier,
  version: identifier,
  ordered: fc.boolean(),
});

// Run every action and mutation so random selection cannot omit an operation.
// The generated values change token names, state-tree keys,
// proof contents and the actual ordered/unordered channel branch.
for (const action of channelActions) {
  Deno.test(`${action.name} validates generated transactions and marker mutations`, async () => {
    await fc.assert(
      fc.asyncProperty(parameters, async (sample) => {
        await runTransactionCase(
          new URL("./testing/channel-case.worker.ts", import.meta.url),
          { action, parameters: sample },
        );
      }),
      transactionFuzzParameters(),
    );
  });
}
