import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Constr, credentialToAddress, Data, type LucidEvolution, type UTxO, validatorToScriptHash, type TxBuilder } from '@lucid-evolution/lucid';
import { BridgeMigrationInProgressError, migrationReference, type MigrationRuntimeDeployment, requireMigrationConfig, withClientRecoveryApproval } from './migrationRuntime';

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

test('authority-enabled registries preserve runtime checks without changing legacy decoding', async () => {
  const f = fixture();
  assert.equal(await migrationReference(f.lucid, f.deployment), f.utxo);
  f.deployment.migration!.profile = 'cardano-ibc-compatible-v4';
  await assert.rejects(migrationReference(f.lucid, f.deployment), /Unsupported migration registry datum/);
  const datum = Data.from(f.utxo.datum!) as Constr<Data>;
  datum.fields.push(hash(19));
  f.utxo.datum = Data.to(datum);
  assert.equal(await migrationReference(f.lucid, f.deployment), f.utxo);
  datum.fields[8] = '';
  f.utxo.datum = Data.to(datum);
  await assert.rejects(migrationReference(f.lucid, f.deployment), /Invalid fixed governance authority/);
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

function recoveryFixture() {
  const f = fixture();
  f.deployment.migration!.profile = 'cardano-ibc-compatible-v5';
  const script = {type: 'PlutusV3' as const, script: '49480100002221200101'};
  const address = credentialToAddress('Custom', {type: 'Script', hash: validatorToScriptHash(script)});
  f.deployment.migration!.registryAddress = address;
  f.utxo.address = address;
  const datum = Data.from(f.utxo.datum!) as Constr<Data>;
  datum.fields.push(hash(19));
  datum.fields[4] = 1n;
  datum.fields[6] = new Constr(1, [new Constr(3, [1n, 1n, rec(hash(11), 'aa'), rec(hash(11), 'bb')]), 2000n, 10000n]);
  f.utxo.datum = Data.to(datum);
  const reference: UTxO = {txHash: 'bb'.repeat(32), outputIndex: 0, address: scriptAddress(15), assets: {lovelace: 10_000_000n}, scriptRef: script};
  Object.assign(f.lucid, {
    unixTimeToSlot: (time: number) => Math.floor(time / 1000),
    slotToUnixTime: (slot: number) => slot * 1000,
    utxosAt: async (holder: string) => { assert.equal(holder, reference.address); return [reference]; },
  });
  const calls: unknown[][] = [];
  const tx = {readFrom: (...args: unknown[]) => { calls.push(['read', ...args]); return tx; },
    collectFrom: (...args: unknown[]) => { calls.push(['spend', ...args]); return tx; },
    pay: {ToContract: (...args: unknown[]) => { calls.push(['pay', ...args]); return tx; }},
  } as unknown as TxBuilder;
  const build = (subject = hash(11) + 'aa', substitute = hash(11) + 'bb', from = 2000, to = 9000) =>
    withClientRecoveryApproval(f.lucid, tx, f.deployment, subject, substitute, from, to);
  return {...f, datum, reference, tx, calls, build, save: () => { f.utxo.datum = Data.to(datum); }};
}

test('recovery spends and clears the exact delayed registry approval', async () => {
  const f = recoveryFixture();
  const before = structuredClone(f.utxo.assets);
  assert.equal(await f.build(), f.tx);
  assert.deepEqual(f.calls[0], ['read', [f.reference]]);
  assert.deepEqual(f.calls[1], ['spend', [f.utxo], Data.to(new Constr(14, []))]);
  const output = f.calls[2];
  assert.equal(output[1], f.utxo.address);
  const next = Data.from((output[2] as {value:string}).value) as Constr<Data>;
  assert.deepEqual(next.fields[6], new Constr(0, []));
  const original = Data.from(f.utxo.datum!) as Constr<Data>;
  original.fields[6] = new Constr(0, []);
  assert.deepEqual(next, original);
  assert.deepEqual(output[3], before);
});

test('recovery rejects unapproved, stale, early, expired and retargeted decisions', async () => {
  const cases: Array<[(f: ReturnType<typeof recoveryFixture>) => void, RegExp]> = [
    [f => { f.datum.fields[6] = new Constr(0, []); }, /No approved/],
    [f => { (f.datum.fields[6] as Constr<Data>).fields[0] = new Constr(2, [1n,1n,hash(1)]); }, /not a client recovery/],
    [f => { ((f.datum.fields[6] as Constr<Data>).fields[0] as Constr<Data>).fields[0] = 2n; }, /different subject/],
    [f => { ((f.datum.fields[6] as Constr<Data>).fields[0] as Constr<Data>).fields[1] = 2n; }, /different subject/],
    [f => { (f.datum.fields[6] as Constr<Data>).fields[1] = 3000n; }, /delayed or expired/],
    [f => { (f.datum.fields[6] as Constr<Data>).fields[2] = 8000n; }, /delayed or expired/],
    [f => { (f.datum.fields[7] as Constr<Data>).fields[2] = 2n; }, /emergency-restricted/],
    [f => { delete f.reference.scriptRef; }, /registry reference/],
  ];
  for (const [mutate, expected] of cases) {
    const f = recoveryFixture(); mutate(f); f.save();
    await assert.rejects(f.build(), expected);
    assert.equal(f.calls.length, 0);
  }
  const f = recoveryFixture();
  await assert.rejects(f.build(hash(11)+'cc'), /different subject/);
  await assert.rejects(f.build(undefined, hash(11)+'cc'), /different subject/);
  f.deployment.migration!.profile = 'cardano-ibc-compatible-v4';
  await assert.rejects(f.build(), /does not support quorum/);
});
