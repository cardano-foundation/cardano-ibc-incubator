// Read-only, quiescent observations of the actual packet-lane deployment.
// Successful ledger operations provide script validation. These observations
// independently check packet roots, custody and the complete live inventory.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { pathToFileURL } = require('node:url');
const { ownedRuntimeProviders } = require('./owned-runtime-providers.cjs');
const { channelUnit } = require('./verify-migration-packet.cjs');
const { laneRoot } = require('./verify-migration-lanes.cjs');
const { parseExactJson } = require('./rehearsal-json.cjs');
const root = path.resolve(__dirname, '../../..');
const req = createRequire(path.join(root, 'cardano/gateway/package.json'));
const text = value => Buffer.from(value, 'hex').toString('utf8');
const ref = output => `${output.transaction_id}#${output.output_index}`;
const encode = value => JSON.stringify(value, (_, item) =>
  typeof item === 'bigint' ? item.toString() : item instanceof Map ? [...item] : item);

function assertUnchangedPackets(before, after) {
  assert.equal(before.genesisSha256, after.genesisSha256);
  assert.equal(before.deploymentId, after.deploymentId);
  assert.deepEqual(after.packetState, before.packetState,
    'Upgrade changed packet accounting, backing or an unsent funded intent');
}

function assertCutover(before, after, channel, connection, client) {
  assertUnchangedPackets(before, after);
  const original = before.channels.find(item => item.id === channel);
  const current = after.channels.find(item => item.id === channel);
  assert.ok(original && current, 'Channel inventory is incomplete');
  assert.deepEqual(current.datum.token, original.datum.token);
  assert.equal(current.datum.port, original.datum.port);
  for (const field of ['ordering', 'counterparty', 'version']) {
    assert.deepEqual(current.datum.state.channel[field], original.datum.state.channel[field], `Channel ${field} changed`);
  }
  assert.equal(current.datum.state.channel.state, 'Open');
  assert.deepEqual(current.datum.state.channel.connection_hops, [Buffer.from(connection).toString('hex')]);
  assert.equal(current.connection.clientId, client);
  assert.equal(current.connection.state, 3);
  assert.equal(BigInt(current.datum.state.channel.upgrade_sequence), BigInt(original.datum.state.channel.upgrade_sequence) + 1n);
  assert.equal(current.datum.state.upgrade.pending, null);
  assert.equal(current.counterparty.channel.state, 'STATE_OPEN');
  assert.deepEqual(current.counterparty.channel.counterparty, { port_id: 'transfer', channel_id: channel });
  assert.deepEqual(current.counterparty.channel.connection_hops, [current.connection.counterpartyConnection]);
  assert.equal(current.counterparty.connection.client_id, current.connection.counterpartyClient);
  assert.equal(current.counterparty.connection.state, 'STATE_OPEN');
  assert.equal(current.counterparty.connection.counterparty.client_id, client);
  assert.equal(current.counterparty.connection.counterparty.connection_id, connection);
}

async function main() {
  const runtime = fs.realpathSync(process.argv[2]);
  const providers = ownedRuntimeProviders(runtime, true);
  const manifest = JSON.parse(fs.readFileSync(path.join(runtime, 'hermes-bridge-manifest.json')));
  assert.equal(manifest.schema_version, 6);
  assert.equal(manifest.cardano.network_magic, 42);
  assert.ok(manifest.packet_state, 'Packet-lane deployment required');
  const Lucid = await import(pathToFileURL(req.resolve('@lucid-evolution/lucid')).href);
  const { decodeChannelDatum } = req('@cardano-ibc/tx-builder-runtime/channelDatum');
  const { packetLaneTokenName, sendSequencerTokenName, liquidityTokenName } = req('@cardano-ibc/tx-builder/dist/packet-lanes');
  const config = manifest.packet_state;
  async function json(url, height) {
    const response = await fetch(url, { signal: AbortSignal.timeout(30000),
      headers: height ? { 'x-cosmos-block-height': height } : {} });
    assert.ok(response.ok, `Owned query failed: ${url} ${response.status}`);
    if (height) assert.equal(response.headers.get('x-cosmos-block-height') ??
      response.headers.get('grpc-metadata-x-cosmos-block-height'), height, 'Counterparty ignored snapshot height');
    return parseExactJson(await response.text());
  }
  const observed = [];
  const unitKey = unit => unit.slice(0, 56) + '.' + unit.slice(56);
  async function inventory(address) {
    const outputs = await json(`http://${providers.kupo}/matches/${address}?unspent`);
    assert.ok(Array.isArray(outputs), 'Unavailable output inventory');
    return outputs.sort((a, b) => ref(a).localeCompare(ref(b)));
  }
  async function datum(output) {
    assert.ok(output.datum_hash, 'Missing inline datum');
    const { datum: cbor } = await json(`http://${providers.kupo}/datums/${output.datum_hash}`);
    assert.match(cbor, /^[0-9a-f]+$/);
    return { output, cbor, raw: Lucid.Data.from(cbor) };
  }
  async function unique(unit, address) {
    const outputs = await json(`http://${providers.kupo}/matches/${unitKey(unit)}?unspent`);
    assert.equal(outputs.length, 1, `Unique state NFT required: ${unit}`);
    const output = outputs[0];
    assert.equal(output.value.assets[unitKey(unit)], 1);
    assert.equal(output.address, address, 'State implementation differs from the pinned deployment');
    observed.push({ unit, output });
    return datum(output);
  }
  function record(output, cbor) {
    return { outref: ref(output), address: output.address, assets: output.value, datum: cbor, createdAt: output.created_at };
  }
  const host = await unique(manifest.host_state_nft.policy_id + manifest.host_state_nft.token_name,
    manifest.validators.host_state_stt.address);
  assert.equal(host.raw.fields.length, 4);
  assert.equal(host.raw.fields[0].fields.length, 7);
  assert.equal(host.raw.fields[1], manifest.host_state_nft.policy_id);
  const count = Number(host.raw.fields[0].fields[4]);
  assert.ok(Number.isSafeInteger(count) && count > 0 && count <= 64, 'Unsupported channel inventory bound');
  const cosmosBlock = await json('http://127.0.0.1:1527/cosmos/base/tendermint/v1beta1/blocks/latest');
  assert.equal(cosmosBlock.block.header.chain_id, 'migration-462-1');
  const cosmosHeight = cosmosBlock.block.header.height;
  const cosmos = suffix => json(`http://127.0.0.1:1527/${suffix}`, cosmosHeight);
  const channels = [];
  for (let index = 0; index < count; index++) {
    const id = `channel-${index}`;
    const output = await unique(channelUnit(manifest, id), manifest.validators.spend_channel.address);
    const decoded = await decodeChannelDatum(output.cbor, Lucid);
    assert.equal(decoded.token.policyId + decoded.token.name, channelUnit(manifest, id));
    assert.equal(decoded.port, Buffer.from('transfer').toString('hex'));
    assert.equal(decoded.state.channel.connection_hops.length, 1);
    const connectionId = text(decoded.state.channel.connection_hops[0]);
    const connectionName = Buffer.from(connectionId.slice('connection-'.length)).toString('hex');
    const hostIdentity = manifest.host_state_nft;
    const { createHash } = require('node:crypto');
    const sha3 = bytes => createHash('sha3-256').update(bytes).digest('hex');
    const connectionUnit = manifest.validators.mint_connection_stt.script_hash +
      sha3(Buffer.from(hostIdentity.policy_id + hostIdentity.token_name, 'hex')).slice(0, 40) +
      sha3(Buffer.from('connection')).slice(0, 8) + connectionName;
    const connection = await unique(connectionUnit, manifest.validators.spend_connection.address);
    const fields = connection.raw.fields[0].fields;
    assert.equal(connection.raw.fields[1].fields.join(''), connectionUnit);
    // ConnectionEnd: client_id, versions, state, counterparty, delay_period.
    assert.equal(fields.length, 5);
    const remote = fields[3].fields;
    const route = { id: connectionId, state: fields[2].index, clientId: text(fields[0]), counterpartyClient: text(remote[0]),
      counterpartyConnection: text(remote[1]) };
    const remoteChannel = text(decoded.state.channel.counterparty.channel_id);
    const counterpart = await cosmos(`ibc/core/channel/v1/channels/${remoteChannel}/ports/transfer`);
    assert.equal(counterpart.channel.connection_hops.length, 1);
    const counterConnection = await cosmos(`ibc/core/connection/v1/connections/${counterpart.channel.connection_hops[0]}`);
    const escrow = await cosmos(`ibc/apps/transfer/v1/channels/${remoteChannel}/ports/transfer/escrow_address`);
    const escrowBalances = await cosmos(`cosmos/bank/v1beta1/balances/${escrow.escrow_address}?pagination.limit=1000`);
    assert.ok(!escrowBalances.pagination?.next_key);
    channels.push({ id, unit: channelUnit(manifest, id), ...record(output.output, output.cbor), datumCbor: output.cbor, datum: decoded,
      connection: route, counterparty: { id: remoteChannel, channel: counterpart.channel,
        connection: counterConnection.connection, escrowAddress: escrow.escrow_address, escrowBalances: escrowBalances.balances } });
  }
  const guard = await inventory(config.guard.address), liquidity = await inventory(config.batch.address);
  const lanes = [], sequencers = [], intents = [], backing = [];
  for (const output of guard) {
    const { raw, cbor } = await datum(output);
    assert.equal(raw.index, 0);
    const fields = raw.fields, port = text(fields[0]), channel = text(fields[1]);
    assert.equal(port, 'transfer');
    assert.ok(channels.some(item => item.id === channel), 'Unknown packet channel');
    const tokens = Object.keys(output.value.assets).filter(unit => unit.startsWith(config.state.script_hash + '.'));
    if (fields.length === 12) {
      const lane = Number(fields[2]);
      const unit = config.state.script_hash + packetLaneTokenName(port, channel, lane, config.lane_count);
      assert.deepEqual(tokens, [unitKey(unit)]);
      assert.equal(output.value.assets[tokens[0]], 1);
      assert.equal(fields[3], BigInt(config.lane_count));
      assert.equal(fields[5], laneRoot(raw), 'Live lane commitment root differs from its packet inventory');
      lanes.push({ channel, lane, unit, ...record(output, cbor), fields });
    } else if (fields.length === 4) {
      const unit = config.state.script_hash + sendSequencerTokenName(port, channel);
      assert.deepEqual(tokens, [unitKey(unit)]);
      assert.equal(output.value.assets[tokens[0]], 1);
      sequencers.push({ channel, unit, ...record(output, cbor), fields });
    } else {
      assert.equal(fields.length, 5, 'Unknown guard output');
      assert.equal(tokens.length, 0, 'Intent owns a packet-state token');
      intents.push({ channel, ...record(output, cbor), fields });
    }
  }
  for (const channel of channels) {
    assert.deepEqual(lanes.filter(item => item.channel === channel.id).map(item => item.lane).sort((a, b) => a - b),
      Array.from({ length: config.lane_count }, (_, index) => index), 'Incomplete or duplicate packet lanes');
    assert.equal(sequencers.filter(item => item.channel === channel.id).length, 1);
  }
  for (const output of liquidity) {
    const { raw, cbor } = await datum(output);
    assert.equal(raw.index, 0);
    assert.equal(raw.fields.length, 8, 'Unknown backing output');
    const fields = raw.fields, port = text(fields[0]), channel = text(fields[1]), denom = text(fields[2]);
    assert.equal(port, 'transfer');
    assert.ok(channels.some(item => item.id === channel));
    const unit = config.batch.script_hash + liquidityTokenName(port, channel, denom, fields[5].fields[0], Number(fields[5].fields[1]));
    const tokens = Object.keys(output.value.assets).filter(key => key.startsWith(config.batch.script_hash + '.'));
    assert.deepEqual(tokens, [unitKey(unit)]);
    assert.equal(output.value.assets[tokens[0]], 1);
    const asset = fields[3] + fields[4];
    assert.equal(denom, asset || Buffer.from('lovelace').toString('hex'), 'Backing asset identity differs from its denomination');
    const quantity = asset ? output.value.assets[unitKey(asset)] ?? 0 : output.value.coins;
    assert.ok(BigInt(quantity) >= fields[6] && fields[6] >= 0n, 'Backing amount exceeds actual custody');
    if (asset) assert.equal(BigInt(quantity), fields[6]);
    backing.push({ channel, denom, unit, asset, amount: fields[6], ...record(output, cbor) });
  }
  const wallets = [];
  const population = JSON.parse(fs.readFileSync(path.join(runtime, 'wallet-population.json')));
  for (const address of [population.primary, population.secondary]) {
    const outputs = await inventory(address);
    wallets.push({ address, outputs });
  }
  const remoteWallet = await cosmos('cosmos/bank/v1beta1/balances/cosmos1rnr5jrt4exl0samwj0yegv99jeskl0hsge5zwt?pagination.limit=1000');
  assert.ok(!remoteWallet.pagination?.next_key);
  for (const { unit, output } of observed) {
    const now = await json(`http://${providers.kupo}/matches/${unitKey(unit)}?unspent`);
    assert.equal(encode(now), encode([output]), 'State changed during observation');
  }
  assert.deepEqual(await inventory(config.guard.address), guard, 'Packet state changed during observation');
  assert.deepEqual(await inventory(config.batch.address), liquidity, 'Backing changed during observation');
  for (const wallet of wallets) assert.deepEqual(await inventory(wallet.address), wallet.outputs, 'Wallet changed during observation');
  console.log(encode({ format: 'channel-migration-observation-v1', genesisSha256: providers.genesisSha256,
    deploymentId: manifest.deployment_id, host: record(host.output, host.cbor), channels,
    packetState: { lanes, sequencers, intents, backing }, wallets,
    counterparty: { height: cosmosHeight, block: cosmosBlock.block_id, balances: remoteWallet.balances } }));
}

module.exports = { assertUnchangedPackets, assertCutover };
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
