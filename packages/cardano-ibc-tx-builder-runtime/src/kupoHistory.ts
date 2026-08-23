import type { UTxO } from '@lucid-evolution/lucid';
import type { TransferEscrowShardHistoryOutput } from './transferEscrowShard';

type HistoryPoint = { slotNo: number; headerHash: string };
type ParsedHistoryOutput = TransferEscrowShardHistoryOutput & {
  transactionIndex: number;
  createdAt: HistoryPoint;
  spentAt: HistoryPoint | null;
};

const POLICY = /^[0-9a-f]{56}$/;
const HASH = /^[0-9a-f]{64}$/;
const ASSET = /^[0-9a-f]{56}(?:\.[0-9a-f]{2,64})?$/;
const HEX = /^(?:[0-9a-f]{2})+$/;

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Malformed Kupo history: ${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Malformed Kupo history: ${label} must be a non-empty string`);
  }
  return value;
}

function hex(value: unknown, pattern: RegExp, label: string): string {
  const parsed = text(value, label);
  if (!pattern.test(parsed)) {
    throw new Error(`Malformed Kupo history: ${label} is not canonical base16`);
  }
  return parsed;
}

function index(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Malformed Kupo history: ${label} must be a non-negative safe integer`);
  }
  return value;
}

function quantity(value: unknown, label: string): bigint {
  if (typeof value !== 'number' && typeof value !== 'string') {
    throw new Error(`Malformed Kupo history: ${label} must be an integer`);
  }
  if (typeof value === 'number' && !Number.isSafeInteger(value)) {
    throw new Error(`Malformed Kupo history: ${label} is not a safe integer`);
  }
  const parsed = String(value);
  if (!/^(?:0|[1-9][0-9]*)$/.test(parsed)) {
    throw new Error(`Malformed Kupo history: ${label} is not a canonical quantity`);
  }
  return BigInt(parsed);
}

function point(value: unknown, label: string): HistoryPoint {
  const parsed = record(value, label);
  return {
    slotNo: index(parsed.slot_no, `${label}.slot_no`),
    headerHash: hex(parsed.header_hash, HASH, `${label}.header_hash`),
  };
}

async function json(
  fetchImpl: typeof fetch,
  url: string,
  headers?: Record<string, string>,
): Promise<unknown> {
  const requestHeaders = {
    ...headers,
    accept: 'application/json;asset-quantity=string',
  };
  const response = await fetchImpl(url, { headers: requestHeaders });
  if (!response.ok) {
    throw new Error(`Kupo history request failed: ${response.status} ${response.statusText}`);
  }
  return response.json();
}

function parseValue(
  rawValue: unknown,
  policyId: string,
  label: string,
): { assets: Record<string, bigint>; shardTokenUnit: string } {
  const value = record(rawValue, `${label}.value`);
  const assets: Record<string, bigint> = {
    lovelace: quantity(value.coins, `${label}.value.coins`),
  };
  const nativeAssets = record(value.assets, `${label}.value.assets`);
  const matching: string[] = [];
  for (const [assetId, rawQuantity] of Object.entries(nativeAssets)) {
    if (!ASSET.test(assetId)) {
      throw new Error(`Malformed Kupo history: ${label} contains an invalid asset id`);
    }
    const [assetPolicy, assetName = ''] = assetId.split('.');
    if (assetName.length % 2 !== 0) {
      throw new Error(`Malformed Kupo history: ${label} contains an odd-length asset name`);
    }
    const parsedQuantity = quantity(rawQuantity, `${label}.value.assets[${assetId}]`);
    const unit = assetPolicy + assetName;
    assets[unit] = parsedQuantity;
    if (assetPolicy === policyId) {
      if (!assetName || parsedQuantity !== 1n) {
        throw new Error(`Ambiguous Kupo history: ${label} shard token must be one NFT`);
      }
      matching.push(unit);
    }
  }
  if (matching.length !== 1) {
    throw new Error(`Ambiguous Kupo history: ${label} must contain exactly one shard token`);
  }
  return { assets, shardTokenUnit: matching[0] };
}

function compare(a: ParsedHistoryOutput, b: ParsedHistoryOutput): number {
  return (
    a.createdAt.slotNo - b.createdAt.slotNo ||
    a.transactionIndex - b.transactionIndex ||
    a.outputIndex - b.outputIndex ||
    a.txHash.localeCompare(b.txHash)
  );
}

function selectLatest(history: ParsedHistoryOutput[]): TransferEscrowShardHistoryOutput[] {
  const grouped = new Map<string, ParsedHistoryOutput[]>();
  for (const output of history) {
    const group = grouped.get(output.shardTokenUnit) ?? [];
    group.push(output);
    grouped.set(output.shardTokenUnit, group);
  }
  const selected: TransferEscrowShardHistoryOutput[] = [];
  for (const [unit, group] of grouped) {
    const outputs = [...group].sort(compare);
    for (let i = 0; i < outputs.length - 1; i += 1) {
      const current = outputs[i];
      const successor = outputs[i + 1];
      if (!current.spentAt) {
        throw new Error(`Ambiguous Kupo history: ${unit} has a non-latest unspent output`);
      }
      if (
        current.spentAt.slotNo !== successor.createdAt.slotNo ||
        current.spentAt.headerHash !== successor.createdAt.headerHash
      ) {
        throw new Error(`Malformed Kupo history: ${unit} continuation is discontinuous`);
      }
    }
    const latest = outputs.at(-1)!;
    selected.push({
      txHash: latest.txHash,
      outputIndex: latest.outputIndex,
      address: latest.address,
      assets: latest.assets,
      datum: latest.datum,
      datumHash: undefined,
      scriptRef: undefined,
      shardTokenUnit: unit,
      spent: latest.spentAt !== null,
    } as TransferEscrowShardHistoryOutput);
  }
  return selected.sort((a, b) => a.shardTokenUnit.localeCompare(b.shardTokenUnit));
}

/**
 * Load the latest state of every deterministic shard NFT. Kupo must index the
 * transfer address or shard policy from deployment and retain spent matches
 * (run without `--prune-utxo`); otherwise reconstruction fails closed.
 */
export async function fetchLatestTransferEscrowShardHistory(args: {
  kupoEndpoint: string;
  address: string;
  policyId: string;
  headers?: Record<string, string>;
  fetchImpl?: typeof fetch;
}): Promise<TransferEscrowShardHistoryOutput[]> {
  const { kupoEndpoint, address, policyId, headers } = args;
  const fetchImpl = args.fetchImpl ?? fetch;
  if (!address || address.trim() !== address || !POLICY.test(policyId)) {
    throw new Error('Invalid transfer escrow Kupo history query');
  }
  const patterns = await Promise.all(
    [address, `${policyId}.*`].map((pattern) =>
      json(
        fetchImpl,
        `${kupoEndpoint}/patterns/${encodeURIComponent(pattern)}`,
        headers,
      )
    ),
  );
  if (
    patterns.some((matches) =>
      !Array.isArray(matches) ||
      !matches.every((entry) => typeof entry === 'string' && entry.length > 0)
    )
  ) {
    throw new Error('Malformed Kupo history pattern coverage response');
  }
  if (patterns.every((matches) => (matches as unknown[]).length === 0)) {
    throw new Error(
      `Kupo does not retain transfer escrow history for ${address} or ${policyId}`,
    );
  }

  const rawMatches = await json(
    fetchImpl,
    `${kupoEndpoint}/matches/${encodeURIComponent(address)}?policy_id=${policyId}`,
    headers,
  );
  if (!Array.isArray(rawMatches)) {
    throw new Error('Malformed Kupo history: matches must be an array');
  }
  const datumCache = new Map<string, string>();
  const outRefs = new Set<string>();
  const parsed: ParsedHistoryOutput[] = [];
  for (const [position, rawMatch] of rawMatches.entries()) {
    const label = `matches[${position}]`;
    const match = record(rawMatch, label);
    const txHash = hex(match.transaction_id, HASH, `${label}.transaction_id`);
    const outputIndex = index(match.output_index, `${label}.output_index`);
    const transactionIndex = index(match.transaction_index, `${label}.transaction_index`);
    const matchAddress = text(match.address, `${label}.address`);
    if (matchAddress !== address) {
      throw new Error(`Malformed Kupo history: ${label} has the wrong address`);
    }
    const outRef = `${txHash}#${outputIndex}`;
    if (outRefs.has(outRef)) {
      throw new Error(`Ambiguous Kupo history: duplicate output ${outRef}`);
    }
    outRefs.add(outRef);
    const createdAt = point(match.created_at, `${label}.created_at`);
    const spentAt = match.spent_at === null
      ? null
      : point(match.spent_at, `${label}.spent_at`);
    if (spentAt && spentAt.slotNo < createdAt.slotNo) {
      throw new Error(`Malformed Kupo history: ${label} was spent before creation`);
    }
    if (match.datum_type !== 'inline') {
      throw new Error(`Malformed Kupo history: ${label} must have an inline datum`);
    }
    const datumHash = hex(match.datum_hash, HASH, `${label}.datum_hash`);
    let datum = datumCache.get(datumHash);
    if (!datum) {
      const rawDatum = record(
        await json(
          fetchImpl,
          `${kupoEndpoint}/datums/${datumHash}?inline`,
          headers,
        ),
        `datum ${datumHash}`,
      );
      datum = hex(rawDatum.datum, HEX, `datum ${datumHash}.datum`);
      datumCache.set(datumHash, datum);
    }
    const { assets, shardTokenUnit } = parseValue(match.value, policyId, label);
    parsed.push({
      txHash,
      outputIndex,
      transactionIndex,
      address: matchAddress,
      assets,
      datum,
      datumHash: undefined,
      scriptRef: undefined,
      shardTokenUnit,
      spent: spentAt !== null,
      createdAt,
      spentAt,
    } as ParsedHistoryOutput);
  }
  return selectLatest(parsed);
}
