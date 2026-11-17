/** Real Gateway services and builders, with a disposable emulator or Yano provider. */
import { Data } from "@lucid-evolution/lucid";
import { assert, assertRejects } from "@std/assert";
import { packetLaneFixture } from "../src/testing/packet-lane-fixture.ts";
import {
  buildTransferIntent,
  encode,
  record,
} from "../src/packet-lane-transactions.ts";

const started = performance.now();
const native = Deno.env.get("YANO_URL")
  ? await (await import("../../../scripts/ci/yano-packets.ts"))
    .createYanoPacketFixture()
  : undefined;
const emulator = native ? undefined : await packetLaneFixture();
const fixture = native ?? emulator!;
const provider = native?.provider ?? emulator!.emulator;
const now = () => native ? native.now() : emulator!.emulator.now();
const tip = async () =>
  native ? await native.tip() : ({
    slot: emulator!.emulator.slot,
    height: emulator!.emulator.blockHeight,
    id: "00".repeat(32),
  });
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
  await fixture.seed(signer, { lovelace: 30_000_000n }, Data.void());
}
const original = Data.from(intents[0].datum!);
let invalidCount = 0;
const poison = async (datum: Data, lovelace = 5_000_000n) => {
  await fixture.seed(
    fixture.deployment.guardAddress,
    { lovelace },
    encode(datum),
  );
  invalidCount++;
};
await poison(42n);
const copy = () => Data.from(encode(original)) as ReturnType<typeof record>;
const malformed = copy();
malformed.fields[2] = 42n;
await poison(malformed);
await poison(copy(), 1_500_000n);
const expired = copy();
expired.fields[4] = BigInt(now() - 1) * 1_000_000n;
await poison(expired);
const overflow = copy();
overflow.fields[4] = 1n << 80n;
await poison(overflow);
const badUtf8 = copy();
(badUtf8.fields[3] as ReturnType<typeof record>).fields[4] = "ff";
await poison(badUtf8);
const oversized = copy();
(oversized.fields[3] as ReturnType<typeof record>).fields[4] = "00".repeat(
  10_000,
);
await poison(oversized, 100_000_000n);
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
      socket.onmessage = async (event) => {
        const body = parse(String(event.data));
        if (native && body.method === "queryLedgerState/eraSummaries") {
          socket.send(
            json({ jsonrpc: "2.0", id: body.id, result: native.eraSummaries }),
          );
          return;
        }
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
            result: await tip(),
          }),
        );
      };
      return response;
    }
    try {
      const body = parse(await request.text());
      let result;
      if (["queryLedgerState/tip", "queryNetwork/tip"].includes(body.method)) {
        result = await tip();
      } else if (body.method === "fixture") {
        result = {
          deployment: fixture.deployment,
          signer,
          proofHeight: native?.proofHeight,
          clock: native?.clock ?? {
            zeroTime: emulator!.emulator.now() -
              emulator!.emulator.slot * 1_000,
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
      } else if (body.method === "replaceClientReference") {
        if (native) result = await native.replaceClientReference();
        else {
          // Model an included client update. The lease test concerns output
          // liveness, so preserve authenticated state while replacing its outref.
          const old = fixture.deployment.client;
          delete emulator!.emulator.ledger[old.txHash + old.outputIndex];
          fixture.deployment.client = emulator!.seed(
            old.address,
            old.assets,
            old.datum!,
          );
          emulator!.emulator.awaitBlock();
          result = fixture.deployment.client;
        }
      } else if (body.method === "signSubmit") {
        const tx = await relayer.fromTx(body.args[0]).sign.withWallet()
          .complete();
        result = await tx.submit();
        emulator?.emulator.awaitBlock();
      } else if (methods.has(body.method)) {
        const methodsProvider = provider as unknown as Record<
          string,
          (...args: unknown[]) => Promise<unknown>
        >;
        result = await methodsProvider[body.method](...body.args);
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
  const report = JSON.parse(
    new TextDecoder().decode(child.stdout).trim().split("\n").at(-1)!,
  );
  console.log(
    JSON.stringify({
      ...report,
      passed: true,
      seconds: (performance.now() - started) / 1000,
    }),
  );
} finally {
  await server.shutdown();
}
