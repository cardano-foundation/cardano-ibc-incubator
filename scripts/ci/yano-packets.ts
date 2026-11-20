import { deploymentFromManifest } from "../../cardano/offchain/src/deployment-artifacts.ts";
import { assert } from "@std/assert";
import {
  CML,
  Data,
  fromText,
  generatePrivateKey,
  Lucid,
  type UTxO,
} from "@lucid-evolution/lucid";
import { createYanoContext } from "./yano-provider.ts";
import { createCardanoScalusEvaluator } from "../../cardano/offchain/src/scalus-evaluator.ts";
import { isolateEvaluation } from "../../cardano/offchain/src/testing/isolated-evaluation.ts";
import { packetCounterparty } from "../../cardano/offchain/src/testing/packet-counterparty.ts";
import {
  buildTransferIntent,
  encode,
  type PacketLaneDeployment,
  record,
  sha256,
} from "../../cardano/offchain/src/packet-lane-transactions.ts";

const wire = (value: unknown): unknown =>
  typeof value === "bigint"
    ? { bigint: String(value) }
    : Array.isArray(value)
    ? value.map(wire)
    : value && typeof value === "object"
    ? Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, wire(entry)]),
    )
    : value;
const json = (value: unknown) => JSON.stringify(wire(value));
const parse = (s: string) =>
  JSON.parse(
    s,
    (_, value) =>
      value && typeof value.bigint === "string" ? BigInt(value.bigint) : value,
  );
type Saved = {
  createdAt: number;
  checkpoint: { root: string; proofs: Record<string, string> };
  deployment: PacketLaneDeployment;
  history: UTxO[];
};

export async function createYanoPacketFixture(prepare = false) {
  const { lucid, provider, clock, address, base } = await createYanoContext();
  isolateEvaluation(lucid, provider);
  const manifest = deploymentFromManifest(JSON.parse(
    await Deno.readTextFile("deployments/bridge-manifest.json"),
  ));
  const saved: Partial<Saved> = prepare
    ? {}
    : parse(await Deno.readTextFile("packet-fixture.json"));
  const archive = new Map<string, UTxO>(
    (saved.history ?? []).map((u) => [`${u.txHash}#${u.outputIndex}`, u]),
  );
  const submit = provider.submitTx.bind(provider);
  provider.submitTx = async (cbor) => {
    const hash = await submit(cbor);
    await provider.awaitTx(hash, 100);
    const outputs = CML.Transaction.from_cbor_hex(cbor).body().outputs();
    const utxos = await provider.getUtxosByOutRef(
      Array.from(
        { length: outputs.len() },
        (_, outputIndex) => ({ txHash: hash, outputIndex }),
      ),
    );
    for (const utxo of utxos) archive.set(`${hash}#${utxo.outputIndex}`, utxo);
    return hash;
  };
  const tip = async () => {
    const response = await fetch(`${base}/node/tip`);
    if (!response.ok) throw new Error(await response.text());
    const value = await response.json();
    return { slot: value.slot, height: value.blockNumber, id: value.blockHash };
  };
  const genesis = JSON.parse(
    await Deno.readTextFile(Deno.env.get("YANO_GENESIS")!),
  );
  const eraSummaries = [{
    parameters: {
      safeZone: Math.ceil(3 * genesis.securityParam / genesis.activeSlotsCoeff),
    },
  }];
  const now = () => lucid.slotToUnixTime(lucid.unixTimeToSlot(Date.now()));
  const ownerSubmit = async (builder: ReturnType<typeof lucid.newTx>) => {
    const tx = await builder.complete({ localUPLCEval: false });
    const signed = await tx.sign.withWallet().complete();
    return await signed.submit();
  };
  async function seed(
    target: string,
    assets: Record<string, bigint>,
    datum: string,
  ) {
    const hash = await ownerSubmit(
      lucid.newTx().pay.ToContract(
        target,
        { kind: "inline", value: datum },
        assets,
      ),
    );
    const result = (await provider.getUtxos(target)).find((u) =>
      u.txHash === hash
    );
    assert(result, "Funded fixture output missing");
    return result;
  }
  async function runGateway(mode: "prepare" | "update") {
    const server = Deno.serve(
      { hostname: "127.0.0.1", port: 0, onListen() {} },
      async (request) => {
        if (request.headers.get("upgrade")?.toLowerCase() === "websocket") {
          const { socket, response } = Deno.upgradeWebSocket(request);
          socket.onmessage = async (event) => {
            const body = parse(String(event.data));
            try {
              if (body.method === "queryLedgerState/eraSummaries") {
                socket.send(
                  json({ jsonrpc: "2.0", id: body.id, result: eraSummaries }),
                );
                return;
              }
              if (
                !["queryLedgerState/tip", "queryNetwork/tip"].includes(
                  body.method,
                )
              ) throw new Error(`Unsupported fixture query ${body.method}`);
              socket.send(
                json({ jsonrpc: "2.0", id: body.id, result: await tip() }),
              );
            } catch (error) {
              socket.send(
                json({
                  jsonrpc: "2.0",
                  id: body.id,
                  error: { code: -32603, message: String(error) },
                }),
              );
            }
          };
          return response;
        }
        try {
          const body = parse(await request.text());
          let result;
          if (
            ["queryLedgerState/tip", "queryNetwork/tip"].includes(body.method)
          ) result = await tip();
          else if (body.method === "clock") {
            result = {
              now: now(),
              slot: lucid.unixTimeToSlot(now()),
            };
          } else if (body.method === "checkpoint") {
            const entries: Array<[string, string]> = [[
              "connections/connection-2",
              body.args[0],
            ], ["channelEnds/ports/transfer/channels/channel-7", body.args[1]]];
            for (let i = 1; i <= 8; i++) {
              entries.push([
                `acks/ports/transfer/channels/channel-7/sequences/${i}`,
                await sha256(fromText('{"result":"AQ=="}')),
              ]);
            }
            for (let i = 0; i < 6; i++) {
              entries.push([
                `padding/${i}`,
                fromText("fixture"),
              ]);
            }
            const checkpoint = await packetCounterparty(entries);
            saved.createdAt = Date.now();
            saved.checkpoint = {
              root: checkpoint.root,
              proofs: Object.fromEntries(
                Object.entries(checkpoint.proofs).map((
                  [key, proof],
                ) => [key, encode(proof)]),
              ),
            };
            result = true;
          } else if (body.method === "fixture") {
            const generated = await new Deno.Command("go", {
              cwd: new URL(
                "../../cosmos/cardano-probabilistic-light-client-core/",
                import.meta.url,
              ),
              args: [
                "run",
                "-mod=readonly",
                "../../tests/tendermint-cache/headers/main.go",
                "-time-ns",
                String(BigInt(now()) * 1_000_000n),
                "-app-hash",
                saved.checkpoint!.root,
              ],
              stdout: "piped",
              stderr: "piped",
            }).output();
            if (!generated.success) {
              throw new Error(
                new TextDecoder().decode(generated.stderr),
              );
            }
            result = {
              deployment: manifest,
              signer: address,
              clock,
              scenarios: JSON.parse(new TextDecoder().decode(generated.stdout)),
              checkpoint: saved.checkpoint,
            };
          } else if (body.method === "history") {
            result = [...archive.values()].filter((u) =>
              u.assets[body.args[0] + body.args[1]] === 1n
            );
          } else if (body.method === "packetDeployment") {
            saved.deployment = body.args[0];
            result = true;
          } else if (body.method === "signSubmit") {
            const signed = await lucid.fromTx(body.args[0]).sign.withWallet()
              .complete();
            result = { hash: await signed.submit() };
          } else if (
            [
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
            ].includes(body.method)
          ) {
            result = await (provider as any)[body.method](...body.args);
          } else throw new Error(`Unknown setup RPC: ${body.method}`);
          return new Response(json({ jsonrpc: "2.0", id: body.id, result }));
        } catch (error) {
          return new Response(json({ error: String(error) }), { status: 500 });
        }
      },
    );
    try {
      const child = await new Deno.Command("node", {
        cwd: new URL("../../cardano/gateway/", import.meta.url),
        args: [
          "src/scripts/ci/yano-packet-setup.cjs",
          `http://127.0.0.1:${server.addr.port}`,
          mode,
        ],
        stdout: "piped",
        stderr: "piped",
      }).output();
      console.log(new TextDecoder().decode(child.stdout));
      if (!child.success) {
        throw new Error(new TextDecoder().decode(child.stderr));
      }
    } finally {
      await server.shutdown();
    }
  }
  if (prepare) {
    await runGateway("prepare");
    saved.history = [...archive.values()];
    await Deno.writeTextFile("packet-fixture.json", json(saved));
  }
  assert(saved.deployment && saved.checkpoint);
  const proofs = new Map(
    Array.from(
      { length: 8 },
      (
        _,
        i,
      ) => [BigInt(i + 1), {
        height: record(1n, 10n),
        proof: Data.from(
          saved.checkpoint!
            .proofs[
              `acks/ports/transfer/channels/channel-7/sequences/${i + 1}`
            ],
        ) as ReturnType<typeof record>,
      }],
    ),
  );
  async function wallet() {
    const account = await Lucid(provider, "Custom", {
      slotConfig: clock,
      evaluator: createCardanoScalusEvaluator(),
    });
    account.selectWallet.fromPrivateKey(generatePrivateKey());
    const target = await account.wallet().address();
    await seed(target, { lovelace: 300_000_000n }, Data.void());
    await seed(target, { lovelace: 5_000_000n }, Data.void());
    return account;
  }
  return {
    get deployment() {
      return saved.deployment!;
    },
    provider,
    clock,
    tip,
    now,
    wallet,
    seed,
    proofs,
    eraSummaries,
    proofHeight: { revision_number: 1n, revision_height: 10n },
    replaceClientReference: async () => {
      await runGateway("update");
      return {
        client: saved.deployment!.client,
        scripts: saved.deployment!.scripts,
      };
    },
    admit: async (count: number) => {
      const hashes: string[] = [];
      for (let i = 0; i < count; i++) {
        const user = await wallet();
        const builder = await buildTransferIntent(user, saved.deployment!, {
          amount: 2_000_000n,
          receiver: "cosmos1receiver",
          timeoutTimestamp: BigInt(now() + 3_600_000) * 1_000_000n,
        });
        const signed = await (await builder.complete({ localUPLCEval: false }))
          .sign.withWallet().complete();
        const inputs = signed.toTransaction().body().inputs();
        const refs = Array.from(
          { length: inputs.len() },
          (_, n) => ({
            txHash: inputs.get(n).transaction_id().to_hex(),
            outputIndex: Number(inputs.get(n).index()),
          }),
        );
        const awaitAddress = await user.wallet().address();
        assert(
          (await provider.getUtxosByOutRef(refs)).every((u) =>
            u.address === awaitAddress
          ),
          "Intent admission consumed protocol state",
        );
        hashes.push(await signed.submit());
      }
      const intents = (await provider.getUtxos(saved.deployment!.guardAddress))
        .filter((u) => hashes.includes(u.txHash));
      assert(intents.length === count);
      return { intents };
    },
  };
}
if (import.meta.main) await createYanoPacketFixture(true);
