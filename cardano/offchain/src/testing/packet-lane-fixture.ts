import { assert } from "@std/assert";
import {
  applyDoubleCborEncoding,
  CML,
  Constr,
  credentialToAddress,
  Data,
  fromText,
  Lucid,
  type LucidEvolution,
  SLOT_CONFIG_NETWORK,
  type TxBuilder,
  type UTxO,
} from "@lucid-evolution/lucid";
import { generateEmulatorAccount } from "@lucid-evolution/provider";
import parameters from "../../scripts/fixtures/mainnet-protocol-parameters.json" with {
  type: "json",
};
import { readValidator } from "../utils.ts";
import {
  channelActions,
  channelFixture,
  defaultChannelParameters,
  membershipProof,
} from "./channel-fixture.ts";
import {
  completeTransaction,
  isolateEvaluation,
} from "./isolated-evaluation.ts";
import {
  buildPacketLaneInitialization,
  buildTransferIntent,
  encode,
  type PacketLaneDeployment,
  record,
  sha256,
} from "../packet-lane-transactions.ts";

// Seed only the authenticated pre-state and test-wallet funds. Admission,
// batching and packet completion are balanced, signed transactions executing
// the compiled validators with the pinned mainnet protocol parameters.
export async function packetLaneFixture(laneCount = 16) {
  const node = Deno.env.get("PACKET_LANE_NODE_URL");
  let clock: { time: number; slot: number } | undefined;
  if (node) {
    const start = await nodeRpc(node, "queryNetwork/startTime", {});
    const tip = await nodeRpc(node, "queryLedgerState/tip", {});
    clock = { time: Date.parse(start) + tip.slot * 1_000, slot: tip.slot };
  }
  const fixture = await channelFixture(
    channelActions[4],
    {
      ...defaultChannelParameters,
      port: "transfer",
      remotePort: "transfer",
      version: "ics20-1",
      ordered: false,
    },
    "none",
    clock,
  );
  const { emulator, seed, channelToken, packetContext: context } = fixture;
  Object.assign(emulator.protocolParameters, {
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
  const locked = credentialToAddress("Custom", {
    type: "Script",
    hash: "fe".repeat(28),
  });
  const configToken = record("98".repeat(28), fromText("ibc_packet_config"));
  const [stateScript, statePolicy, registryAddress] = readValidator(
    "minting_packet_lanes.minting_packet_lanes.mint",
    fixture.lucid,
    [record("97".repeat(32), 0n), configToken, channelToken.fields[0]],
  );
  const metadataHash = "95".repeat(28);
  const [voucherScript, voucherPolicy] = readValidator(
    "minting_voucher.mint_voucher.mint",
    fixture.lucid,
    [
      record("94".repeat(28), "01"),
      record("94".repeat(28), "02"),
      metadataHash,
      channelToken.fields[0],
      "93".repeat(28),
      configToken,
    ],
  );
  const [traceScript, traceHash, traceAddress] = readValidator(
    "trace_registry.spend_trace_registry.spend",
    fixture.lucid,
    [
      "94".repeat(28),
      record("94".repeat(28), "02"),
      voucherPolicy,
      "",
      "93".repeat(28),
    ],
  );
  const operations: PacketLaneDeployment["operations"] = {};
  for (
    const name of [
      "send",
      "acknowledge",
      "timeout",
      "reject",
      "receive",
      "prune",
      "timeout_on_close",
      "retire",
      "funds",
      "send_funds",
    ]
  ) {
    const params = ["funds", "send_funds"].includes(name)
      ? [configToken, voucherPolicy]
      : [
        configToken,
        channelToken.fields[0],
        statePolicy,
        "11".repeat(28),
        "22".repeat(28),
        BigInt(laneCount),
        voucherPolicy,
        ...(!["send", "retire"].includes(name) ? [context.verifyPolicy] : []),
      ];
    const [script, policy] = readValidator(
      `packet_${name}.packet_${name}.mint`,
      fixture.lucid,
      params,
    );
    operations[name] = {
      policy,
      reference: seed(locked, { lovelace: 100_000_000n }, Data.void(), {
        ...script,
        script: applyDoubleCborEncoding(script.script),
      }),
    };
  }
  const [batchScript, batchPolicy, batchAddress] = readValidator(
    "packet_lane_batch.packet_lane_batch.mint",
    fixture.lucid,
    [
      channelToken.fields[0],
      record(...Object.values(operations).map((v) => v.policy)),
    ],
  );
  const [guardScript, guardHash, guardAddress] = readValidator(
    "packet_lane_guard.packet_lane_guard.spend",
    fixture.lucid,
    [batchPolicy, statePolicy],
  );
  const scripts = [batchScript, guardScript, stateScript, voucherScript].map((
    script,
  ) =>
    seed(locked, { lovelace: 100_000_000n }, Data.void(), {
      ...script,
      script: applyDoubleCborEncoding(script.script),
    })
  );
  const proofVerifier = {
    policy: context.verifyPolicy,
    reference: seed(locked, { lovelace: 100_000_000n }, Data.void(), {
      ...context.verifyScript,
      script: applyDoubleCborEncoding(context.verifyScript.script),
    }),
  };
  const channelUnit = String(channelToken.fields[0]) +
    String(channelToken.fields[1]);
  const channel =
    Object.values(emulator.ledger).find(({ utxo }) =>
      utxo.assets[channelUnit] === 1n
    )!.utxo;
  channel.datum = encode(context.channelDatum(3));
  // Protect fixture references from wallet coin selection.
  channel.address = locked;
  context.client.address = locked;
  context.connection.address = locked;
  const configuration = seed(
    locked,
    {
      lovelace: 5_000_000n,
      [String(configToken.fields[0]) + String(configToken.fields[1])]: 1n,
    },
    encode(
      record(statePolicy, batchPolicy, guardHash, BigInt(laneCount), traceHash),
    ),
  );
  seed(registryAddress, {
    lovelace: 5_000_000n,
    [statePolicy + fromText("ibc_packet_registry")]: 1n,
  }, encode(record(0n)));
  const deployment: PacketLaneDeployment = {
    operations,
    proofVerifier,
    voucherPolicy,
    batchPolicy,
    batchAddress,
    guardAddress,
    statePolicy,
    laneCount,
    channel,
    connection: context.connection,
    client: context.client,
    scripts,
  };
  const proofs = new Map<
    bigint,
    { height: Constr<Data>; proof: Constr<Data> }
  >();
  const client = Data.from(context.client.datum!) as Constr<Data>;
  const state = client.fields[0] as Constr<Data>;
  const cs = state.fields[0] as Constr<Data>;
  // A single authenticated remote checkpoint covers all eight acknowledgement
  // leaves. Internal IAVL nodes use length-prefixed SHA-256 child hashes.
  const height = record(1n, 18n);
  const entries = [];
  for (let sequence = 1n; sequence <= 8n; sequence++) {
    const membership = await membershipProof(
      fromText(`acks/ports/transfer/channels/channel-7/sequences/${sequence}`),
      await sha256(fromText('{"result":"AQ=="}')),
    );
    const layers = membership.proof.fields[0] as Constr<Data>[];
    const existence = (layers[0].fields[0] as Constr<Data>).fields[0] as Constr<
      Data
    >;
    const outer = (layers[1].fields[0] as Constr<Data>).fields[0] as Constr<
      Data
    >;
    entries.push({
      sequence,
      proof: membership.proof,
      existence,
      outer,
      hash: outer.fields[1] as string,
    });
  }
  let nodes = entries.map((entry) => ({ hash: entry.hash, entries: [entry] }));
  for (let level = 1; nodes.length > 1; level++) {
    const next = [];
    for (let i = 0; i < nodes.length; i += 2) {
      const left = nodes[i], right = nodes[i + 1];
      const prefix = (level * 2).toString(16).padStart(2, "0") +
        (2 ** (level + 1)).toString(16).padStart(2, "0") + "02";
      for (const entry of left.entries) {
        (entry.existence.fields[3] as Data[]).push(
          record(1n, prefix + "20", "20" + right.hash),
        );
      }
      for (const entry of right.entries) {
        (entry.existence.fields[3] as Data[]).push(
          record(1n, prefix + "20" + left.hash + "20", ""),
        );
      }
      next.push({
        hash: await sha256(prefix + "20" + left.hash + "20" + right.hash),
        entries: [...left.entries, ...right.entries],
      });
    }
    nodes = next;
  }
  const innerRoot = nodes[0].hash;
  const root = await sha256(
    "0003" + fromText("ibc") + "20" + await sha256(innerRoot),
  );
  for (const entry of entries) {
    entry.outer.fields[1] = innerRoot;
    proofs.set(entry.sequence, { height, proof: entry.proof });
  }
  cs.fields[6] = height;
  state.fields[1] = new Map([[
    height,
    record(BigInt(emulator.now()) * 1_000_000n, "00".repeat(32), record(root)),
  ]]);
  state.fields[2] = new Map([[height, 0n]]);
  state.fields[3] = new Map([[height, 0n]]);
  context.client.datum = encode(client);

  async function wallet(enterprise = false) {
    const account = generateEmulatorAccount({ lovelace: 300_000_000n });
    const clock = { ...SLOT_CONFIG_NETWORK.Custom };
    const lucid = await Lucid(emulator, "Custom");
    SLOT_CONFIG_NETWORK.Custom = clock;
    lucid.selectWallet.fromSeed(
      account.seedPhrase,
      enterprise ? { addressType: "Enterprise" } : {},
    );
    const address = await lucid.wallet().address();
    seed(address, account.assets, Data.void());
    seed(address, { lovelace: 5_000_000n }, Data.void());
    isolateEvaluation(lucid, emulator);
    if (node) {
      nodeEvaluations.set(lucid, { node, emulator });
      emulator.evaluateTx = async (tx, additional = []) => {
        const body = CML.Transaction.from_cbor_hex(tx).body();
        const refs: Array<{ txHash: string; outputIndex: number }> = [];
        for (
          const inputs of [
            body.inputs(),
            body.reference_inputs(),
            body.collateral_inputs(),
          ]
        ) {
          if (!inputs) continue;
          for (let i = 0; i < inputs.len(); i++) {
            refs.push({
              txHash: inputs.get(i).transaction_id().to_hex(),
              outputIndex: Number(inputs.get(i).index()),
            });
          }
        }
        const inputs = new Map(
          [...await emulator.getUtxosByOutRef(refs), ...additional].map(
            (input) => [`${input.txHash}#${input.outputIndex}`, input],
          ),
        );
        const result = await nodeRpc(node, "evaluateTransaction", {
          transaction: { cbor: tx },
          additionalUtxo: [...inputs.values()].map(nodeUtxo),
        });
        return result.map((item: any) => ({
          redeemer_tag: item.validator.purpose,
          redeemer_index: item.validator.index,
          ex_units: { mem: item.budget.memory, steps: item.budget.cpu },
        }));
      };
    }
    return lucid;
  }

  async function admit(count: number) {
    const users = await Promise.all(
      Array.from({ length: count }, () => wallet()),
    );
    const hashes: string[] = [];
    for (const user of users) {
      const tx = await buildTransferIntent(user, deployment, {
        amount: 2_000_000n,
        receiver: "cosmos1receiver",
        timeoutTimestamp: BigInt(emulator.now() + 3_600_000) * 1_000_000n,
      });
      const signed = await (await tx.complete()).sign.withWallet().complete();
      // No protocol state input is used to admit a user request.
      const inputs = signed.toTransaction().body().inputs();
      for (let index = 0; index < inputs.len(); index++) {
        const ref = inputs.get(index);
        const [input] = await emulator.getUtxosByOutRef([{
          txHash: ref.transaction_id().to_hex(),
          outputIndex: Number(ref.index()),
        }]);
        assert(input.address === await user.wallet().address());
      }
      hashes.push(await signed.submit());
    }
    emulator.awaitBlock();
    const intents = (await fixture.lucid.utxosAt(guardAddress)).filter((u) =>
      hashes.includes(u.txHash)
    );
    assert(intents.length === count);
    return { intents, users };
  }
  const initializer = await wallet();
  const initialization = await buildPacketLaneInitialization(
    initializer,
    deployment,
    configuration,
    registryAddress,
  );
  await (await signMeasured(
    initializer,
    initialization,
    `${laneCount}-lane issuance`,
  )).submit();
  emulator.awaitBlock();
  deployment.scripts.push(configuration);
  return {
    ...fixture,
    deployment,
    wallet,
    admit,
    proofs,
    metadataHash,
    traceScript,
    traceAddress,
  };
}

export async function signMeasured(
  lucid: LucidEvolution,
  tx: TxBuilder,
  label: string,
) {
  const completed = await completeTransaction(tx);
  const signed = await completed.sign.withWallet().complete();
  const redeemers = signed.toTransaction().witness_set().redeemers();
  assert(redeemers, "compiled script execution is required");
  const units = CML.compute_total_ex_units(redeemers);
  const bytes = signed.toCBOR().length / 2;
  const limits = lucid.config().protocolParameters!;
  assert(
    bytes <= limits.maxTxSize,
    `${label}: ${bytes} bytes exceeds ${limits.maxTxSize}`,
  );
  assert(
    units.mem() <= limits.maxTxExMem,
    `${label}: ${units.mem()} memory exceeds ${limits.maxTxExMem}`,
  );
  assert(units.steps() <= limits.maxTxExSteps, `${label}: CPU budget exceeded`);
  console.log(
    `${label}: ${bytes} bytes, ${units.mem()} memory, ${units.steps()} CPU`,
  );
  const node = nodeEvaluations.get(lucid);
  if (node) {
    const body = signed.toTransaction().body();
    const refs: Array<{ txHash: string; outputIndex: number }> = [];
    for (
      const inputs of [
        body.inputs(),
        body.reference_inputs(),
        body.collateral_inputs(),
      ]
    ) {
      if (!inputs) continue;
      for (let i = 0; i < inputs.len(); i++) {
        refs.push({
          txHash: inputs.get(i).transaction_id().to_hex(),
          outputIndex: Number(inputs.get(i).index()),
        });
      }
    }
    const utxos = await node.emulator.getUtxosByOutRef(refs);
    const result = await nodeRpc(node.node, "evaluateTransaction", {
      transaction: { cbor: signed.toCBOR() },
      additionalUtxo: utxos.map(nodeUtxo),
    });
    const memory = result.reduce(
      (sum: bigint, item: any) => sum + BigInt(item.budget.memory),
      0n,
    );
    const cpu = result.reduce(
      (sum: bigint, item: any) => sum + BigInt(item.budget.cpu),
      0n,
    );
    console.log(`${label}: node confirmed ${memory} memory, ${cpu} CPU`);
    assert(
      memory <= units.mem() && cpu <= units.steps(),
      `${label}: node execution exceeds signed budget`,
    );
  }
  return signed;
}

export function snapshot(
  fixture: Awaited<ReturnType<typeof packetLaneFixture>>,
) {
  const { emulator } = fixture;
  const saved = structuredClone({
    ledger: emulator.ledger,
    mempool: emulator.mempool,
    chain: emulator.chain,
    datumTable: emulator.datumTable,
    blockHeight: emulator.blockHeight,
    slot: emulator.slot,
    time: emulator.time,
  });
  return () => Object.assign(emulator, structuredClone(saved));
}

const nodeEvaluations = new WeakMap<
  LucidEvolution,
  {
    node: string;
    emulator: Awaited<ReturnType<typeof channelFixture>>["emulator"];
  }
>();
async function nodeRpc(
  url: string,
  method: string,
  params: unknown,
): Promise<any> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(30_000),
  });
  const body = await response.json();
  if (!response.ok || body.error) {
    throw new Error(`Node evaluation: ${JSON.stringify(body.error ?? body)}`);
  }
  return body.result;
}
function nodeUtxo(utxo: UTxO) {
  const value: Record<string, Record<string, number>> = {
    ada: { lovelace: Number(utxo.assets.lovelace ?? 0n) },
  };
  for (const [unit, amount] of Object.entries(utxo.assets)) {
    if (unit === "lovelace") continue;
    (value[unit.slice(0, 56)] ??= {})[unit.slice(56)] = Number(amount);
  }
  return {
    transaction: { id: utxo.txHash },
    index: utxo.outputIndex,
    address: utxo.address,
    value,
    datum: utxo.datumHash ? undefined : utxo.datum,
    datumHash: utxo.datumHash,
    script: utxo.scriptRef
      ? "d818" +
        CML.PlutusV3Script.from_raw_bytes(
          CML.Script.new_plutus_v3(
            CML.PlutusV3Script.from_cbor_hex(utxo.scriptRef.script),
          ).to_cbor_bytes(),
        ).to_cbor_hex()
      : undefined,
  };
}
