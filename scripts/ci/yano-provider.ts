// Local CI adapter for the deployed Yano fixture and its known scripts.
import {
  Blockfrost,
  CML,
  coreToUtxo,
  generatePrivateKey,
  Lucid,
  validatorToScriptHash,
} from "@lucid-evolution/lucid";
import { createCardanoScalusEvaluator } from "../../cardano/offchain/src/scalus-evaluator.ts";

export async function createYanoContext() {
  const base = Deno.env.get("YANO_URL") ?? "http://127.0.0.1:17070/api/v1";
  const genesis = JSON.parse(
    await Deno.readTextFile(Deno.env.get("YANO_GENESIS")!),
  );
  for (const name of ["KUPO_URL", "OGMIOS_URL"]) Deno.env.delete(name);
  Deno.env.set("CARDANO_NETWORK_MAGIC", "42");
  const provider = new Blockfrost(base, "local");
  provider.submitTx = async (tx) => {
    const response = await fetch(`${base}/tx/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/cbor" },
      body: Uint8Array.from(tx.match(/../g)!.map((byte) => parseInt(byte, 16))),
    });
    const result = await response.json();
    if (!response.ok || typeof result !== "string") {
      throw new Error(JSON.stringify(result));
    }
    return result;
  };
  provider.awaitTx = async (hash, interval = 200) => {
    const deadline = Date.now() + 60000;
    while (Date.now() < deadline) {
      const response = await fetch(`${base}/txs/${hash}/status`);
      const status = await response.json();
      if (!response.ok) throw new Error(JSON.stringify(status));
      if (status.status === "in_block") return true;
      await new Promise((resolve) => setTimeout(resolve, interval));
    }
    throw new Error(`Yano did not confirm ${hash}`);
  };
  let metadata: { addresses: string[]; scripts: [string, any][] } = {
    addresses: [],
    scripts: [],
  };
  try {
    metadata = JSON.parse(await Deno.readTextFile("provider-state.json"));
  } catch (error) {
    if (
      !(error instanceof Deno.errors.NotFound) ||
      Deno.env.get("YANO_ACTION") !== "deploy"
    ) throw error;
  }
  const knownAddresses = new Set<string>(metadata.addresses);
  const knownScripts = new Map<string, any>(metadata.scripts);
  if (Deno.env.get("YANO_QUERY_ADAPTER") === "1") {
    const submit = provider.submitTx.bind(provider);
    provider.submitTx = async (cbor) => {
      const transaction = CML.Transaction.from_cbor_hex(cbor);
      const hash = CML.hash_transaction(transaction.body());
      const outputs = transaction.body().outputs();
      for (let index = 0; index < outputs.len(); index++) {
        const utxo = coreToUtxo(
          CML.TransactionUnspentOutput.new(
            CML.TransactionInput.new(hash, BigInt(index)),
            outputs.get(index),
          ),
        );
        knownAddresses.add(utxo.address);
        if (utxo.scriptRef) {
          knownScripts.set(
            validatorToScriptHash(utxo.scriptRef),
            utxo.scriptRef,
          );
        }
      }
      await Deno.writeTextFile(
        "known-addresses.json",
        JSON.stringify([...knownAddresses]),
      );
      await Deno.writeTextFile(
        "provider-state.json",
        JSON.stringify({
          addresses: [...knownAddresses],
          scripts: [...knownScripts],
        }),
      );
      return await submit(cbor);
    };
    provider.getUtxos = async (address) => {
      if (typeof address !== "string") {
        throw new Error("Probe only supports address queries");
      }
      knownAddresses.add(address);
      const rows = [];
      for (let page = 1;; page++) {
        const response = await fetch(
          `${base}/addresses/${address}/utxos?count=100&page=${page}`,
        );
        const batch = await response.json();
        if (!response.ok) throw new Error(JSON.stringify(batch));
        rows.push(...batch);
        if (batch.length < 100) break;
      }
      return rows.map((row) => {
        const scriptRef = row.reference_script_hash
          ? knownScripts.get(row.reference_script_hash)
          : undefined;
        if (row.reference_script_hash && !scriptRef) {
          throw new Error(
            `Unknown reference script ${row.reference_script_hash}`,
          );
        }
        return {
          txHash: row.tx_hash,
          outputIndex: row.output_index,
          address: row.address,
          assets: Object.fromEntries(
            row.amount.map((a: any) => [a.unit, BigInt(a.quantity)]),
          ),
          datum: row.inline_datum ?? undefined,
          datumHash: row.inline_datum ? undefined : row.data_hash ?? undefined,
          scriptRef,
        };
      });
    };
    provider.getUtxosWithUnit = async (address, unit) =>
      (await provider.getUtxos(address)).filter((u) => u.assets[unit]);
    provider.getUtxoByUnit = async (unit) => {
      const rows = (await Promise.all([...knownAddresses].map((address) =>
        provider.getUtxosWithUnit(address, unit)
      ))).flat();
      if (rows.length !== 1) {
        throw new Error(`Expected one ${unit} UTxO, found ${rows.length}`);
      }
      return rows[0];
    };
    provider.getUtxosByOutRef = async (refs) => {
      const rows = (await Promise.all([...knownAddresses].map((address) =>
        provider.getUtxos(address)
      ))).flat();
      return rows.filter((u) =>
        refs.some((ref) =>
          ref.txHash === u.txHash && ref.outputIndex === u.outputIndex
        )
      );
    };
  }
  if (Deno.env.get("YANO_EVALUATION_ADAPTER") === "1") {
    provider.evaluateTx = async (tx) => {
      const response = await fetch(`${base}/utils/txs/evaluate`, {
        method: "POST",
        headers: { "Content-Type": "application/cbor" },
        body: Uint8Array.from(
          tx.match(/../g)!.map((byte) => parseInt(byte, 16)),
        ),
      });
      const result = await response.json();
      await Deno.writeTextFile(
        "last-evaluation.json",
        JSON.stringify(result, null, 2),
      );
      if (!response.ok || !result.result?.EvaluationResult) {
        throw new Error(JSON.stringify(result));
      }
      return Object.entries(result.result.EvaluationResult).map(
        ([pointer, budget]: [string, any]) => {
          const [tag, index] = pointer.split(":");
          return {
            redeemer_tag: ({
              cert: "publish",
              certificate: "publish",
              reward: "withdraw",
              withdrawal: "withdraw",
            } as any)[tag] ?? tag,
            redeemer_index: Number(index),
            ex_units: {
              mem: Number(budget.memory),
              steps: Number(budget.steps),
            },
          };
        },
      );
    };
  }
  const parameters = await provider.getProtocolParameters();
  const clock = {
    zeroTime: Date.parse(genesis.systemStart),
    zeroSlot: 0,
    slotLength: genesis.slotLength * 1000,
  };
  const lucid = await Lucid(provider, "Custom", {
    presetProtocolParameters: parameters,
    evaluator: createCardanoScalusEvaluator(),
    slotConfig: clock,
  });
  const keyPath = "wallet.key";
  let key: string;
  try {
    key = await Deno.readTextFile(keyPath);
  } catch {
    key = generatePrivateKey();
    await Deno.writeTextFile(keyPath, key, { mode: 0o600 });
  }
  lucid.selectWallet.fromPrivateKey(key);
  const address = await lucid.wallet().address();
  await Deno.writeTextFile("address.txt", address);

  return { base, provider, lucid, key, address, clock };
}
