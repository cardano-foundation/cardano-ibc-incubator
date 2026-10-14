import { Buffer } from "node:buffer";
import { blake2b } from "@noble/hashes/blake2b";
import {
  Cbor,
  CborArray,
  CborMap,
  CborUInt,
  CborTag,
  CborBytes,
  LazyCborArray,
  LazyCborMap,
  type CborObj,
} from "@harmoniclabs/cbor";
import { CML } from "@lucid-evolution/lucid";
import { YaciRestClient, type YaciRestBlock } from "./yaciRest.ts";
import { YaciRestHistoryChangedError } from "./yaciRest.ts";
type IbcTreeHostStateRef = { txHash: string; outputIndex: number };

export type RestOutput = {
  tx_hash: string;
  output_index: number;
  block: number;
  tx_index: number;
  address: string;
  inline_datum: string | null;
  data_hash: string | null;
  amounts: Array<{ unit: string; quantity: string }>;
};
export type RestEpochBlock = Pick<
  YaciRestBlock,
  "number" | "slot" | "epoch" | "time" | "slot_leader" | "tx_count"
>;
export type RestTransaction = {
  hash: string;
  block: YaciRestBlock;
  index: number;
  valid: boolean;
  body: CML.TransactionBody;
  bodyCborHex: string;
  cborHex: string;
  transaction: CML.Transaction;
  outputs: RestOutput[];
  inputs: Array<{ txHash: string; outputIndex: number }>;
};
export type RestOutputFilter = {
  policy: string;
  address?: string;
  unit?: string;
  outRef?: IbcTreeHostStateRef;
  unspent: boolean;
};

function hash(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/i.test(value))
    throw new Error("Invalid Yaci transaction hash");
  return value.toLowerCase();
}
function height(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
    throw new Error("Invalid Yaci transaction height");
  return value;
}
const ref = (output: { txHash: string; outputIndex: number }) =>
  `${output.txHash}#${output.outputIndex}`;

function epochSummary(row: any, epoch: number): RestEpochBlock {
  if (height(row.epoch) !== epoch || typeof row.slot_leader !== "string")
    throw new Error("Invalid Yaci epoch block summary");
  return {
    number: height(row.number ?? row.height),
    slot: height(row.slot),
    epoch,
    time: height(row.time),
    slot_leader: row.slot_leader,
    tx_count: height(row.tx_count),
  };
}

function mapValue(value: CborObj, key: bigint): CborObj | undefined {
  return value instanceof CborMap
    ? value.map.find(
        (entry) => entry.k instanceof CborUInt && entry.k.num === key,
      )?.v
    : undefined;
}

class YaciRestPageDriftError extends YaciRestHistoryChangedError {}

/** Request-scoped reads from native REST indexes. No chain database or persistent raw cache. */
export class YaciRestHistory {
  private readonly blocks = new Map<number, Promise<RestTransaction[]>>();
  constructor(readonly api: YaciRestClient) {}

  reset(): void {
    this.blocks.clear();
  }

  async snapshot<T>(
    at: number | bigint | "latest",
    read: (block: YaciRestBlock) => Promise<T>,
  ): Promise<T> {
    this.api.signal?.throwIfAborted();
    const block = await this.api.block(at);
    if (!block) throw new Error(`Yaci does not retain required block ${at}`);
    try {
      const result = await read(block);
      this.api.signal?.throwIfAborted();
      await this.assertCanonical(block);
      return result;
    } finally {
      this.reset();
    }
  }

  private async assertCanonical(block: YaciRestBlock): Promise<void> {
    const canonical = await this.api.block(block.number);
    if (!canonical || canonical.hash !== block.hash)
      throw new YaciRestHistoryChangedError(
        "Yaci history changed during the REST read, retry",
      );
  }

  async *pages(
    path: string,
    order: "asc" | "desc" = "asc",
  ): AsyncGenerator<any> {
    const seen = new Set<string>();
    for (let page = 1; page <= 100_000; page++) {
      const rows = await this.api.json(
        `${path}${path.includes("?") ? "&" : "?"}count=100&page=${page}&order=${order}`,
      );
      if (!Array.isArray(rows) || rows.length > 100)
        throw new Error(`Invalid or unavailable Yaci history page: ${path}`);
      const identities = rows.map((row) => JSON.stringify(row));
      if (new Set(identities).size !== rows.length)
        throw new Error(`Yaci history pagination repeated a row: ${path}`);
      for (const row of rows) {
        const identity = JSON.stringify(row);
        if (seen.has(identity))
          throw new YaciRestPageDriftError(
            `Yaci history pagination repeated a row: ${path}`,
          );
        seen.add(identity);
        yield row;
      }
      if (rows.length < 100) return;
    }
    throw new Error(`Yaci history pagination exceeded its limit: ${path}`);
  }

  async firstBlockInEpoch(epoch: number): Promise<RestEpochBlock | null> {
    return this.snapshot("latest", async (tip) => {
      let page = 1;
      for (let attempt = 0; attempt < 4; attempt++) {
        const data = await this.api.json(
          `blocks/epoch/${epoch}?count=100&page=${page}`,
        );
        if (!data || !Array.isArray(data.blocks) || data.blocks.length > 100)
          throw new Error("Invalid Yaci epoch block page");
        if (!data.blocks.length) return null;
        const lastPage = height(data.total_pages);
        if (lastPage > page) {
          page = lastPage;
          continue;
        }
        const rows = data.blocks.filter(
          (row: any) => height(row.number) <= tip.number,
        );
        const first = rows.sort(
          (left: any, right: any) => left.number - right.number,
        )[0];
        if (!first || height(first.epoch) !== epoch)
          throw new Error("Yaci epoch boundary is unavailable or changed");
        return epochSummary(first, epoch);
      }
      throw new Error(
        "Yaci epoch pagination changed while finding its boundary, retry",
      );
    });
  }

  async latestBlockInEpoch(epoch: number): Promise<RestEpochBlock | null> {
    return this.snapshot("latest", async (tip) => {
      const data = await this.api.json(
        `blocks/epoch/${epoch}?count=100&page=1`,
      );
      if (!data || !Array.isArray(data.blocks) || data.blocks.length > 100)
        throw new Error("Invalid Yaci epoch block page");
      const rows = data.blocks.filter(
        (row: any) => height(row.number) <= tip.number,
      );
      const last = rows.sort(
        (left: any, right: any) => right.number - left.number,
      )[0];
      if (!last) return null;
      if (height(last.epoch) !== epoch)
        throw new Error("Yaci returned a different epoch");
      return epochSummary(last, epoch);
    });
  }

  async epochBlocks(epoch: number): Promise<RestEpochBlock[]> {
    if (!Number.isSafeInteger(epoch) || epoch < 0)
      throw new Error("Invalid Yaci epoch");
    return this.snapshot("latest", (tip) =>
      this.readEpochBlocks(epoch, tip.number),
    );
  }

  private async readEpochBlocks(
    epoch: number,
    tip: number,
  ): Promise<RestEpochBlock[]> {
    const result: RestEpochBlock[] = [];
    const seen = new Set<number>();
    for (let page = 1; page <= 100_000; page++) {
      const data = await this.api.json(
        `blocks/epoch/${epoch}?count=100&page=${page}`,
      );
      if (!data || !Array.isArray(data.blocks) || data.blocks.length > 100)
        throw new Error("Invalid Yaci epoch block page");
      for (const summary of data.blocks) {
        const number = height(summary.number ?? summary.height);
        if (seen.has(number))
          throw new Error("Yaci epoch pagination repeated a block");
        seen.add(number);
        if (
          height(summary.epoch) !== epoch ||
          typeof summary.slot_leader !== "string"
        )
          throw new Error("Invalid Yaci epoch block summary");
        if (number > tip) continue;
        result.push({
          number,
          slot: height(summary.slot),
          epoch,
          time: height(summary.time),
          slot_leader: summary.slot_leader,
          tx_count: height(summary.tx_count),
        });
      }
      if (data.blocks.length < 100)
        return result.sort((a, b) => a.number - b.number);
    }
    throw new Error("Yaci epoch block pagination exceeded its limit");
  }

  async blockTransactions(number: number): Promise<RestTransaction[]> {
    let pending = this.blocks.get(number);
    if (!pending) {
      pending = this.readBlockTransactions(number);
      // Only share bytes while this request runs. Bound requests with many historical blocks.
      if (this.blocks.size >= 128)
        this.blocks.delete(this.blocks.keys().next().value!);
      this.blocks.set(number, pending);
    }
    return pending;
  }

  private async readBlockTransactions(
    number: number,
  ): Promise<RestTransaction[]> {
    const metadata = await this.api.block(number);
    if (!metadata)
      throw new Error(`Yaci does not retain required block ${number}`);
    const bytes = await this.api.blockCbor(metadata.hash);
    const raw = CML.Block.from_cbor_bytes(bytes);
    const encoded = Cbor.parseLazy(bytes);
    if (!(encoded instanceof LazyCborArray))
      throw new Error("Invalid raw block array");
    const encodedBodies = Cbor.parseLazy(encoded.array[1]);
    const encodedWitnesses = Cbor.parseLazy(encoded.array[2]);
    const encodedAuxiliary = Cbor.parseLazy(encoded.array[3]);
    if (
      !(encodedBodies instanceof LazyCborArray) ||
      !(encodedWitnesses instanceof LazyCborArray) ||
      !(encodedAuxiliary instanceof LazyCborMap)
    )
      throw new Error("Invalid raw block transaction components");
    const header = raw.header().header_body();
    const bodies = raw.transaction_bodies();
    const witnesses = raw.transaction_witness_sets();
    if (
      header.block_number() !== BigInt(number) ||
      header.slot() !== BigInt(metadata.slot) ||
      (header.prev_hash()?.to_hex() ?? null) !== metadata.previous_block ||
      bodies.len() !== metadata.tx_count ||
      witnesses.len() !== bodies.len()
    )
      throw new Error("Yaci raw block does not match its REST metadata");
    const invalid = new Set(raw.invalid_transactions());
    if (
      invalid.size !== raw.invalid_transactions().length ||
      [...invalid].some((index) => index >= bodies.len())
    )
      throw new Error("Invalid Yaci block validity list");
    const transactions: RestTransaction[] = [];
    for (let index = 0; index < bodies.len(); index++) {
      const body = bodies.get(index);
      // CML may normalize inline bignums. Hash and retain the original body bytes.
      const bodyBytes = encodedBodies.array[index];
      const bodyCborHex = Buffer.from(bodyBytes).toString("hex");
      const txHash = Buffer.from(blake2b(bodyBytes, { dkLen: 32 })).toString(
        "hex",
      );
      const rawOutputs = mapValue(Cbor.parse(bodyBytes), 1n);
      if (!(rawOutputs instanceof CborArray))
        throw new Error("Missing original transaction outputs");
      const valid = !invalid.has(index);
      const outputs: RestOutput[] = [];
      const list = body.outputs();
      if (valid)
        for (let outputIndex = 0; outputIndex < list.len(); outputIndex++) {
          const output = list.get(outputIndex);
          const value = output.amount();
          const amounts = [
            { unit: "lovelace", quantity: value.coin().toString() },
          ];
          const policies = value.multi_asset().keys();
          for (let p = 0; p < policies.len(); p++) {
            const policy = policies.get(p);
            const assets = value.multi_asset().get_assets(policy)!;
            const names = assets.keys();
            for (let n = 0; n < names.len(); n++)
              amounts.push({
                unit: policy.to_hex() + names.get(n).to_hex(),
                quantity: assets.get(names.get(n))!.toString(),
              });
          }
          const datum = mapValue(rawOutputs.array[outputIndex], 2n);
          const inline =
            datum instanceof CborArray &&
            datum.array[0] instanceof CborUInt &&
            datum.array[0].num === 1n &&
            datum.array[1] instanceof CborTag &&
            datum.array[1].tag === 24n &&
            datum.array[1].data instanceof CborBytes
              ? datum.array[1].data.bytes
              : null;
          if (output.datum()?.as_datum() && !inline)
            throw new Error("Missing original inline datum bytes");
          outputs.push({
            tx_hash: txHash,
            output_index: outputIndex,
            block: number,
            tx_index: index,
            address:
              CML.ByronAddress.from_address(output.address())?.to_base58() ??
              output.address().to_bech32(),
            inline_datum: inline ? Buffer.from(inline).toString("hex") : null,
            data_hash: inline
              ? Buffer.from(blake2b(inline, { dkLen: 32 })).toString("hex")
              : (output.datum()?.as_hash()?.to_hex() ?? null),
            amounts,
          });
        }
      const inputs: RestTransaction["inputs"] = [];
      if (valid)
        for (let i = 0; i < body.inputs().len(); i++) {
          const input = body.inputs().get(i);
          inputs.push({
            txHash: input.transaction_id().to_hex(),
            outputIndex: Number(input.index()),
          });
        }
      // cbor 1.6.6 exposes lazy maps as `array` despite declaring `map`.
      const auxiliaryEntries = (Reflect.get(encodedAuxiliary, "array") ??
        encodedAuxiliary.map) as Array<{ k: Uint8Array; v: Uint8Array }>;
      if (!Array.isArray(auxiliaryEntries))
        throw new Error("Invalid raw auxiliary data map");
      const auxiliary = auxiliaryEntries.find((entry) => {
        const key = Cbor.parse(entry.k);
        return key instanceof CborUInt && key.num === BigInt(index);
      });
      const cborHex =
        "84" +
        bodyCborHex +
        Buffer.from(encodedWitnesses.array[index]).toString("hex") +
        (valid ? "f5" : "f4") +
        (auxiliary ? Buffer.from(auxiliary.v).toString("hex") : "f6");
      transactions.push({
        bodyCborHex,
        cborHex,
        hash: txHash,
        block: metadata,
        index,
        valid,
        body,
        outputs,
        inputs,
        transaction: CML.Transaction.new(
          body,
          witnesses.get(index),
          valid,
          raw.auxiliary_data_set().get(index),
        ),
      });
    }
    const canonical = await this.api.block(number);
    if (!canonical || canonical.hash !== metadata.hash)
      throw new YaciRestHistoryChangedError(
        "Yaci block changed during transaction lookup",
      );
    return transactions;
  }

  async transaction(txHash: string): Promise<RestTransaction | null> {
    txHash = hash(txHash);
    const details = await this.api.json(`txs/${txHash}`);
    if (!details) return null;
    if (hash(details.hash) !== txHash)
      throw new Error("Yaci returned a different transaction");
    const number = height(details.block_height);
    const transaction = (await this.blockTransactions(number)).find(
      (tx) => tx.hash === txHash,
    );
    if (!transaction || transaction.block.slot !== details.slot)
      throw new Error("Yaci transaction index disagrees with its raw block");
    return transaction;
  }

  async transactionsFor(
    path: string,
    at: number,
    fromHeight = 0,
  ): Promise<RestTransaction[]> {
    if (fromHeight === 0)
      return this.readTransactionsFor(path, at, fromHeight, "asc");
    const anchor = await this.api.block(at);
    if (!anchor) throw new Error(`Yaci does not retain required block ${at}`);
    try {
      return await this.readTransactionsFor(path, at, fromHeight, "desc");
    } catch (error) {
      if (!(error instanceof YaciRestPageDriftError)) throw error;
      // New rows shift descending LIMIT/OFFSET pages. Discard that scan and
      // restart forwards, where appends leave existing offsets unchanged.
      this.reset();
      try {
        await this.assertCanonical(anchor);
        const transactions = await this.readTransactionsFor(
          path, at, fromHeight, "asc",
        );
        await this.assertCanonical(anchor);
        return transactions;
      } finally {
        this.reset();
      }
    }
  }

  private async readTransactionsFor(
    path: string,
    at: number,
    fromHeight: number,
    order: "asc" | "desc",
  ): Promise<RestTransaction[]> {
    const transactions = new Map<string, RestTransaction>();
    let previous: number | undefined;
    for await (const row of this.pages(path, order)) {
      const number = height(row.block_height ?? row.block_number);
      if (
        previous !== undefined &&
        (order === "desc" ? number > previous : number < previous)
      )
        throw new Error("Yaci transaction history is not ordered");
      previous = number;
      if (number < fromHeight) {
        if (order === "desc") break;
        continue;
      }
      if (number > at) {
        if (order === "asc") break;
        continue;
      }
      const txHash = hash(row.tx_hash);
      const tx = (await this.blockTransactions(number)).find(
        (candidate) => candidate.hash === txHash,
      );
      if (!tx)
        throw new Error(
          "Yaci history transaction is missing from its raw block",
        );
      if (tx.valid) transactions.set(txHash, tx);
    }
    return [...transactions.values()].sort(
      (a, b) => a.block.number - b.block.number || a.index - b.index,
    );
  }

  async policyUnits(policy: string): Promise<string[]> {
    if (!/^[0-9a-f]{56}$/i.test(policy))
      throw new Error("Invalid history policy");
    const units = new Set<string>();
    for await (const row of this.pages(`assets/policy/${policy}/history`)) {
      const unit = row.unit;
      if (
        typeof unit !== "string" ||
        !unit.startsWith(policy) ||
        !/^(?:[0-9a-f]{2}){28,60}$/.test(unit)
      )
        throw new Error("Invalid Yaci policy asset");
      units.add(unit);
    }
    return [...units];
  }

  async outputs(
    filter: RestOutputFilter,
    at: number,
    fromHeight = 0,
  ): Promise<RestOutput[]> {
    if (
      !/^[0-9a-f]{56}$/i.test(filter.policy) ||
      (filter.unit &&
        (!/^(?:[0-9a-f]{2}){28,60}$/i.test(filter.unit) ||
          !filter.unit.startsWith(filter.policy)))
    )
      throw new Error("Invalid history asset filter");
    const units = filter.unit
      ? [filter.unit]
      : await this.policyUnits(filter.policy);
    const found = new Map<string, RestOutput>();
    for (const unit of units)
      for (const tx of await this.transactionsFor(
        `assets/${unit}/transactions`,
        at,
        fromHeight,
      )) {
        for (const output of tx.outputs) {
          if (filter.address && output.address !== filter.address) continue;
          if (
            filter.outRef &&
            (output.tx_hash !== filter.outRef.txHash ||
              output.output_index !== filter.outRef.outputIndex)
          )
            continue;
          if (
            output.amounts.some(
              (amount) => amount.unit === unit && amount.quantity === "1",
            )
          )
            found.set(`${output.tx_hash}#${output.output_index}`, output);
        }
      }
    if (filter.unspent) {
      // Asset history lists producing transactions. Address history also includes
      // consumers with no replacement NFT output, including burns and cancellation.
      const addresses = new Set(
        [...found.values()].map((output) => output.address),
      );
      for (const address of addresses)
        for (const tx of await this.transactionsFor(
          `addresses/${encodeURIComponent(address)}/transactions`,
          at,
        )) {
          for (const input of tx.inputs) found.delete(ref(input));
        }
    }
    return [...found.values()].sort(
      (a, b) =>
        a.block - b.block ||
        a.tx_index - b.tx_index ||
        a.output_index - b.output_index,
    );
  }
}
