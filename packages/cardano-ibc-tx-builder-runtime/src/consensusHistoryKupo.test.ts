import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Constr, Data, type UTxO } from '@lucid-evolution/lucid';
import { createKupoConsensusHistoryReader } from './consensusHistoryKupo';
import { publicClientCommitmentValues } from './plutusSerialise';

const policy = '11'.repeat(28);
const name = '22'.repeat(24) + '30';
const token = new Constr(0, [policy, name]);
const height = (n: bigint) => new Constr(0, [0n, n]);
const encode = (data: Data, canonical = true) => Data.to<Data>(data, undefined, { canonical });

function datum(n: bigint, canonical = true): string {
  const client = new Constr(0, [
    '636861696e2d30', new Constr(0, [1n, 3n]), 1000n, 2000n, 10n,
    height(0n), height(n), [],
  ]);
  const consensus = new Constr(0, [n, '33'.repeat(32), new Constr(0, ['44'.repeat(32)])]);
  return encode(new Constr(0, [new Constr(0, [
    client, new Map([[height(n), consensus]]), new Map([[height(n), n + 1n]]), new Map([[height(n), n + 2n]]),
  ]), token, '55'.repeat(32)]), canonical);
}

function context() {
  // Genesis and a freeze republish height 1 in the SAME block. The first
  // publication has indefinite containers; both normalize to the same ledger value.
  const datums: Record<string, { datum: string } | null> = {
    first: { datum: datum(1n, false) }, freeze: { datum: datum(1n) }, current: { datum: datum(2n) },
  };
  const matches = ['first', 'freeze', 'current'].map((key, index) => ({
    transaction_id: (index + 1).toString(16).padStart(64, '0'),
    transaction_index: index,
    output_index: 0,
    address: 'client-address',
    value: { assets: { [`${policy}.${name}`]: '1' } },
    datum_hash: key,
    datum_type: 'inline',
    created_at: { slot_no: 10, header_hash: '66'.repeat(32) },
  }));
  const current: UTxO = {
    txHash: matches[2].transaction_id, outputIndex: 0, address: 'client-address',
    datum: datums.current!.datum, assets: { [policy + name]: 1n },
  };
  const urls: string[] = [];
  const fetchImpl = (async (input: string | URL | Request) => {
    const url = String(input);
    urls.push(url);
    return new Response(JSON.stringify(url.includes('/matches/') ? matches : datums[url.split('/').at(-1)!]));
  }) as typeof fetch;
  return { datums, matches, current, urls, read: createKupoConsensusHistoryReader('https://kupo.example', { fetchImpl }) };
}

test('Kupo reads spent checkpoints in ledger order and normalizes public CBOR', async () => {
  const ctx = context();
  const records = await ctx.read(ctx.current);
  assert.deepEqual(records.map((entry) => entry.datum.height.revisionHeight), [1n, 2n]);
  assert.deepEqual(records.map((entry) => entry.archived), [true, false]);
  assert.equal(records[0].consensusValue, publicClientCommitmentValues(ctx.datums.first!.datum, 'production').consensusValue);
  assert.equal(records[0].consensusValue, publicClientCommitmentValues(ctx.datums.freeze!.datum, 'production').consensusValue);
  assert.equal(records[0].datum.processedTime, 2n);
  assert(ctx.urls[0].endsWith('?order=oldest_first'));
  assert(!ctx.urls.some((url) => url.includes('unspent')));
});

test('Kupo rejects incorrect same-block ordering, conflicting blocks and missing positions', async () => {
  for (const mutate of [
    (ctx: ReturnType<typeof context>) => ctx.matches.reverse(),
    (ctx: ReturnType<typeof context>) => { ctx.matches[1].created_at.header_hash = '77'.repeat(32); },
    (ctx: ReturnType<typeof context>) => { ctx.matches[1].transaction_index = NaN; },
  ]) {
    const ctx = context();
    mutate(ctx);
    await assert.rejects(ctx.read(ctx.current), /conflicting|position/);
  }
});

test('Kupo fails closed for pruned datum bytes, wrong NFT/address and a stale live anchor', async () => {
  for (const mutate of [
    (ctx: ReturnType<typeof context>) => { ctx.datums.first = null; },
    (ctx: ReturnType<typeof context>) => { ctx.matches[0].address = 'other'; },
    (ctx: ReturnType<typeof context>) => { ctx.matches[0].value.assets[`${policy}.${name}`] = '2'; },
    (ctx: ReturnType<typeof context>) => { ctx.current.datum = datum(3n); },
    (ctx: ReturnType<typeof context>) => { ctx.matches.pop(); },
  ]) {
    const ctx = context();
    mutate(ctx);
    await assert.rejects(ctx.read(ctx.current), /pruned|unauthenticated|differs|not reached/);
  }
});
