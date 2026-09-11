import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

// This is a synthetic empty deployment, not a claim about preprod chain state.
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
  validators.spend_channel.ref_validator = Object.fromEntries([
    'acknowledge_packet', 'chan_close_confirm', 'chan_close_init', 'chan_open_ack',
    'chan_open_confirm', 'recv_packet', 'prune_packet_history', 'send_packet', 'timeout_packet',
  ].map(name => [name, validator()]));
  const host_state_nft = { policy_id: '22'.repeat(28), token_name: '6962635f686f73745f7374617465' };
  return {
    schema_version: 4,
    deployment_id: 'cardano-preprod:' + host_state_nft.policy_id + '.' + host_state_nft.token_name,
    deployed_at: '2026-01-01T00:00:00.000Z',
    cardano: { chain_id: 'cardano-preprod', network_magic: 1, network: 'preprod' },
    host_state_nft, validators,
    modules: { transfer: { identifier: '33'.repeat(28), address } },
  };
}

export function protocolParameters(costModels) {
  return {
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

export function fixtureHandler(manifest, datum, parameters) {
  const requests = { protocol: 0, references: 0, host: 0, datum: 0, entities: 0, unexpected: [] };
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
  const nft = manifest.host_state_nft;
  const host = {
    transaction_id: '55'.repeat(32), output_index: 0, address,
    value: { coins: '2000000', assets: { [nft.policy_id + '.' + nft.token_name]: '1' } },
    datum_type: 'inline', datum_hash: datumHash, script_hash: null,
  };
  return async (request, response) => {
    const url = new URL(request.url, 'http://fixture');
    let value;
    if (request.method === 'GET' && url.pathname === '/__smoke/status') {
      value = requests;
    } else if (request.method === 'POST' && url.pathname === '/') {
      let body = '';
      for await (const chunk of request) {
        body += chunk;
        if (body.length > 65536) break;
      }
      let rpc;
      try { rpc = JSON.parse(body); } catch { /* Rejected below. */ }
      if (rpc?.method === 'queryLedgerState/protocolParameters') {
        requests.protocol++;
        value = { jsonrpc: '2.0', id: rpc.id, result: parameters };
      }
    } else if (request.method === 'GET' && url.search === '?unspent') {
      if (url.pathname === '/matches/' + nft.policy_id + '.' + nft.token_name ||
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
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify(value));
  };
}

async function main() {
  // Resolve through the shipped application, not host-side dependencies.
  const require = createRequire('/usr/src/app/package.json');
  const lucid = await import(pathToFileURL(require.resolve('@lucid-evolution/lucid')));
  const { encodeHostStateDatum } = require('/usr/src/app/dist/shared/types/host-state-datum.js');
  const { normalizeBridgeManifestConfig } = require('/usr/src/app/dist/config/bridge-manifest.js');
  assert.ok(JSON.parse(await readFile('/usr/src/app/manifests/preprod/cardano-preprod-bridge-manifest.json')));
  const manifest = smokeManifest();
  normalizeBridgeManifestConfig(manifest);
  await writeFile('/tmp/image-smoke-manifest.json', JSON.stringify(manifest));
  const datum = await encodeHostStateDatum({
    state: { version: 0n, ibc_state_root: '00'.repeat(32), next_client_sequence: 0n,
      next_connection_sequence: 0n, next_channel_sequence: 0n, bound_port: [], last_update_time: 0n },
    nft_policy: manifest.host_state_nft.policy_id, deployer: '66'.repeat(28),
    control: { port_registry: new Map(), shutdown: 'Active' },
  }, lucid);
  createServer(fixtureHandler(manifest, datum, protocolParameters(lucid.PROTOCOL_PARAMETERS_DEFAULT.costModels)))
    .listen(8080, '0.0.0.0', () => console.log('Gateway smoke fixtures ready'));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
