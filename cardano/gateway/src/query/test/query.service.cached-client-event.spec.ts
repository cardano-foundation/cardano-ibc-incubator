import * as Lucid from '@lucid-evolution/lucid';
import crypto from 'crypto';
import { prepareCachedHeader, initializeValidatorCache, readValidatorCache, cacheRecord } from '@cardano-ibc/tx-builder-runtime/tendermintCache';
import { QueryService } from '../services/query.service';
import { clientDatumMockBuilder } from '../../tx/test/mock/client-datum';
import { encodeClientDatum } from '../../shared/types/client-datum';
import headerMockBuilder from '../../tx/test/mock/header';
import { initializeHeader } from '../../shared/types/header';

const client = { policyId: '83'.repeat(28), name: '84'.repeat(25) };
const address = Lucid.credentialToAddress('Custom', { type: 'Script', hash: '85'.repeat(28) });
const cacheAddress = Lucid.credentialToAddress('Custom', { type: 'Script', hash: '86'.repeat(28) });
const policy = '87'.repeat(28);
const pubkey = '88'.repeat(32);
const validatorAddress = crypto.createHash('sha256').update(Buffer.from(pubkey, 'hex')).digest('hex').slice(0, 40);
const initialRoot = cacheRecord([{ index: 0, pubkey, power: 10n }]).root;

async function fixture() {
  const created = initializeValidatorCache(client, policy, address);
  let cache = readValidatorCache({ datum: created.datum, assets: { [created.tokenUnit]: 1n } } as any, client, policy, address);
  const history: any[] = [];
  const cacheHistory: any[] = [];
  const evidence = new Map<string, any>();
  const witnesses: any[] = [];
  let lastTx = '11'.repeat(32);
  let lastHeight = 8n;
  let lastPower = 10n;
  async function datum(height: bigint, root: string) {
    const d = clientDatumMockBuilder.withLatestHeight(0n, height).build();
    d.token = client;
    const [, consensus] = [...d.state.consensusStates][0];
    const key = { revisionNumber: 0n, revisionHeight: height };
    d.state.consensusStates = new Map([[key, { ...consensus, next_validators_hash: root }]]);
    return d;
  }
  history.push({ txHash: lastTx, outputIndex: 0, address, assetsPolicy: client.policyId, assetsName: client.name, datum: await encodeClientDatum(await datum(lastHeight, initialRoot), Lucid), blockNo: 1 });
  for (const [offset, power] of [10n, 10n, 11n].entries()) {
    const txHash = String(offset + 2).repeat(64);
    const height = lastHeight + (power === lastPower ? 1n : 2n);
    const root = cacheRecord([{ index: 0, pubkey, power }]).root;
    const header: any = initializeHeader(headerMockBuilder.build());
    header.trustedHeight = { revisionNumber: 0n, revisionHeight: lastHeight };
    header.validatorSet = { validators: [{ address: validatorAddress, pubkey, votingPower: power, proposerPriority: 0n }] };
    header.trustedValidators = { validators: [{ address: validatorAddress, pubkey, votingPower: lastPower, proposerPriority: 0n }] };
    header.signedHeader.header.height = height;
    header.signedHeader.header.proposerAddress = validatorAddress;
    header.signedHeader.header.validatorsHash = root;
    header.signedHeader.header.nextValidatorsHash = root;
    header.signedHeader.commit.height = height;
    header.signedHeader.commit.signatures = [{ block_id_flag: 2n, validator_address: validatorAddress, timestamp: 1000n, signature: '89'.repeat(64) }];
    const prepared = prepareCachedHeader({ header, cache, trustedRoot: cacheRecord([{ index: 0, pubkey, power: lastPower }]).root, latestHeight: header.trustedHeight, trustLevel: { numerator: 1n, denominator: 3n }, historySiblings: Array(64).fill("00".repeat(32)) });
    cache = readValidatorCache({ datum: prepared.nextCacheDatum, assets: { [created.tokenUnit]: 1n } } as any, client, policy, address);
    const row = { txHash, outputIndex: 0, address, assetsPolicy: client.policyId, assetsName: client.name, datum: await encodeClientDatum(await datum(height, root), Lucid), blockNo: offset + 2 };
    history.push(row);
    cacheHistory.push({ ...row, outputIndex: 1, address: cacheAddress, assetsPolicy: policy, assetsName: cache.token.name, datum: prepared.nextCacheDatum });
    const inputs = Lucid.CML.TransactionInputList.new();
    inputs.add(Lucid.CML.TransactionInput.new(Lucid.CML.TransactionHash.from_hex(lastTx), 0n));
    evidence.set(txHash, { txBodyCborHex: Lucid.CML.TransactionBody.new(inputs, Lucid.CML.TransactionOutputList.new(), 0n).to_cbor_hex(), redeemers: [{ type: 'spend', index: 0, data: prepared.redeemer }] });
    witnesses.push({ row, datum: await datum(height, root), redeemers: [{ type: 'spend', index: 0n, data: prepared.redeemer }] });
    lastTx = txHash;
    lastHeight = height;
    lastPower = power;
  }
  const config = { get: () => ({ validators: { mintClientStt: { scriptHash: client.policyId }, spendClient: { address } }, cachedTendermint: { validators: { cacheMint: { scriptHash: policy }, cacheSpend: { address: cacheAddress } } } }) };
  const historyService = { findUtxosByPolicyIdAndPrefixTokenName: jest.fn(async (p: string) => p === policy ? cacheHistory : history) };
  const mini = { fetchTransactionEvidence: jest.fn(async (hash: string) => evidence.get(hash)) };
  const service = new QueryService({ debug() {}, log() {}, error() {}, warn() {} } as any, config as any, { LucidImporter: Lucid } as any, {} as any, historyService as any, mini as any, {} as any, {} as any, {} as any, {} as any);
  const recover = (witness = witnesses[2]) => (service as any).recoverCachedTendermintHeader(witness.row, witness.datum, witness.redeemers);
  return { recover, witnesses, history, cacheHistory, mini };
}

describe('durable cached Tendermint header recovery', () => {
  it('recovers a full admission, cache hit and power transition without process state', async () => {
    const f = await fixture();
    for (const [index, witness] of f.witnesses.entries()) {
      const header = await f.recover(witness);
      expect(header.signedHeader.header.height).toBe(index === 2 ? 12n : BigInt(index + 9));
      expect(header.validatorSet.validators[0].votingPower).toBe(index === 2 ? 11n : 10n);
      expect(header.trustedValidators.validators[0].votingPower).toBe(10n);
      expect(header.signedHeader.commit.signatures).toHaveLength(1);
    }
  });

  it('requires the authenticated prior client checkpoint', async () => {
    const f = await fixture();
    f.history[2].datum = undefined;
    await expect(f.recover()).rejects.toThrow('Missing cached event client input datum');
  });

  it('fails closed when the original validator set is absent from durable history', async () => {
    const f = await fixture();
    f.cacheHistory.splice(0, f.cacheHistory.length);
    await expect(f.recover()).rejects.toThrow('Incomplete validator cache history');
  });

  it('rejects a correct cache witness attributed to another client NFT', async () => {
    const f = await fixture();
    f.witnesses[2].row.assetsName = '99'.repeat(25);
    await expect(f.recover()).rejects.toThrow('canonical client NFT');
  });
});
