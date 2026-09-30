import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Constr, credentialToAddress, Data, type LucidEvolution, type UTxO } from '@lucid-evolution/lucid';
import { BridgeMigrationInProgressError, migrationReference, type MigrationRuntimeDeployment, requireMigrationConfig } from './migrationRuntime';

const hash = (n: number) => n.toString(16).padStart(2, '0').repeat(28);
const rec = (...fields: Data[]) => new Constr(0, fields);
const scriptAddress = (n: number) => credentialToAddress('Custom', {type: 'Script', hash: hash(n)});
const rawAddress = (n: number) => rec(new Constr(1, [hash(n)]), new Constr(1, []));
function fixture(phase = 0, generation = 1n, mask = 0n) {
  const addresses = [1, 2, 3, 4, 5].map(scriptAddress);
  const registryUnit = hash(9) + '6962635f696d706c656d656e746174696f6e5f7265676973747279';
  const compatibility = 'ab'.repeat(32);
  const deployment: MigrationRuntimeDeployment = {
    migration: {profile: 'cardano-ibc-compatible-v3', registryUnit, registryAddress: scriptAddress(10), generation: '1', compatibility, originalAddresses: addresses},
    hostStateNFT: {policyId: hash(8), name: '6962635f686f73745f7374617465'},
    validators: {
      hostStateStt: {address: addresses[0]}, spendClient: {address: addresses[1]}, spendConnection: {address: addresses[2]},
      spendChannel: {address: addresses[3]}, spendTransferModule: {address: addresses[4]},
      mintClientStt: {scriptHash: hash(11)}, mintConnectionStt: {scriptHash: hash(12)}, mintChannelStt: {scriptHash: hash(13)}, mintTransferEscrowShard: {scriptHash: hash(14)},
    }, modules: {transfer: {address: addresses[4]}},
  };
  const datum = rec(rec(hash(9), registryUnit.slice(56)), hash(8), rec(hash(11), hash(12), hash(13), hash(14), rawAddress(15)),
    rec([hash(16)], 1n, 86_400_000n), 0n, rec(generation, [1, 2, 3, 4, 5].map(rawAddress), compatibility), new Constr(phase, []), rec(rec([hash(17)], 1n), 0n, mask, new Constr(1, [])));
  const utxo: UTxO = {txHash: 'aa'.repeat(32), outputIndex: 0, address: scriptAddress(10), assets: {[registryUnit]: 1n, lovelace: 5_000_000n}, datum: Data.to(datum)};
  const lucid = {config: () => ({network: 'Custom'}), utxoByUnit: async (unit: string) => { assert.equal(unit, registryUnit); return utxo; }} as unknown as LucidEvolution;
  return {deployment, utxo, lucid};
}

test('runtime references the exact canonical registry; preparation admits existing operations only', async () => {
  for (const phase of [0, 1]) {
    const {deployment, utxo, lucid} = fixture(phase);
    assert.equal(await migrationReference(lucid, deployment), utxo);
    if (phase === 1) await assert.rejects(migrationReference(lucid, deployment, true), /New state objects are paused/);
    else assert.equal(await migrationReference(lucid, deployment, true), utxo);
  }
});

test('runtime rejects Moving and stale manifests after activation', async () => {
  const moving = fixture(2);
  await assert.rejects(migrationReference(moving.lucid, moving.deployment), BridgeMigrationInProgressError);
  const successor = fixture(0, 2n);
  await assert.rejects(migrationReference(successor.lucid, successor.deployment), /Stale implementation manifest/);
});

test('runtime rejects forged identities and full-address substitutions independently', async () => {
  const cases: Array<[string, (f: ReturnType<typeof fixture>) => void, RegExp]> = [
    ['registry NFT', ({utxo}) => { utxo.assets = {lovelace: 5_000_000n}; }, /authenticated implementation registry/],
    ['registry custody', ({utxo}) => { utxo.address = scriptAddress(20); }, /authenticated implementation registry/],
    ['host name', ({deployment}) => { deployment.hostStateNFT.name = 'ff'; }, /different bridge/],
    ['compatibility', ({deployment}) => { deployment.migration!.compatibility = 'cd'.repeat(32); }, /compatibility profile/],
    ['state policy', ({deployment}) => { deployment.validators.mintClientStt.scriptHash = hash(20); }, /immutable state policy/],
    ['stake credential', ({deployment}) => { deployment.validators.spendChannel.address = credentialToAddress('Custom', {type: 'Script', hash: hash(4)}, {type: 'Key', hash: hash(21)}); }, /not the approved implementation/],
    ['module redirect', ({deployment}) => { deployment.modules.transfer.address = scriptAddress(20); }, /Transfer module address/],
  ];
  for (const [name, mutate, expected] of cases) {
    const f = fixture();
    assert.equal(await migrationReference(f.lucid, f.deployment), f.utxo, `${name} positive control`);
    mutate(f);
    await assert.rejects(migrationReference(f.lucid, f.deployment), expected, name);
  }
});

test('migration manifests fail closed instead of silently losing the feature marker', () => {
  const {deployment} = fixture();
  for (const mutate of [
    (x: Record<string, unknown>) => { x.profile = 'future-profile'; },
    (x: Record<string, unknown>) => { delete x.generation; },
    (x: Record<string, unknown>) => { x.registryUnit = ''; },
  ]) {
    const value = {...deployment.migration}; mutate(value);
    assert.throws(() => requireMigrationConfig(value), /Unsupported or incomplete/);
  }
});


test('recovery capability cannot be stripped from an explicitly upgradeable deployment', async () => {
  await assert.rejects(() => migrationReference({} as never, {deploymentMode:'upgradeable'} as never), /missing its recovery/);
});


test('emergency traffic restriction preserves client and heartbeat builder availability', async () => {
  for (const phase of [0, 1]) {
    const f = fixture(phase, 1n, 9n);
    await assert.rejects(migrationReference(f.lucid, f.deployment), /restrict/);
    assert.equal(await migrationReference(f.lucid, f.deployment, false, 2n), f.utxo);
    assert.equal(await migrationReference(f.lucid, f.deployment, false, 4n), f.utxo);
  }
  for (const bit of [1n, 2n, 4n]) {
    const f = fixture(0, 1n, 15n);
    await assert.rejects(migrationReference(f.lucid, f.deployment, false, bit), /restrict/);
    const moving = fixture(2, 1n, 0n);
    await assert.rejects(migrationReference(moving.lucid, moving.deployment, false, bit), BridgeMigrationInProgressError);
  }
});
