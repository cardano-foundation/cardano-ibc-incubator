import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

// Synthetic devnet keeps this startup check independent of public chain history.
export function smokeManifest() {
  const address = 'addr_test1wr6egzf04zez4y0xcjjuqw96hdw888tw79yp2paqcamdjfgsycyfj';
  let index = 1;
  const validator = () => ({
    script_hash: (index++).toString(16).padStart(56, '0'),
    address,
    ref_utxo: { tx_hash: '11'.repeat(32), output_index: index },
  });
  const validators = Object.fromEntries([
    'host_state_stt', 'spend_client', 'spend_connection', 'spend_channel',
    'spend_transfer_module', 'mint_identifier', 'verify_proof', 'mint_client_stt',
    'mint_connection_stt', 'mint_channel_stt', 'mint_voucher', 'mint_transfer_escrow_shard',
    'mint_port',
  ].map(name => [name, validator()]));
  validators.spend_client.address = 'addr_test1wrl99yd5drce2vh46fhe6ythtj9gqyn2wdetg4l834vc2sccpewa3';
  validators.spend_connection.address = 'addr_test1wpsgc8622dtnh0dkm54syqkk684tlxqhxcsnmht3s96y8ws4cq8qs';
  validators.spend_channel.address = 'addr_test1wqs9dmh4a0l5c4dwddh98yx5gztrx524flvq3mmpmpwzausapd287';
  validators.spend_transfer_module.address = 'addr_test1wz42424242424242424242424242424242424242424242shfdwdy';
  for (const [name, hash] of Object.entries({
    host_state_stt: 'f594092fa8b22a91e6c4a5c038babb5c739d6ef1481507a0c776d925',
    spend_client: 'fe5291b468f19532f5d26f9d11775c8a80126a7372b457e78d598543',
    spend_connection: '608c1f4a53573bbdb6dd2b0202d6d1eabf981736213ddd71817443ba',
    spend_channel: '2056eef5ebff4c55ae6b6e5390d440963351554fd808ef61d85c2ef2',
    spend_transfer_module: 'aa'.repeat(28),
  })) validators[name].script_hash = hash;
  validators.spend_channel.ref_validator = Object.fromEntries([
    'acknowledge_packet', 'chan_close_confirm', 'chan_close_init', 'chan_open_ack',
    'chan_open_confirm', 'recv_packet', 'prune_packet_history', 'send_packet', 'timeout_packet',
    'chan_upgrade', 'chan_upgrade_handshake', 'chan_upgrade_finish',
  ].map(name => [name, validator()]));
  const packet_state = {
    format: 'packet-lanes-v1', receipt_storage: 'merkle-history-v1', lane_count: 16,
    config_token: { policy_id: '77'.repeat(28), token_name: '6962635f7061636b65745f636f6e666967' },
    state: validator(), batch: validator(), guard: validator(),
    operations: Object.fromEntries([
      'send', 'acknowledge', 'timeout', 'reject', 'receive',
      'timeout_on_close', 'retire', 'funds', 'send_funds',
    ].map(name => [name, validator()])),
  };
  const host_state_nft = { policy_id: '22'.repeat(28), token_name: '6962635f686f73745f7374617465' };
  return {
    schema_version: 6,
    consensus_history_format: 'proof-backed-v1',
    migration: { profile: 'cardano-ibc-compatible-v6', registryUnit: 'ab'.repeat(28) + Buffer.from('ibc_implementation_registry').toString('hex'), registryAddress: 'addr_test1wz46h2at4w46h2at4w46h2at4w46h2at4w46h2at4w46h2c8u0yty', generation: '1', compatibility: 'cd'.repeat(32), originalAddresses: ['host_state_stt', 'spend_client', 'spend_connection', 'spend_channel', 'spend_transfer_module'].map(name => validators[name].address) },
    deployment_id: 'cardano-devnet:' + host_state_nft.policy_id + '.' + host_state_nft.token_name,
    deployed_at: '2026-01-01T00:00:00.000Z',
    cardano: { chain_id: 'cardano-devnet', network_magic: 42, network: 'Custom' },
    host_state_nft, validators, packet_state,
    modules: { transfer: { identifier: '33'.repeat(28), address: validators.spend_transfer_module.address } },
  };
}

// Use the application's Plutus encoder so the fixture follows the runtime ABI.
export function smokeRegistryDatum(manifest, { Constr, Data, getAddressDetails }) {
  const record = (...fields) => new Constr(0, fields);
  const address = value => {
    const details = getAddressDetails(value);
    assert.equal(details.type, 'Enterprise');
    assert.equal(details.paymentCredential.type, 'Script');
    return record(new Constr(1, [details.paymentCredential.hash]), new Constr(1, []));
  };
  const governance = record(['66'.repeat(28)], 1n, 86_400_000n);
  const emergency = record(record(['67'.repeat(28)], 1n), 0n, 0n, new Constr(1, []));
  return Data.to(record(
    record(manifest.migration.registryUnit.slice(0, 56), manifest.migration.registryUnit.slice(56)),
    manifest.host_state_nft.policy_id,
    record(...['mint_client_stt', 'mint_connection_stt', 'mint_channel_stt', 'mint_transfer_escrow_shard']
      .map(name => manifest.validators[name].script_hash), address(manifest.migration.registryAddress)),
    governance,
    0n,
    record(BigInt(manifest.migration.generation), manifest.migration.originalAddresses.map(address), manifest.migration.compatibility),
    record(), // Ready
    emergency,
    '68'.repeat(28),
  ));
}

export function protocolParameters(costModels) {
  return {
    version: { major: 11, minor: 0 },
    minFeeCoefficient: 44, minFeeConstant: { ada: { lovelace: 155381 } },
    maxTransactionSize: { bytes: 16384 }, maxValueSize: { bytes: 5000 },
    stakeCredentialDeposit: { ada: { lovelace: 2000000 } },
    stakePoolDeposit: { ada: { lovelace: 500000000 } },
    delegateRepresentativeDeposit: { ada: { lovelace: 500000000 } },
    governanceActionDeposit: { ada: { lovelace: 100000000000 } },
    scriptExecutionPrices: { memory: '577/10000', cpu: '721/10000000' },
    maxExecutionUnitsPerTransaction: { memory: 16500000, cpu: 10000000000 },
    utxoCostPerByte: 4310, collateralPercentage: 150, maxCollateralInputs: 3,
    minFeeReferenceScripts: { base: 15 },
    plutusCostModels: Object.fromEntries(['PlutusV1', 'PlutusV2', 'PlutusV3']
      .map((name, i) => ['plutus:v' + (i + 1), costModels[name]])),
  };
}

export function fixtureHandler(manifest, datum, parameters, registryDatum) {
  assert.ok(registryDatum, 'The governed smoke fixture requires a registry datum');
  const requests = { protocol: 0, timing: 0, references: 0, host: 0, datum: 0, registry: 0, registryDatum: 0, entities: 0, history: 0, unexpected: [] };
  function rpcResponse(rpc) {
    let result;
    if (rpc?.method === 'queryLedgerState/protocolParameters') {
      requests.protocol++;
      result = parameters;
    } else if (rpc?.method === 'queryNetwork/startTime') {
      requests.timing++;
      result = manifest.deployed_at;
    } else if (rpc?.method === 'queryNetwork/genesisConfiguration' && rpc.params?.era === 'shelley') {
      requests.timing++;
      result = { slotLength: { milliseconds: 1000 } };
    }
    return result === undefined ? undefined : { jsonrpc: '2.0', id: rpc.id, result };
  }
  const datumHash = '44'.repeat(32);
  const address = manifest.validators.host_state_stt.address;
  const entityAddresses = new Set(['spend_client', 'spend_connection', 'spend_channel']
    .map(name => manifest.validators[name].address));
  const references = [];
  function collect(value) {
    if (!value || typeof value !== 'object') return;
    if (value.ref_utxo) references.push({
      transaction_id: value.ref_utxo.tx_hash, output_index: value.ref_utxo.output_index,
      address, value: { coins: '2000000', assets: {} }, datum_hash: null, script_hash: null,
    });
    for (const child of Object.values(value)) collect(child);
  }
  collect(manifest.validators);
  collect(manifest.packet_state);
  const nft = manifest.host_state_nft;
  const host = {
    transaction_id: '55'.repeat(32), output_index: 0, address,
    value: { coins: '2000000', assets: { [nft.policy_id + '.' + nft.token_name]: '1' } },
    datum_type: 'inline', datum_hash: datumHash, script_hash: null,
  };
  const registryDatumHash = '99'.repeat(32);
  const registryAsset = manifest.migration.registryUnit.slice(0, 56) + '.' + manifest.migration.registryUnit.slice(56);
  const registry = {
    transaction_id: 'aa'.repeat(32), output_index: 0, address: manifest.migration.registryAddress,
    value: { coins: '10000000', assets: { [registryAsset]: '1' } },
    datum_type: 'inline', datum_hash: registryDatumHash, script_hash: null,
  };
  const handler = async (request, response) => {
    const url = new URL(request.url, 'http://fixture');
    let value;
    if (request.method === 'GET' && url.pathname === '/__smoke/status') {
      value = requests;
    } else if (request.method === 'GET' && url.pathname === '/api/v1/blocks/latest') {
      requests.history++;
      value = {
        number: 1, hash: '88'.repeat(32), previous_block: '00'.repeat(32),
        slot: 1, epoch: 0, time: 1767225601, slot_leader: 'pool1smoke', tx_count: 0,
      };
    } else if (request.method === 'POST' && url.pathname === '/') {
      let body = '';
      for await (const chunk of request) {
        body += chunk;
        if (body.length > 65536) break;
      }
      let rpc;
      try { rpc = JSON.parse(body); } catch { /* Rejected below. */ }
      value = rpcResponse(rpc);
    } else if (request.method === 'GET' && ['?unspent', '?unspent&resolve_hashes'].includes(url.search)) {
      if (url.pathname === '/matches/' + registryAsset || url.pathname === '/matches/' + manifest.migration.registryAddress) {
        requests.registry++;
        value = [registry];
      } else if (url.pathname === '/matches/' + nft.policy_id + '.' + nft.token_name ||
          url.pathname === '/matches/' + address) {
        requests.host++;
        value = [host];
      } else if (url.pathname.startsWith('/matches/*@')) {
        const txHash = url.pathname.slice('/matches/*@'.length);
        value = references.filter(ref => ref.transaction_id === txHash);
        if (value.length) requests.references++;
        else value = undefined;
      } else if (entityAddresses.has(url.pathname.slice('/matches/'.length)) && url.pathname.startsWith('/matches/')) {
        requests.entities++;
        value = [];
      }
    } else if (request.method === 'GET' && url.pathname === '/datums/' + registryDatumHash && url.search === '?inline') {
      requests.registryDatum++;
      value = { datum: registryDatum };
    } else if (request.method === 'GET' && url.pathname === '/datums/' + datumHash && url.search === '?inline') {
      requests.datum++;
      value = { datum };
    }
    if (value === undefined) {
      requests.unexpected.push(request.method + ' ' + request.url);
      response.writeHead(501);
      response.end('Unexpected smoke fixture request');
      return;
    }
    if (url.search === '?unspent&resolve_hashes' && Array.isArray(value)) {
      value = value.map(utxo => {
        if (utxo.datum_hash === registryDatumHash) requests.registryDatum++;
        return { ...utxo, transaction_index: 0, created_at: { slot_no: 1, header_hash: '88'.repeat(32) },
          spent_at: null, script: null,
          datum: utxo.datum_hash === registryDatumHash ? registryDatum : utxo.datum_hash === datumHash ? datum : null };
      });
    }
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify(value));
  };
  handler.websocketMessage = message => {
    let rpc;
    try { rpc = JSON.parse(message.toString()); } catch { /* Rejected below. */ }
    const value = rpcResponse(rpc);
    if (value === undefined) requests.unexpected.push('WS ' + message);
    return value;
  };
  return handler;
}

async function main() {
  // Resolve through the shipped application, not host-side dependencies.
  const require = createRequire('/usr/src/app/package.json');
  const lucid = await import(pathToFileURL(require.resolve('@lucid-evolution/lucid')));
  const { encodeHostStateDatum } = require('/usr/src/app/dist/shared/types/host-state-datum.js');
  const { normalizeBridgeManifestConfig } = require('/usr/src/app/dist/config/bridge-manifest.js');
  assert.ok(JSON.parse(await readFile('/usr/src/app/manifests/preview/cardano-preview-bridge-manifest.json')));
  const manifest = smokeManifest();
  normalizeBridgeManifestConfig(manifest);
  await writeFile('/tmp/image-smoke-manifest.json', JSON.stringify(manifest));
  const datum = await encodeHostStateDatum({
    state: { version: 0n, ibc_state_root: '00'.repeat(32), next_client_sequence: 0n,
      next_connection_sequence: 0n, next_channel_sequence: 0n, bound_port: [], last_update_time: 0n },
    nft_policy: manifest.host_state_nft.policy_id, deployer: '66'.repeat(28),
    control: { port_registry: new Map(), shutdown: 'Active',
      live_clients: 0n, live_connections: 0n, live_channels: 0n, last_heartbeat_time: 0n },
  }, lucid);
  const handler = fixtureHandler(manifest, datum, protocolParameters(lucid.PROTOCOL_PARAMETERS_DEFAULT.costModels), smokeRegistryDatum(manifest, lucid));
  const server = createServer(handler);
  const { WebSocketServer } = require('ws');
  new WebSocketServer({ server }).on('connection', socket => {
    socket.on('message', message => {
      const value = handler.websocketMessage(message);
      if (value === undefined) socket.close(1008, 'Unexpected smoke fixture request');
      else socket.send(JSON.stringify(value));
    });
  });
  server.listen(8080, '0.0.0.0', () => console.log('Gateway smoke fixtures ready'));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
