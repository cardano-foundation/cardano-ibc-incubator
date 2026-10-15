import * as cbor from 'cbor';
import * as CML from '@dcspark/cardano-multiplatform-lib-nodejs';
import { Cbor, LazyCborArray } from '@harmoniclabs/cbor';
import { blake2b } from '@noble/hashes/blake2b';
import { restProvider as provider, restGateway as gateway } from '../../test-config/rest-provider';
import { YaciRestHistoryChangedError } from '../../shared/helpers/yaci-rest';
import { createRestHistorySource, discoverRestHistoryBootstrap } from '../../shared/helpers/consensus-history-rest';
import { restBlockFixture } from '../../test-config/rest-block';

describe('direct Yaci REST history', () => {
  afterEach(() => jest.restoreAllMocks());

  it('gets blocks directly through REST without a local block table', async () => {
    const fixture = restBlockFixture();
    const { request } = provider([fixture]);
    const { service, query } = gateway(fixture);
    await expect(service.findBlockByHeight(100n)).resolves.toMatchObject({ height: 100, hash: fixture.metadata.hash });
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0][0]).toBe('https://yaci.example/api/v1/blocks/100');
    await expect(service.findLatestBlock()).resolves.toMatchObject({ height: 100 });
    expect(query).not.toHaveBeenCalled();
  });

  it('confirms transactions from their REST location and raw block validity', async () => {
    const fixture = restBlockFixture();
    const { request } = provider([fixture]);
    const { service, query } = gateway(fixture);
    await expect(service.findTxByHash(fixture.hashes[0])).resolves.toMatchObject({ hash: fixture.hashes[0], height: 100 });
    await expect(service.findTransactionEvidenceByHash(fixture.hashes[0])).resolves.toMatchObject({ txBodyCborHex: fixture.bodies[0].to_cbor_hex(), blockHash: fixture.metadata.hash, txIndex: 0 });
    // v2 details omit validity. Raw-block evidence overrides that default.
    await expect(service.findTxByHash(fixture.hashes[1])).resolves.toBeNull();
    expect(request.mock.calls.some(([url]) => String(url).endsWith(`/blocks/${fixture.metadata.hash}/cbor`))).toBe(true);
    expect(query).not.toHaveBeenCalled();
  });

  it('retains original body and datum CBOR when CML would normalize an inline bignum', async () => {
    const fixture = restBlockFixture(100, undefined, [1], 1, undefined, false, true);
    const raw = cbor.decode(fixture.bytes);
    raw[1][0].get(1)[0].set(2, [1, new cbor.Tagged(24, Buffer.from('c24101', 'hex'))]);
    fixture.bytes = cbor.encode(raw);
    const encoded = Cbor.parseLazy(fixture.bytes) as LazyCborArray;
    const bodyBytes = (Cbor.parseLazy(encoded.array[1]) as LazyCborArray).array[0];
    fixture.hashes[0] = Buffer.from(blake2b(bodyBytes, { dkLen: 32 })).toString('hex');
    const { source } = provider([fixture]);
    const tx = await source.transaction(fixture.hashes[0]);
    expect(tx?.bodyCborHex).toBe(Buffer.from(bodyBytes).toString('hex'));
    expect(tx?.outputs[0].inline_datum).toBe('c24101');
    expect((Cbor.parseLazy(Buffer.from(tx!.cborHex, 'hex')) as LazyCborArray).array[0]).toEqual(bodyBytes);
    const bootstrap = await discoverRestHistoryBootstrap(source, { clientToken: { policyId: fixture.unit.slice(0, 56), name: fixture.unit.slice(56) }, stateAddress: fixture.address });
    expect(bootstrap.txHash).toBe(fixture.hashes[0]);
  });

  it('returns no confirmation when REST has not indexed the transaction', async () => {
    const fixture = restBlockFixture(); provider([fixture]);
    await expect(gateway(fixture).service.findTxByHash('ff'.repeat(32))).resolves.toBeNull();
  });

  it('finds the intent settlement when its change output later funds another intent at the same guard', async () => {
    const replaceFirstBody = (fixture: ReturnType<typeof restBlockFixture>, body: CML.TransactionBody) => {
      const raw = cbor.decode(fixture.bytes);
      raw[1][0] = cbor.decode(body.to_cbor_bytes());
      fixture.bytes = cbor.encode(raw);
      fixture.bodies[0] = body;
      fixture.hashes[0] = CML.hash_transaction(body).to_hex();
    };

    const original = restBlockFixture(100);
    const changeAddress = CML.Address.from_raw_bytes(Buffer.from('60' + '66'.repeat(28), 'hex'));
    const outputs = original.bodies[0].outputs();
    outputs.add(CML.TransactionOutput.new(changeAddress, CML.Value.from_coin(100n)));
    replaceFirstBody(original, CML.TransactionBody.new(original.bodies[0].inputs(), outputs, 1n));

    // Settlement spends T#0 at the guard. A later intent spends T#1 at the user's change address.
    const settlement = restBlockFixture(101, original.metadata.hash, [1], 3, original.hashes[0]);
    const nextIntent = restBlockFixture(102, settlement.metadata.hash, [1], 5);
    const changeInput = CML.TransactionInputList.new();
    changeInput.add(CML.TransactionInput.new(CML.TransactionHash.from_hex(original.hashes[0]), 1n));
    replaceFirstBody(nextIntent, CML.TransactionBody.new(changeInput, nextIntent.bodies[0].outputs(), 5n));

    const { source } = provider([original, settlement, nextIntent]);
    const { service, query } = gateway(original);
    const history = await source.transactionsFor(`addresses/${original.address}/transactions`, 102);
    expect(history.map((tx) => tx.hash)).toContain(settlement.hashes[0]);
    expect(history.map((tx) => tx.hash)).toContain(nextIntent.hashes[0]);

    await expect(service.findIntentSpendingTransaction(original.hashes[0], original.address)).resolves.toMatchObject({
      txHash: settlement.hashes[0],
      blockNo: 101,
      txBodyCborHex: settlement.bodies[0].to_cbor_hex(),
    });
    expect(query).not.toHaveBeenCalled();
  });

  it('rejects transaction metadata that disagrees with the raw block', async () => {
    const fixture = restBlockFixture(); const { source } = provider([fixture]);
    const original = source.api.json.bind(source.api);
    jest.spyOn(source.api, 'json').mockImplementation(async (path) => path.startsWith('txs/') ? { hash: fixture.hashes[0], block_height: 100, slot: 999 } : original(path));
    await expect(source.transaction(fixture.hashes[0])).rejects.toThrow('disagrees');
  });

  it('removes an NFT at the height of a burn discovered through address history', async () => {
    const first = restBlockFixture(100, undefined, [1], 1);
    const burn = restBlockFixture(101, first.metadata.hash, [1], 3, first.hashes[0], true);
    const { source } = provider([first, burn]);
    const filter = { policy: first.unit.slice(0, 56), unit: first.unit, unspent: true };
    expect(await source.outputs(filter, 100)).toHaveLength(1);
    expect(await source.outputs(filter, 101)).toEqual([]);
    // Retained checkpoint outputs remain available for consensus reconstruction.
    expect(await source.outputs({ ...filter, unspent: false }, 101)).toHaveLength(1);
  });

  it('rejects an anchor replaced during a request', async () => {
    const first = restBlockFixture(); const { source, state } = provider([first]);
    await expect(source.snapshot(100, async () => {
      state.blocks = [restBlockFixture(100, undefined, [1], 9)];
      return 'stale proof';
    })).rejects.toThrow(YaciRestHistoryChangedError);
  });

  it('looks up the first epoch block using the final page instead of walking the whole epoch', async () => {
    const fixture = restBlockFixture();
    const { source } = provider([fixture]);
    jest.spyOn(source.api, 'json').mockImplementation(async (path) => ({ total_pages: 50,
      blocks: [{ ...fixture.metadata, number: path.endsWith('page=50') ? 1 : 100, slot: path.endsWith('page=50') ? 10 : 1000 }] }));
    await expect(source.firstBlockInEpoch(0)).resolves.toMatchObject({ number: 1, slot: 10 });
    expect(source.api.json).toHaveBeenCalledTimes(2);
    expect(source.api.json).toHaveBeenNthCalledWith(2, 'blocks/epoch/0?count=100&page=50');
  });

  it('reads epoch summaries without fetching a block separately for every row', async () => {
    const fixture = restBlockFixture();
    const { source } = provider([fixture]);
    const summaries = [{ ...fixture.metadata, hash: undefined }, { ...fixture.metadata, number: 99, slot: 990, hash: undefined }];
    jest.spyOn(source.api, 'json').mockResolvedValue({ blocks: summaries });
    const blocks = jest.spyOn(source.api, 'block');
    await expect(source.epochBlocks(0)).resolves.toMatchObject([{ number: 99, slot: 990 }, { number: 100, slot: 1000 }]);
    expect(source.api.json).toHaveBeenCalledWith('blocks/epoch/0?count=100&page=1');
    expect(blocks).toHaveBeenCalledTimes(2);
  });

  it('starts at page one and fails if pagination repeats instead of looping', async () => {
    const { source, request } = provider([restBlockFixture()]);
    jest.spyOn(source.api, 'json').mockResolvedValue(Array.from({ length: 100 }, (_, n) => ({ unit: '33'.repeat(28) + n.toString(16).padStart(2, '0') })));
    await expect(source.policyUnits('33'.repeat(28))).rejects.toThrow('repeated a row');
    expect(request).not.toHaveBeenCalled();
    expect(source.api.json).toHaveBeenNthCalledWith(1, expect.stringContaining('page=1'));
    expect(source.api.json).toHaveBeenNthCalledWith(2, expect.stringContaining('page=2'));
  });

  it('resumes from indexed REST history without downloading older raw blocks again', async () => {
    const first = restBlockFixture(100, undefined, [1], 1, undefined, false, true);
    const next = restBlockFixture(101, first.metadata.hash, [1], 3, first.hashes[0]);
    const { source, request } = provider([first, next]);
    const deployment = { clientToken: { policyId: first.unit.slice(0, 56), name: first.unit.slice(56) }, stateAddress: first.address,
      bootstrap: { txHash: first.hashes[0], outputIndex: 0 } };
    const history = createRestHistorySource(source, deployment, async () => ({} as never));
    const rows: unknown[] = [];
    for await (const row of history.transactions({ txHash: next.hashes[0], blockHash: next.metadata.hash,
      blockHeight: 101, slot: next.metadata.slot, transactionIndex: 0 })) rows.push(row);
    expect(rows).toHaveLength(1);
    expect(request.mock.calls.some(([url]) => String(url).endsWith(`/blocks/${first.metadata.hash}/cbor`))).toBe(false);
    expect(request.mock.calls.some(([url]) => String(url).includes('order=asc'))).toBe(true);
  });

  it('discovers NFT creation and replays accepted client bodies through REST', async () => {
    const fixture = restBlockFixture(100, undefined, [1], 1, undefined, false, true);
    const { source } = provider([fixture]);
    const identity = { clientToken: { policyId: fixture.unit.slice(0, 56), name: fixture.unit.slice(56) }, stateAddress: fixture.address };
    const bootstrap = await discoverRestHistoryBootstrap(source, identity);
    expect(bootstrap).toEqual({ txHash: fixture.hashes[0], outputIndex: 0 });
    const history = createRestHistorySource(source, { ...identity, bootstrap }, async () => ({} as never));
    const rows: import('@cardano-ibc/tx-builder-runtime/consensusHistoryRecovery').HistoryTransaction[] = [];
    for await (const row of history.transactions()) rows.push(row);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ txHash: fixture.hashes[0], valid: true, cbor: fixture.bodies[0].to_cbor_hex() });
    await expect(async () => { for await (const _row of history.transactions({ ...rows[0], blockHash: 'ff'.repeat(32) })) { /* consume */ } }).rejects.toThrow('no longer canonical');
  });
});
