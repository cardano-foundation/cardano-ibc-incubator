/** Real Gateway services and builders, with a disposable emulator provider. */
import { Data } from "@lucid-evolution/lucid";
import { assert, assertRejects } from "@std/assert";
import { packetLaneFixture } from "../src/testing/packet-lane-fixture.ts";
import {
  buildTransferIntent,
  encode,
  record,
} from "../src/packet-lane-transactions.ts";

const fixture = await packetLaneFixture();
const { intents } = await fixture.admit(5);
const relayer = await fixture.wallet();
const signer = await relayer.wallet().address();
await assertRejects(
  () =>
    buildTransferIntent(relayer, fixture.deployment, {
      amount: 2_000_000n,
      receiver: "cosmos1receiver",
      timeoutTimestamp: 1n << 80n,
    }),
  Error,
  "Invalid funded intent",
);
for (let i = 0; i < 8; i++) {
  fixture.seed(signer, { lovelace: 30_000_000n }, Data.void());
}
const original = Data.from(intents[0].datum!);
let invalidCount = 0;
const poison = (datum: Data, lovelace = 5_000_000n) => {
  fixture.seed(fixture.deployment.guardAddress, { lovelace }, encode(datum));
  invalidCount++;
};
poison(42n);
const copy = () => Data.from(encode(original)) as ReturnType<typeof record>;
const malformed = copy();
malformed.fields[2] = 42n;
poison(malformed);
poison(copy(), 1_500_000n);
const expired = copy();
expired.fields[4] = BigInt(fixture.emulator.now() - 1) * 1_000_000n;
poison(expired);
const overflow = copy();
overflow.fields[4] = 1n << 80n;
poison(overflow);
const badUtf8 = copy();
(badUtf8.fields[3] as ReturnType<typeof record>).fields[4] = "ff";
poison(badUtf8);
const oversized = copy();
(oversized.fields[3] as ReturnType<typeof record>).fields[4] = "00".repeat(
  10_000,
);
poison(oversized, 100_000_000n);
const wire = (value: unknown): unknown => {
  if (typeof value === "bigint") return { bigint: value.toString() };
  if (Array.isArray(value)) return value.map(wire);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, wire(entry)]),
    );
  }
  return value;
};
const json = (value: unknown) => JSON.stringify(wire(value));
const parse = (value: string) =>
  JSON.parse(
    value,
    (_, v) => v && typeof v.bigint === "string" ? BigInt(v.bigint) : v,
  );
const methods = new Set([
  "getProtocolParameters",
  "getUtxos",
  "getUtxosWithUnit",
  "getUtxoByUnit",
  "getUtxosByOutRef",
  "getDatum",
  "getDelegation",
  "evaluateTx",
  "awaitTx",
  "submitTx",
]);
const server = Deno.serve(
  { hostname: "127.0.0.1", port: 0, onListen() {} },
  async (request) => {
    if (request.headers.get("upgrade")?.toLowerCase() === "websocket") {
      const { socket, response } = Deno.upgradeWebSocket(request);
      socket.onmessage = (event) => {
        const body = parse(String(event.data));
        if (
          !["queryLedgerState/tip", "queryNetwork/tip"].includes(body.method)
        ) {
          socket.send(
            json({
              jsonrpc: "2.0",
              id: body.id,
              error: { code: -32601, message: "Unsupported fixture query" },
            }),
          );
          return;
        }
        socket.send(
          json({
            jsonrpc: "2.0",
            id: body.id,
            result: {
              slot: fixture.emulator.slot,
              height: fixture.emulator.blockHeight,
              id: "00".repeat(32),
            },
          }),
        );
      };
      return response;
    }
    try {
      const body = parse(await request.text());
      let result;
      if (["queryLedgerState/tip", "queryNetwork/tip"].includes(body.method)) {
        result = {
          slot: fixture.emulator.slot,
          height: fixture.emulator.blockHeight,
          id: "00".repeat(32),
        };
      } else if (body.method === "fixture") {
        result = {
          deployment: fixture.deployment,
          signer,
          clock: {
            zeroTime: fixture.emulator.now() - fixture.emulator.slot * 1_000,
            zeroSlot: 0,
            slotLength: 1_000,
          },
          validHashes: intents.map((u) => u.txHash),
          invalidCount,
          proofs: Object.fromEntries(
            [...fixture.proofs].map((
              [sequence, p],
            ) => [sequence.toString(), encode(p.proof)]),
          ),
        };
      } else if (body.method === "signSubmit") {
        const tx = await relayer.fromTx(body.args[0]).sign.withWallet()
          .complete();
        result = await tx.submit();
        fixture.emulator.awaitBlock();
      } else if (methods.has(body.method)) {
        const provider = fixture.emulator as unknown as Record<
          string,
          (...args: unknown[]) => Promise<unknown>
        >;
        result = await provider[body.method](...body.args);
      } else throw new Error(`Unsupported fixture RPC ${body.method}`);
      return new Response(json({ jsonrpc: "2.0", id: body.id, result }), {
        headers: { "content-type": "application/json" },
      });
    } catch (error) {
      return new Response(json({ error: String(error) }), { status: 500 });
    }
  },
);
try {
  const child = await new Deno.Command("node", {
    cwd: new URL("../../gateway/", import.meta.url),
    args: [
      "src/scripts/ci/packet-executor-backlog.cjs",
      `http://127.0.0.1:${server.addr.port}`,
    ],
    stdout: "piped",
    stderr: "piped",
  }).output();
  console.log(new TextDecoder().decode(child.stdout));
  if (!child.success) console.error(new TextDecoder().decode(child.stderr));
  assert(child.success, "Production Gateway backlog integration failed");
} finally {
  await server.shutdown();
}
