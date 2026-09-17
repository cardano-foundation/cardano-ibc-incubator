#!/usr/bin/env node
/** Bind a rehearsal packet to actual canonical channel inputs/outputs.
 * The event log is only a candidate; independent ICS-04 commitment arithmetic
 * and the exact state NFT identify the accepted channel transition.
 */
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '../..');
const req = createRequire(path.join(root, 'cardano/gateway/package.json'));
const CML = req('@dcspark/cardano-multiplatform-lib-nodejs');
const { Client } = req('pg');
const { decodeChannelDatum } = req('./dist/shared/types/channel/channel-datum.js');
const { decodeSpendChannelRedeemer } = req('./dist/shared/types/channel/channel-redeemer.js');
const { MiniProtocalsService } = req('./dist/shared/modules/mini-protocals/mini-protocals.service.js');
const requireThat = (value, message) => { if (!value) throw new Error(message); };
const sha = (bytes, algorithm = 'sha256') => createHash(algorithm).update(bytes).digest();
const equal = (a, b) => JSON.stringify(a, (_, v) => typeof v === 'bigint' ? v.toString() : v instanceof Map ? [...v] : v) ===
  JSON.stringify(b, (_, v) => typeof v === 'bigint' ? v.toString() : v instanceof Map ? [...v] : v);
const u64 = value => { const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(value)); return b; };
function commitment(packet) {
  return sha(Buffer.concat([u64(packet.timeoutNanoseconds), u64(packet.timeout_height.revision_number),
    u64(packet.timeout_height.revision_height), sha(Buffer.from(packet.data, 'hex'))])).toString('hex');
}
function channelUnit(manifest, channel) {
  requireThat(/^channel-\d+$/.test(channel), 'Channel identity');
  const host = manifest.host_state_nft;
  const name = sha(Buffer.from(host.policy_id + host.token_name, 'hex'), 'sha3-256').toString('hex').slice(0, 40) +
    sha(Buffer.from('channel'), 'sha3-256').toString('hex').slice(0, 8) + Buffer.from(channel.slice(8)).toString('hex');
  return manifest.validators.mint_channel_stt.script_hash + name;
}
async function json(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`Canonical query failed ${response.status}: ${url}`);
  return response.json();
}
async function datum(output, lucid) {
  const raw = await json(`http://127.0.0.1:2742/datums/${output.datum_hash}`);
  requireThat(typeof raw.datum === 'string', 'Missing channel datum');
  return decodeChannelDatum(raw.datum, lucid);
}
function tokenQuantity(output, unit) {
  const assets = output.amount().multi_asset();
  return assets.get(CML.ScriptHash.from_hex(unit.slice(0, 56)), CML.AssetName.from_hex(unit.slice(56))) ?? 0n;
}
function verifyTransition(before, after, packet, kind) {
  requireThat(equal(before.token, after.token) && before.port === after.port &&
    equal(before.state.channel, after.state.channel), 'Channel identity changed');
  const a = before.state, b = after.state, sequence = BigInt(packet.sequence), digest = commitment(packet);
  const expected = { ...a, packet_commitment: new Map(a.packet_commitment), packet_receipt: new Map(a.packet_receipt),
    packet_acknowledgement: new Map(a.packet_acknowledgement) };
  if (kind === 'SendPacket') {
    requireThat(a.next_sequence_send === sequence && !a.packet_commitment.has(sequence), 'Wrong send sequence');
    expected.next_sequence_send += 1n;
    expected.packet_commitment.set(sequence, digest);
  } else if (kind === 'WriteAcknowledgement') {
    requireThat(!a.packet_receipt.has(sequence) && !a.packet_acknowledgement.has(sequence), 'Duplicate receive');
    expected.packet_receipt.set(sequence, '');
    expected.packet_acknowledgement.set(sequence, sha(Buffer.from('{"result":"AQ=="}')).toString('hex'));
    // Proof-height bounds are validated by the real receive validator. This
    // observer checks packet maps independently, without guessing proof height.
    expected.minimum_receive_proof_height = b.minimum_receive_proof_height;
    expected.maximum_receive_proof_height = b.maximum_receive_proof_height;
  } else if (kind === 'AcknowledgePacket' || kind === 'TimeoutPacket') {
    requireThat(a.packet_commitment.get(sequence) === digest, 'Missing exact original packet obligation');
    expected.packet_commitment.delete(sequence);
  } else throw new Error('Unsupported packet operation');
  const normalize = state => ({ ...state,
    packet_commitment: [...state.packet_commitment].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0),
    packet_receipt: [...state.packet_receipt].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0),
    packet_acknowledgement: [...state.packet_acknowledgement].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0) });
  requireThat(equal(normalize(expected), normalize(b)), 'Unexpected packet maps/sequences or changed unrelated obligations');
}
function verifyRedeemer(decoded, packet, kind) {
  const constructor = kind === 'WriteAcknowledgement' ? 'RecvPacket' : kind;
  requireThat(typeof decoded === 'object' && Object.keys(decoded).length === 1 && decoded[constructor],
    'Canonical channel redeemer has another operation');
  const actual = decoded[constructor].packet;
  const expected = {
    sequence: BigInt(packet.sequence), source_port: Buffer.from(packet.source_port).toString('hex'),
    source_channel: Buffer.from(packet.source_channel).toString('hex'),
    destination_port: Buffer.from(packet.destination_port).toString('hex'),
    destination_channel: Buffer.from(packet.destination_channel).toString('hex'), data: packet.data.toLowerCase(),
    timeout_height: { revisionNumber: BigInt(packet.timeout_height.revision_number), revisionHeight: BigInt(packet.timeout_height.revision_height) },
    timeout_timestamp: BigInt(packet.timeoutNanoseconds),
  };
  requireThat(equal(actual, expected), 'Canonical channel redeemer contains another packet');
  if (kind === 'AcknowledgePacket') requireThat(decoded[constructor].acknowledgement ===
    Buffer.from('{"result":"AQ=="}').toString('hex'), 'Canonical acknowledgement is not success');
}
async function main() {
  const request = JSON.parse(fs.readFileSync(0, 'utf8'));
  const manifestPath = fs.realpathSync(request.manifest);
  requireThat(manifestPath.startsWith(path.join(root, '.deployment-smoke') + path.sep), 'Owned manifest required');
  const manifest = JSON.parse(fs.readFileSync(manifestPath));
  if (request.mode === 'chain-time') {
    const grpc = req('@grpc/grpc-js'), loader = req('@grpc/proto-loader');
    const protoRoot = path.join(root, 'proto-types/protos/ibc-go');
    const definition = loader.loadSync(['ibc/core/client/v1/query.proto', 'ibc/core/types/v1/query.proto']
      .map(file => path.join(protoRoot, file)), { keepCase: true, longs: String, enums: String, includeDirs: [protoRoot] });
    const ibc = grpc.loadPackageDefinition(definition).ibc;
    const client = new ibc.core.client.v1.Query('127.0.0.1:5501', grpc.credentials.createInsecure());
    const types = new ibc.core.types.v1.Query('127.0.0.1:5501', grpc.credentials.createInsecure(),
      { 'grpc.max_receive_message_length': 64 * 1024 * 1024 });
    const call = (c, method, input) => new Promise((resolve, reject) =>
      c[method](input, { deadline: Date.now() + 60000 }, (error, response) => error ? reject(error) : resolve(response)));
    try {
      const latest = await call(client, 'LatestHeight', {});
      const response = await call(types, 'IBCHeader', { trusted_height: (BigInt(latest.height) - 1n).toString(), height: latest.height });
      requireThat(response.header.type_url === '/ibc.lightclients.probabilistic.v1.ProbabilisticHeader', 'Unsupported destination header');
      const { ProbabilisticHeader } = req('@cardano-ibc/proto-types/build/ibc/lightclients/probabilistic/v1/probabilistic');
      const header = ProbabilisticHeader.decode(response.header.value), anchor = header.anchor_block;
      requireThat(anchor && anchor.height.revision_height === BigInt(latest.height), 'Destination status height mismatch');
      console.log(JSON.stringify({ chain: 'cardano-devnet', height: latest.height, hash: anchor.hash, timestampNs: anchor.timestamp.toString() }));
    } finally { client.close(); types.close(); }
    return;
  }
  const lucid = await import(req.resolve('@lucid-evolution/lucid'));
  const unit = channelUnit(manifest, request.channel);
  if (request.mode === 'route') {
    const outputs = await json(`http://127.0.0.1:2742/matches/${unit.slice(0, 56)}.${unit.slice(56)}?unspent`);
    requireThat(outputs.length === 1 && outputs[0].value.assets[unit.slice(0, 56) + '.' + unit.slice(56)] === 1,
      'Unique live channel NFT required');
    requireThat(outputs[0].address === manifest.validators.spend_channel.address, 'Current channel implementation mismatch');
    const decoded = await datum(outputs[0], lucid);
    requireThat(decoded.token.policyId + decoded.token.name === unit && decoded.port === Buffer.from('transfer').toString('hex'), 'Authenticated channel identity');
    requireThat(decoded.state.channel.state === 'Open' && decoded.state.channel.ordering === 'Unordered', 'Only open unordered routes supported');
    console.log(JSON.stringify({ unit, channel: request.channel, counterparty: decoded.state.channel.counterparty,
      connectionHops: decoded.state.channel.connection_hops }));
    return;
  }
  requireThat(request.mode === 'packet' && /^[0-9a-f]{64}$/.test(request.transaction), 'Packet transaction identity');
  const db = new Client({ host: '127.0.0.1', port: 27432, database: 'migration_yaci', user: 'postgres' });
  await db.connect();
  try {
    const query = 'SELECT t.tx_index,t.block,t.block_hash,b.slot FROM transaction t JOIN block b ON b.number=t.block AND b.hash=t.block_hash WHERE t.tx_hash=$1 AND t.invalid=false';
    async function body(hash) {
      const rows = (await db.query(query, [hash])).rows;
      requireThat(rows.length === 1, 'Unique canonical valid transaction required');
      const inclusion = rows[0];
      const logger = { log() {}, warn() {}, error() {}, debug() {} };
      const fetcher = new MiniProtocalsService({}, { get: k => k === 'yaciStoreEndpoint' ? 'http://127.0.0.1:29083' : undefined }, logger);
      const bytes = await fetcher.fetchBlockCbor({ hash: inclusion.block_hash, slotNo: BigInt(inclusion.slot) });
      const block = require('./authenticate-migration-block.cjs').authenticateBlock(bytes, inclusion.block_hash);
      const index = Number(inclusion.tx_index);
      requireThat(Number.isSafeInteger(index) && index >= 0 && !block.invalid_transactions().includes(index), 'Invalid transaction');
      const tx = block.transaction_bodies().get(index);
      requireThat(CML.hash_transaction(tx).to_hex() === hash, 'Canonical transaction hash mismatch');
      return { tx, inclusion, witnesses: block.transaction_witness_sets().get(index) };
    }
    const { tx, inclusion, witnesses } = await body(request.transaction);
    const outputs = [];
    for (let i = 0; i < tx.outputs().len(); i++) {
      const output = tx.outputs().get(i);
      if (tokenQuantity(output, unit) !== 0n) outputs.push({ output, index: i });
    }
    // Ordinary client/checkpoint transactions are explicitly distinguished from
    // a rejected candidate packet transition; the caller still needs ONE match.
    if (!outputs.length) { console.log(JSON.stringify({ packetTransition: false })); return; }
    requireThat(outputs.length === 1 && tokenQuantity(outputs[0].output, unit) === 1n, 'Duplicated channel continuation');
    const inputs = [];
    for (let i = 0; i < tx.inputs().len(); i++) {
      const input = tx.inputs().get(i), hash = input.transaction_id().to_hex();
      const candidates = await json(`http://127.0.0.1:2742/matches/${input.index()}@${hash}`);
      if (candidates.some(o => o.value.assets[unit.slice(0, 56) + '.' + unit.slice(56)])) {
        const source = (await body(hash)).tx.outputs().get(Number(input.index()));
        requireThat(tokenQuantity(source, unit) === 1n, 'Forged channel input');
        inputs.push({ output: source, hash, index: input.index().toString() });
      }
    }
    requireThat(inputs.length === 1, 'Unique consumed channel input required');
    const orderedInputs = [];
    for (let i = 0; i < tx.inputs().len(); i++) {
      const input = tx.inputs().get(i);
      orderedInputs.push({ hash: input.transaction_id().to_hex(), index: input.index() });
    }
    orderedInputs.sort((a, b) => a.hash.localeCompare(b.hash) || (a.index < b.index ? -1 : a.index > b.index ? 1 : 0));
    const pointer = orderedInputs.findIndex(ref => ref.hash === inputs[0].hash && ref.index.toString() === inputs[0].index);
    const redeemers = witnesses.redeemers();
    requireThat(redeemers, 'Canonical spending redeemer missing');
    let raw;
    const map = redeemers.as_map_redeemer_key_to_redeemer_val(), array = redeemers.as_arr_legacy_redeemer();
    if (map) {
      const keys = map.keys();
      for (let i = 0; i < keys.len(); i++) {
        const key = keys.get(i);
        if (key.tag() === 0 && key.index() === BigInt(pointer)) raw = map.get(key).data();
      }
    } else if (array) {
      for (let i = 0; i < array.len(); i++) {
        const value = array.get(i);
        if (value.tag() === 0 && value.index() === BigInt(pointer)) raw = value.data();
      }
    }
    requireThat(raw, 'Canonical channel spending redeemer missing');
    verifyRedeemer(decodeSpendChannelRedeemer(raw.to_cbor_hex(), lucid), request.packet, request.kind);
    const source = inputs[0].output, destination = outputs[0].output;
    requireThat(source.address().to_bech32() === manifest.validators.spend_channel.address &&
      destination.address().to_bech32() === source.address().to_bech32(), 'Unexpected channel implementation');
    const before = await decodeChannelDatum(source.datum().as_datum().to_cbor_hex(), lucid);
    const after = await decodeChannelDatum(destination.datum().as_datum().to_cbor_hex(), lucid);
    requireThat(before.token.policyId + before.token.name === unit, 'Datum token identity');
    verifyTransition(before, after, request.packet, request.kind);
    requireThat(equal((await db.query(query, [request.transaction])).rows, [inclusion]), 'Canonical inclusion changed');
    console.log(JSON.stringify({ packetTransition: true, unit, transaction: request.transaction, inclusion,
      input: { hash: inputs[0].hash, index: inputs[0].index }, outputIndex: outputs[0].index,
      commitment: commitment(request.packet) }));
  } finally { await db.end(); }
}
module.exports = { verifyTransition, verifyRedeemer, commitment, channelUnit };
if (require.main === module) main().catch(error => { console.error(error.stack); process.exitCode = 1; });
