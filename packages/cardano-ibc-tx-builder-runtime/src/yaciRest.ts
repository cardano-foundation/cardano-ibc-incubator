import { Buffer } from "node:buffer";
import { Cbor, LazyCborArray } from "@harmoniclabs/cbor";
import { blake2b } from "@noble/hashes/blake2b";

export type YaciRestBlock = {
  number: number;
  hash: string;
  previous_block: string | null;
  slot: number;
  epoch: number;
  time: number;
  slot_leader: string;
  tx_count: number;
};

function natural(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
    throw new Error(`Invalid Yaci block ${field}`);
  return value;
}

/** Standard Yaci Store /api/v1 endpoints. No database or node transport. */
export class YaciRestClient {
  private readonly endpoint: string;

  constructor(
    endpoint: string | undefined,
    readonly signal?: AbortSignal,
  ) {
    if (!endpoint?.trim())
      throw new Error("YACI_STORE_ENDPOINT is required for Cardano history");
    const url = new URL(endpoint);
    if (!["http:", "https:"].includes(url.protocol))
      throw new Error("Invalid YACI_STORE_ENDPOINT protocol");
    this.endpoint = endpoint.replace(/\/+$/, "");
  }

  private async request(path: string, binary = false): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      let response: Response;
      try {
        response = await fetch(`${this.endpoint}/api/v1/${path}`, {
          headers: {
            accept: binary ? "application/octet-stream" : "application/json",
          },
          signal: this.signal
            ? AbortSignal.any([this.signal, AbortSignal.timeout(30_000)])
            : AbortSignal.timeout(30_000),
        });
      } catch (error) {
        if (this.signal?.aborted)
          throw new Error(`Yaci REST request cancelled for ${path}`, {
            cause: error,
          });
        if (attempt >= 2)
          throw new Error(`Yaci REST request failed for ${path}`, {
            cause: error,
          });
        await new Promise((resolve) =>
          setTimeout(resolve, 250 * (attempt + 1)),
        );
        continue;
      }
      if (attempt < 2 && (response.status === 429 || response.status >= 500)) {
        await response.body?.cancel();
        await new Promise((resolve) =>
          setTimeout(resolve, 250 * (attempt + 1)),
        );
        continue;
      }
      return response;
    }
  }

  async json(path: string): Promise<any | null> {
    const response = await this.request(path);
    if (response.status === 404) return null;
    if (!response.ok)
      throw new Error(`Yaci REST ${path} failed with HTTP ${response.status}`);
    return response.json();
  }

  async block(
    height: number | bigint | "latest",
  ): Promise<YaciRestBlock | null> {
    if (
      height !== "latest" &&
      (BigInt(height) < 0n || BigInt(height) > BigInt(Number.MAX_SAFE_INTEGER))
    )
      throw new Error("Invalid Yaci block height");
    const response = await this.request(`blocks/${height}`);
    if (response.status === 404) return null;
    if (!response.ok)
      throw new Error(`Yaci block lookup failed with HTTP ${response.status}`);
    const data = await response.json();
    if (
      !data ||
      typeof data !== "object" ||
      typeof data.hash !== "string" ||
      !/^[0-9a-f]{64}$/i.test(data.hash) ||
      (data.previous_block !== null &&
        (typeof data.previous_block !== "string" ||
          !/^[0-9a-f]{64}$/i.test(data.previous_block))) ||
      typeof data.slot_leader !== "string"
    )
      throw new Error("Invalid Yaci block metadata");
    const block = {
      number: natural(data.number ?? data.height, "number"),
      hash: data.hash.toLowerCase(),
      previous_block: data.previous_block?.toLowerCase() ?? null,
      slot: natural(data.slot, "slot"),
      epoch: natural(data.epoch, "epoch"),
      time: natural(data.time, "time"),
      slot_leader: data.slot_leader,
      tx_count: natural(data.tx_count, "tx_count"),
    };
    if (height !== "latest" && BigInt(block.number) !== BigInt(height))
      throw new Error("Yaci returned a different block height");
    return block;
  }

  async blockCbor(hash: string): Promise<Buffer> {
    if (!/^[0-9a-f]{64}$/i.test(hash))
      throw new Error("Invalid Yaci block hash");
    const response = await this.request(`blocks/${hash}/cbor`, true);
    if (!response.ok)
      throw new Error(
        `Yaci block CBOR fetch failed with HTTP ${response.status}. Enable store.blocks.save-cbor=true and store.cardano.return-block-cbor=true and retain blocks from the bridge checkpoint`,
      );
    const bytes = Buffer.from(await response.arrayBuffer());
    // Yaci can include the Ouroboros [era, block] envelope.
    const raw =
      bytes[0] === 0x82 && bytes[1] <= 0x17 ? bytes.subarray(2) : bytes;
    const { parsed, offset } = Cbor.parseLazyWithOffset(raw);
    if (
      !(parsed instanceof LazyCborArray) ||
      parsed.array.length !== 5 ||
      offset !== raw.length
    )
      throw new Error(
        "Yaci returned an incomplete or unsupported Cardano block",
      );
    const actualHash = Buffer.from(
      blake2b(parsed.array[0], { dkLen: 32 }),
    ).toString("hex");
    if (actualHash !== hash.toLowerCase())
      throw new Error(
        "Yaci block CBOR header hash does not match the requested block",
      );
    return raw;
  }
}

export class YaciRestHistoryChangedError extends Error {}
