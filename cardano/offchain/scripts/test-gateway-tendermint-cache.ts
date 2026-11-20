import { deploymentFromManifest } from "../src/deployment-artifacts.ts";
/** Production Gateway requests, native evaluation and ordinary signed responses. */
import { assert } from "@std/assert";
import {
  CML,
  credentialToAddress,
  getAddressDetails,
  Lucid,
  PROTOCOL_PARAMETERS_DEFAULT,
  type UTxO,
} from "@lucid-evolution/lucid";
import { Emulator, generateEmulatorAccount } from "@lucid-evolution/provider";
import { createDeployment } from "../src/deployment.ts";
import {
  createCardanoScalusEvaluator,
  customEmulatorSlotConfig,
} from "../src/scalus-evaluator.ts";
import { isolateEvaluation } from "../src/testing/isolated-evaluation.ts";
import { evaluatedUpdateBudget } from "../src/tendermint-cache-routing.ts";
import parameters from "./fixtures/mainnet-protocol-parameters.json" with {
  type: "json",
};

const started = performance.now();
async function setup() {
  if (Deno.env.get("YANO_URL")) {
    const { createYanoContext } = await import(
      "../../../scripts/ci/yano-provider.ts"
    );
    const context = await createYanoContext();
    return {
      ...context,
      emulator: undefined,
      signer: context.address,
      selectWallet: () =>
        context.lucid.selectWallet.fromPrivateKey(context.key),
    };
  }
  const account = generateEmulatorAccount({ lovelace: 200_000_000n });
  account.address = credentialToAddress(
    "Custom",
    getAddressDetails(account.address).paymentCredential!,
  );
  const emulator = new Emulator(Array.from({ length: 50 }, () => account), {
    ...PROTOCOL_PARAMETERS_DEFAULT,
    maxTxSize: parameters.maxTxSize,
    maxTxExMem: BigInt(parameters.maxTxExMem),
    maxTxExSteps: BigInt(parameters.maxTxExSteps),
    coinsPerUtxoByte: BigInt(parameters.coinsPerUtxoByte),
    minFeeA: parameters.minFeeA,
    minFeeB: parameters.minFeeB,
    priceMem: parameters.priceMem,
    priceStep: parameters.priceStep,
    minFeeRefScriptCostPerByte: parameters.minFeeRefScriptCostPerByte,
  });
  emulator.protocolParameters.costModels.PlutusV3 =
    parameters.plutusV3CostModel;
  emulator.time = Math.floor(Date.now() / 1000) * 1000;
  const clock = customEmulatorSlotConfig(emulator);
  const lucid = await Lucid(emulator, "Custom", {
    evaluator: createCardanoScalusEvaluator(),
    slotConfig: clock,
  });
  lucid.selectWallet.fromSeed(account.seedPhrase, {
    addressType: "Enterprise",
  });
  return {
    lucid,
    provider: emulator,
    emulator,
    clock,
    signer: account.address,
    selectWallet: () =>
      lucid.selectWallet.fromSeed(account.seedPhrase, {
        addressType: "Enterprise",
      }),
  };
}
const { lucid, provider, emulator, clock, signer, selectWallet } =
  await setup();
isolateEvaluation(lucid, provider);
const now = () =>
  emulator
    ? emulator.now()
    : lucid.slotToUnixTime(lucid.unixTimeToSlot(Date.now()));
const currentSlot = () =>
  emulator ? emulator.slot : lucid.unixTimeToSlot(now());
const archive = new Map<string, UTxO & { blockNo: number }>();
const transactions = new Map<string, string>();
const submit = provider.submitTx.bind(provider);
provider.submitTx = async (cbor) => {
  const tx = CML.Transaction.from_cbor_hex(cbor);
  assert(
    cbor.length / 2 <= parameters.maxTxSize,
    "Complete signed transaction exceeds ledger size",
  );
  if (tx.witness_set().redeemers()?.to_flat_format().len()) {
    const budget = evaluatedUpdateBudget(
      { toTransaction: () => tx, toCBOR: () => cbor } as never,
      parameters,
      0,
    );
    assert(
      budget.withinLedger,
      `Complete signed transaction exceeds ledger resources: ${
        JSON.stringify(budget.measured)
      }`,
    );
  }
  const hash = await submit(cbor);
  let blockNo: number;
  if (emulator) {
    emulator.awaitBlock();
    blockNo = emulator.blockHeight;
  } else {
    await provider.awaitTx(hash, 100);
    const response = await fetch(
      `${Deno.env.get("YANO_URL")}/txs/${hash}/status`,
    );
    const status = await response.json();
    assert(
      response.ok && status.status === "in_block" &&
        Number.isSafeInteger(status.block_height),
    );
    blockNo = status.block_height;
  }
  transactions.set(hash, cbor);
  const refs = Array.from(
    { length: tx.body().outputs().len() },
    (_, outputIndex) => ({ txHash: hash, outputIndex }),
  );
  for (const utxo of await provider.getUtxosByOutRef(refs)) {
    archive.set(`${hash}#${utxo.outputIndex}`, {
      ...structuredClone(utxo),
      blockNo,
    });
  }
  return hash;
};
const authority = getAddressDetails(signer).paymentCredential!.hash;
const log = console.log;
let deployment;
try {
  console.log = () => {};
  deployment = Deno.env.get("YANO_URL")
    ? deploymentFromManifest(
      JSON.parse(await Deno.readTextFile("deployments/bridge-manifest.json")),
    )
    : await createDeployment(lucid, "emulator", {
      deploymentMode: "upgradeable",
      migration: {
        governance: { signers: [authority], quorum: 1n, delay_ms: 86_400_000n },
        emergency: { signers: ["77".repeat(28)], quorum: 1n },
        bootstrapSigners: [authority],
      },
    });
} finally {
  console.log = log;
}
const setupSeconds = (performance.now() - started) / 1000;
const generated = await new Deno.Command("go", {
  cwd: new URL(
    "../../../cosmos/cardano-probabilistic-light-client-core/",
    import.meta.url,
  ),
  args: [
    "run",
    "-mod=readonly",
    "../../tests/tendermint-cache/headers/main.go",
    "-time-ns",
    String(BigInt(now()) * 1_000_000n),
  ],
  stdout: "piped",
  stderr: "piped",
}).output();
if (!generated.success) {
  throw new Error(new TextDecoder().decode(generated.stderr));
}
const scenarios = JSON.parse(new TextDecoder().decode(generated.stdout));
const wire = (value: unknown): unknown =>
  typeof value === "bigint"
    ? { bigint: value.toString() }
    : Array.isArray(value)
    ? value.map(wire)
    : value && typeof value === "object"
    ? Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, wire(item)]),
    )
    : value;
const json = (value: unknown) => JSON.stringify(wire(value));
const parse = (value: string) =>
  JSON.parse(
    value,
    (_, v) => v && typeof v.bigint === "string" ? BigInt(v.bigint) : v,
  );
const signingEvidence: unknown[] = [];
let policyManifest: unknown;
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
    try {
      const body = parse(await request.text());
      let result;
      if (body.method === "fixture") {
        result = {
          deployment,
          scenarios,
          signer,
          clock,
        };
      } else if (body.method === "policyManifest") {
        policyManifest = body.args[0];
        result = true;
      } else if (body.method === "clock") {
        result = {
          now: now(),
          slot: currentSlot(),
        };
      } else if (body.method === "referencePrice") {
        const protocol = await provider.getProtocolParameters();
        protocol.minFeeRefScriptCostPerByte = body.args[0];
        provider.getProtocolParameters = () => Promise.resolve(protocol);
        result = true;
      } else if (body.method === "history") {
        const [policy, name] = body.args;
        result = [...archive.values()].filter((u) =>
          u.assets[policy + name] === 1n
        ).map((u) => ({ ...u, assetsPolicy: policy, assetsName: name }));
      } else if (body.method === "evidence") {
        const cbor = transactions.get(body.args[0]);
        if (!cbor) throw new Error("Missing confirmed transaction evidence");
        const tx = CML.Transaction.from_cbor_hex(cbor);
        const redeemers = tx.witness_set().redeemers()?.to_flat_format();
        result = {
          txBodyCborHex: tx.body().to_cbor_hex(),
          redeemers: Array.from({ length: redeemers?.len() ?? 0 }, (_, i) => {
            const r = redeemers!.get(i);
            return {
              type: ["spend", "mint", "cert", "reward"][r.tag()],
              index: r.index(),
              data: r.data().to_cbor_hex(),
            };
          }),
        };
      } else if (body.method === "signSubmit") {
        selectWallet();
        const unsigned = CML.Transaction.from_cbor_hex(body.args[0]).body();
        const resolve = async (refs: CML.TransactionInputList | undefined) => {
          const keys = Array.from({ length: refs?.len() ?? 0 }, (_, i) => {
            const ref = refs!.get(i);
            return {
              txHash: ref.transaction_id().to_hex(),
              outputIndex: Number(ref.index()),
            };
          });
          const utxos = await provider.getUtxosByOutRef(keys);
          assert(
            utxos.length === keys.length,
            "Signing evidence has unresolved inputs",
          );
          return utxos.map((u) => ({
            txHash: u.txHash,
            outputIndex: u.outputIndex,
            address: CML.Address.from_bech32(u.address).to_hex(),
            lovelace: String(u.assets.lovelace),
            datum: u.datum,
            assets: Object.entries(u.assets).filter(([unit]) =>
              unit !== "lovelace"
            ).map(([unit, amount]) => ({
              policy: unit.slice(0, 56),
              name: unit.slice(56),
              quantity: String(amount),
            })),
          }));
        };
        const regular = await resolve(unsigned.inputs());
        const collateral = await resolve(unsigned.collateral_inputs());
        const signed = await lucid.fromTx(body.args[0]).sign.withWallet()
          .complete();
        const fee = Number(signed.toTransaction().body().fee());
        const hash = await signed.submit();
        signingEvidence.push({
          cbor: body.args[0],
          request: body.args[1],
          regular,
          collateral,
        });
        result = { hash, fee };
      } else if (methods.has(body.method)) {
        result = await (provider as unknown as Record<
          string,
          (...args: unknown[]) => Promise<unknown>
        >)[body.method](...body.args);
      } else throw new Error(`Unsupported fixture method ${body.method}`);
      return new Response(json({ result }), {
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
      "src/scripts/ci/tendermint-cache.cjs",
      `http://127.0.0.1:${server.addr.port}`,
    ],
    stdout: "piped",
    stderr: "piped",
  }).output();
  console.log(new TextDecoder().decode(child.stdout));
  if (!child.success) console.error(new TextDecoder().decode(child.stderr));
  const evidencePath = Deno.env.get("IBC_CACHE_SIGNING_EVIDENCE");
  if (evidencePath) {
    await Deno.writeTextFile(
      evidencePath,
      JSON.stringify({
        manifest: policyManifest,
        transactions: signingEvidence,
      }),
    );
  }
  assert(child.success, "Production Gateway cached-client integration failed");
  const report = JSON.parse(
    new TextDecoder().decode(child.stdout).trim().split("\n").at(-1)!,
  );
  console.log(
    JSON.stringify({
      passed: true,
      ...report,
      setupSeconds,
      seconds: (performance.now() - started) / 1000,
    }),
  );
} finally {
  await server.shutdown();
}
