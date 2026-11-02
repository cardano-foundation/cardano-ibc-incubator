// Exercise normal Gateway messages against the native fixture provider.
const assert = require('node:assert/strict');
const path = require('node:path');
require('tsconfig-paths').register({ baseUrl: path.resolve('dist'), paths: {
  'src/*': ['*'], '~@/*': ['*'], '@shared/*': ['shared/*'], '@utils/*': ['utils/*'], '@config/*': ['config/*'],
} });
const lib = require('@lucid-evolution/lucid');
const { TendermintClientService } = require('../../../dist/tx/tendermint-client.service');
const { LucidService } = require('../../../dist/shared/modules/lucid/lucid.service');
const { TxOperationRunnerService } = require('../../../dist/tx/tx-operation-runner.service');
const { WalletContextService } = require('../../../dist/tx/wallet-context.service');
const { QueryService } = require('../../../dist/query/services/query.service');
const { IbcTreeStateStore } = require('../../../dist/shared/helpers/ibc-state-root');
const { IbcTreePendingUpdatesService } = require('../../../dist/shared/services/ibc-tree-pending-updates.service');
const { TxEventsService } = require('../../../dist/tx/tx-events.service');
const clientCodec = require('../../../dist/shared/types/client-datum');
const { normalizeClientStateFromDatum } = require('../../../dist/shared/helpers/client-state');
const { clientDatumMockBuilder } = require('../../../dist/tx/test/mock/client-datum');
const { ConsensusHistoryCommitment } = require('@cardano-ibc/tx-builder-runtime/consensusHistory');
const { validatorCacheToken, readValidatorCache } = require('@cardano-ibc/tx-builder-runtime/tendermintCache');
const { Any } = require('@cardano-ibc/proto-types/build/google/protobuf/any');
const { Header, ClientState, ConsensusState } = require('@cardano-ibc/proto-types/build/ibc/lightclients/tendermint/v1/tendermint');
const { MsgCreateClient, MsgUpdateClient } = require('@cardano-ibc/proto-types/build/ibc/core/client/v1/tx');
const { normalizeHandlerJsonDeploymentConfig } = require('../../../dist/config/bridge-manifest');
const { BinaryReader } = require('@cardano-ibc/proto-types/build/binary');
const encode = (v) => JSON.stringify(v, (_, n) => typeof n === 'bigint' ? { bigint: n.toString() } : n);
const decode = (s) => JSON.parse(s, (_, n) => n && typeof n.bigint === 'string' ? BigInt(n.bigint) : n);
async function rpc(method, ...args) {
  const response = await fetch(process.argv[2], { method: 'POST', body: encode({ method, args }) });
  const value = decode(await response.text());
  if (value.error) throw new Error(value.error);
  return value.result;
}
const logger = { log() {}, debug() {}, warn() {}, error(...args) { console.error(...args); } };
console.log = () => {};
console.dir = () => {};

function chainResponse(response) {
  if (!response.unsigned_tx.type_url) return { transactions: [Buffer.from(response.unsigned_tx.value).toString()], rebuild: false };
  assert.equal(response.unsigned_tx.type_url, '/ibc.cardano.v1.TendermintUpdateTxChain');
  const reader = new BinaryReader(response.unsigned_tx.value);
  const transactions = [];
  let rebuild = false;
  while (reader.pos < reader.len) {
    const tag = reader.uint32();
    if (tag === 8) assert.equal(reader.uint32(), 1);
    else if (tag === 18) transactions.push(reader.string());
    else if (tag === 24) rebuild = reader.bool();
    else reader.skipType(tag & 7);
  }
  return { transactions, rebuild };
}

async function runtime(fixture) {
  const { deployment, signer, clock } = fixture;
  const provider = Object.fromEntries(['getProtocolParameters', 'getUtxos', 'getUtxosWithUnit', 'getUtxoByUnit', 'getUtxosByOutRef', 'getDatum', 'getDelegation', 'evaluateTx', 'awaitTx', 'submitTx'].map((method) => [method, (...args) => rpc(method, ...args)]));
  const parameters = provider.getProtocolParameters;
  provider.getProtocolParameters = async () => {
    const p = await parameters();
    for (const key of ['coinsPerUtxoByte', 'keyDeposit', 'poolDeposit', 'maxTxExMem', 'maxTxExSteps', 'drepDeposit', 'govActionDeposit']) if (p[key] !== undefined) p[key] = BigInt(p[key]);
    return p;
  };
  const lucid = await lib.Lucid(provider, 'Custom', { slotConfig: clock });
  lib.SLOT_CONFIG_NETWORK.Custom = clock;
  const values = { deployment, cardanoNetwork: 'Custom', ogmiosEndpoint: process.argv[2] };
  const config = { get: (key) => values[key], getOrThrow: (key) => {
    if (values[key] === undefined) throw new Error(`Unexpected config ${key}`);
    return values[key];
  } };
  let lucidService;
  const history = async (datum) => {
    const rows = await rpc('history', datum.token.policyId, datum.token.name);
    const records = new Map();
    for (const row of rows) {
      const old = await clientCodec.decodeClientDatum(row.datum, lib);
      const [height, consensus] = [...old.state.consensusStates][0];
      if (height.revisionHeight > datum.state.clientState.latestHeight.revisionHeight) continue;
      records.set(`${height.revisionNumber}-${height.revisionHeight}`, { clientToken: old.token, height,
        consensusState: { timestamp: consensus.timestamp, nextValidatorsHash: consensus.next_validators_hash, root: consensus.root.hash },
        processedTime: [...old.state.processedTimes.values()][0], processedHeight: [...old.state.processedHeights.values()][0],
      });
    }
    const index = new ConsensusHistoryCommitment();
    const latest = datum.state.clientState.latestHeight;
    let tip;
    for (const record of records.values()) {
      if (record.height.revisionNumber === latest.revisionNumber && record.height.revisionHeight === latest.revisionHeight) tip = record;
      else index.append(record);
    }
    assert.equal(await index.getRoot(), datum.history_root, 'confirmed history does not match the client commitment');
    assert(tip);
    return { index, tip, records: [...records.values()] };
  };
  const publicRecord = (record) => ({ ...record, consensusState: { timestamp: record.consensusState.timestamp, next_validators_hash: record.consensusState.nextValidatorsHash, root: { hash: record.consensusState.root } } });
  const historyAdapter = {
    insertion: async (_utxo, datum) => {
      const { index, tip } = await history(datum);
      const witness = await index.insertionWitness(tip);
      index.append(tip);
      return { siblings: witness.siblings, newRoot: await index.getRoot() };
    },
    records: async (_utxo, datum) => {
      const { records, tip } = await history(datum);
      return Promise.all(records.map(async (record) => ({ datum: publicRecord(record), consensusValue: await clientCodec.encodeConsensusStateValue(publicRecord(record).consensusState, lib), archived: record !== tip })));
    },
    witnesses: async (_utxo, datum, _read, heights) => {
      const { index } = await history(datum);
      return Promise.all(heights.map(async (height) => {
        const witness = await index.witness(datum.token, height);
        return { record: publicRecord(witness.record), siblings: witness.siblings };
      }));
    },
  };
  lucidService = new LucidService(lib, lucid, config, historyAdapter);
  await lucidService.onModuleInit();
  // Only the node's clock and UTxO transport are replaced. Every transaction is
  // constructed by production services and evaluated by the real script engine.
  lucidService.queryLedgerStateUtxosAtAddresses = async (addresses) => (await Promise.all(addresses.map((a) => lucid.utxosAt(a)))).flat();
  const tree = new IbcTreeStateStore({ network: 'Custom', hostStateNFT: deployment.hostStateNFT, clientPolicyId: deployment.validators.mintClientStt.scriptHash }, {
    queryAllClientUtxos: () => lucid.utxosAt(deployment.validators.spendClient.address),
    queryAllConnectionUtxos: async () => [], queryAllChannelUtxos: async () => [],
  }, lucidService);
  const pending = new IbcTreePendingUpdatesService();
  const runner = new TxOperationRunnerService(lucidService, new WalletContextService(logger, lucidService), new TxEventsService(), pending);
  const fallbackReasons = [];
  const clientLogger = { ...logger, log(message) { if (String(message).startsWith('Using staged Tendermint verification:')) fallbackReasons.push(String(message)); } };
  const service = new TendermintClientService(clientLogger, config, lucidService, runner, tree);
  service.computeTxValidityWindow = async (_backdate, ttl = 120000) => {
    const current = await rpc('clock');
    return { currentSlot: current.slot, currentLedgerTime: current.now, validFromTime: current.now, validToTime: current.now + ttl, validToSlot: lucid.unixTimeToSlot(current.now + ttl), slotConfig: clock };
  };
  const replay = async (utxo) => {
    // A fresh query service has no synthetic event or header cache.
    const query = new QueryService(logger, config, lucidService, {}, {
      findUtxosByPolicyIdAndPrefixTokenName: (policy, name) => rpc('history', policy, name),
    }, { fetchTransactionEvidence: (hash) => rpc('evidence', hash) }, {}, {}, tree, {});
    const datum = await clientCodec.decodeClientDatum(utxo.datum, lib);
    const [result] = await query._parseEventClient([{ ...utxo, assetsPolicy: datum.token.policyId, assetsName: datum.token.name }]);
    assert.equal(result.events[0].type, 'update_client');
    const attr = result.events[0].event_attribute.find((a) => a.key === 'header');
    assert(attr?.value, 'Tendermint misbehaviour monitoring requires a recovered header');
    const any = Any.decode(Buffer.from(attr.value, 'hex'));
    return Header.decode(any.value);
  };
  return { service, lucidService, replay, signer, fallbackReasons };
}

async function main() {
  const fixture = await rpc('fixture');
  const report = [];
  const manifest = normalizeHandlerJsonDeploymentConfig(fixture.deployment, { chain_id: 'cardano-cache-test', network_magic: 42, network: 'Custom' }).bridgeManifest;
  await rpc('policyManifest', manifest);
  for (const scenario of fixture.scenarios) {
    // Valid transactions above the engineering fee target must still progress.
    await rpc('referencePrice', scenario.count === 1 ? 75 : 15);
    const { service, lucidService, replay, signer, fallbackReasons } = await runtime(fixture);
    const state = clientDatumMockBuilder.build().state.clientState;
    state.chainId = Buffer.from('cache-test-1').toString('hex');
    state.latestHeight = { revisionNumber: 1n, revisionHeight: 9n };
    state.frozenHeight = { revisionNumber: 0n, revisionHeight: 0n };
    state.trustingPeriod = 1_209_600_000_000_000n;
    state.unbondingPeriod = 1_814_400_000_000_000n;
    state.maxClockDrift = 30_000_000_000n;
    const timestamp = BigInt(scenario.trusted_time);
    const createRequest = { signer,
      client_state: { type_url: '/ibc.lightclients.tendermint.v1.ClientState', value: ClientState.encode(normalizeClientStateFromDatum(state)).finish() },
      consensus_state: { type_url: '/ibc.lightclients.tendermint.v1.ConsensusState', value: ConsensusState.encode({ timestamp: { seconds: timestamp / 1_000_000_000n, nanos: Number(timestamp % 1_000_000_000n) }, root: { hash: new Uint8Array(32) }, next_validators_hash: Buffer.from(scenario.trusted_root, 'hex') }).finish() },
    };
    const created = await service.createClient(createRequest);
    await rpc('signSubmit', Buffer.from(created.unsigned_tx.value).toString(), { type: '/ibc.core.client.v1.MsgCreateClient', value: Buffer.from(MsgCreateClient.encode(createRequest).finish()).toString('hex'), signer, staged: false });
    const unit = lucidService.getClientTokenUnit(created.client_id.split('-').at(-1));
    let current = await lucidService.findUtxoByUnit(unit);
    let datum = await lucidService.decodeDatum(current.datum, 'client');
    assert.equal((await lucidService.resolveValidatorCache(datum.token, current.address)).cache.records.length, 0);
    for (const raw of scenario.headers) {
      const header = Header.fromJSON(raw);
      let transactionCount = 0;
      let fee = 0;
      let rebuild;
      let selectedPath;
      do {
        const request = { client_id: created.client_id, signer, client_message: { type_url: '/ibc.lightclients.tendermint.v1.Header', value: Header.encode(header).finish() } };
        const response = await service.updateClient(request);
        selectedPath = response.unsigned_tx.type_url ? 'staged' : 'direct';
        const envelope = chainResponse(response);
        for (const cbor of envelope.transactions) {
          const accepted = await rpc('signSubmit', cbor, { type: '/ibc.core.client.v1.MsgUpdateClient', value: Buffer.from(MsgUpdateClient.encode(request).finish()).toString('hex'), signer, staged: selectedPath === 'staged' });
          fee += accepted.fee;
          transactionCount++;
        }
        rebuild = envelope.rebuild;
        assert(transactionCount < 100, 'staged update did not finish');
      } while (rebuild);
      current = await lucidService.findUtxoByUnit(unit);
      datum = await lucidService.decodeDatum(current.datum, 'client');
      assert.equal(datum.state.clientState.latestHeight.revisionHeight, header.signed_header.header.height);
      const cache = await lucidService.resolveValidatorCache(datum.token, current.address);
      assert(cache.cache.records.length <= 2);
      assert.equal(cache.cache.records[0].count, scenario.count);
      const replayed = await replay(current);
      assert.deepEqual(replayed.signed_header.header, header.signed_header.header);
      assert.equal(replayed.signed_header.commit.signatures.length, scenario.count);
      const verified = require('node:child_process').spawnSync('go', ['run', '-mod=readonly', '../../tests/tendermint-cache/headers/main.go', '-verify'], {
        cwd: path.resolve('../../cosmos/cardano-probabilistic-light-client-core'), input: JSON.stringify(Header.toJSON(replayed)), encoding: 'utf8',
      });
      assert.equal(verified.status, 0, verified.stderr);
      if (scenario.count >= 100) { assert.equal(selectedPath, 'staged'); assert(transactionCount > 1); }
      else { assert.equal(selectedPath, 'direct'); assert.equal(transactionCount, 1); }
      if (scenario.count === 1) assert(fee > 3_000_000, 'high-reference-price case must exercise an accepted fee above 3 ADA');
      if (scenario.count === 256) assert(fallbackReasons.some((reason) => /budget|memory|units|size/i.test(reason)), '256-validator case must fall back on evaluated transaction capacity');
      report.push({ validators: scenario.count, height: String(header.signed_header.header.height), path: selectedPath, transactionCount, fee, replayedAfterRestart: true });
    }
  }
  process.stdout.write(JSON.stringify({ standardDeployment: true, pairedCreation: true, updates: report }) + '\n');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
