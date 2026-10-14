import * as CML from '@dcspark/cardano-multiplatform-lib-nodejs';
import * as cbor from 'cbor';
import { createRestHistorySource, discoverRestHistoryBootstrap } from '../../shared/helpers/consensus-history-rest';
import { restBlockFixture } from '../../test-config/rest-block';
import { restProvider } from '../../test-config/rest-provider';

function sameBlockHistory(mintFirst = true, onlyUpdateIndexed = false) {
  const fixture = restBlockFixture(100, undefined, [], 1, undefined, false, mintFirst);
  const inputs = CML.TransactionInputList.new();
  inputs.add(CML.TransactionInput.new(CML.TransactionHash.from_hex(fixture.hashes[0]), 0n));
  const update = CML.TransactionBody.new(inputs, fixture.bodies[1].outputs(), 2n);
  if (!mintFirst) {
    const mint = CML.Mint.new();
    mint.set(CML.ScriptHash.from_hex(fixture.unit.slice(0, 56)), CML.AssetName.from_hex(fixture.unit.slice(56)), 1n);
    update.set_mint(mint);
  }
  fixture.bodies[1] = update;
  fixture.hashes[1] = CML.hash_transaction(update).to_hex();
  const raw = cbor.decode(fixture.bytes);
  raw[1][1] = cbor.decode(update.to_cbor_bytes());
  fixture.bytes = cbor.encode(raw);

  const { source } = restProvider([fixture]);
  const json = source.api.json.bind(source.api);
  jest.spyOn(source.api, 'json').mockImplementation(async (path) => {
    const response = await json(path);
    if (!path.startsWith(`assets/${fixture.unit}/transactions`)) return response;
    const reversed = response.reverse();
    return onlyUpdateIndexed ? reversed.slice(0, 1) : reversed;
  });
  const identity = {
    clientToken: { policyId: fixture.unit.slice(0, 56), name: fixture.unit.slice(56) },
    stateAddress: fixture.address,
  };
  return { fixture, source, identity };
}

describe('Yaci REST bootstrap discovery', () => {
  afterEach(() => jest.restoreAllMocks());

  it.each([false, true])(
    'discovers a same-block mint before an update listed first by REST with migration %s',
    async (allowScriptMigration) => {
      const { fixture, source, identity } = sameBlockHistory();
      const deployment = {
        ...identity,
        allowScriptMigration,
        stateAddress: allowScriptMigration ? 'replacement-client-address' : identity.stateAddress,
      };
      await expect(discoverRestHistoryBootstrap(source, deployment)).resolves.toEqual({
        txHash: fixture.hashes[0],
        outputIndex: 0,
      });
      const history = createRestHistorySource(
        source,
        { ...deployment, bootstrap: { txHash: fixture.hashes[0], outputIndex: 0 } },
        async () => ({}) as never,
      );
      const indexes: number[] = [];
      for await (const tx of history.transactions()) indexes.push(tx.transactionIndex);
      expect(indexes).toEqual([0, 1]);
    },
  );

  it('finds the mint in the earliest indexed block even when only its update is listed', async () => {
    const { fixture, source, identity } = sameBlockHistory(true, true);
    await expect(discoverRestHistoryBootstrap(source, identity)).resolves.toEqual({
      txHash: fixture.hashes[0],
      outputIndex: 0,
    });
  });

  it('rejects an earliest NFT output without its mint instead of accepting a later remint in the same block', async () => {
    const { source, identity } = sameBlockHistory(false);
    await expect(discoverRestHistoryBootstrap(source, identity)).rejects.toThrow(
      'bootstrap transaction must mint exactly the configured client NFT',
    );
  });
});
