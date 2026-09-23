#!/usr/bin/env node
/* Disposable devnet index repair. Yaci 2.0.2.1 starts AFTER the first block on
 * a chain born in Conway. Replay that actual first block from Ogmios so nonce
 * reconstruction includes its VRF output. No chain or verifier is modified. */
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '../../..');
const dependency = createRequire(path.join(root, 'cardano/gateway/package.json'));
const WebSocket = dependency('ws');
const { Client } = dependency('pg');
const { blake2b } = dependency('@noble/hashes/blake2b');
const digest = (bytes, length = 32) => Buffer.from(blake2b(bytes, {dkLen:length})).toString('hex');

async function firstBlock() {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket('ws://127.0.0.1:2637');
    const timer = setTimeout(() => { socket.terminate(); reject(new Error('First block replay timed out')); }, 30000);
    const finish = (error, block) => { clearTimeout(timer); socket.close(); error ? reject(error) : resolve(block); };
    socket.on('error', error => finish(error));
    socket.on('open', () => socket.send(JSON.stringify({jsonrpc:'2.0', method:'findIntersection', params:{points:['origin']}, id:1})));
    socket.on('message', bytes => {
      const response = JSON.parse(String(bytes));
      if (response.error) return finish(new Error(JSON.stringify(response.error)));
      if (response.result?.direction === 'forward') return finish(null, response.result.block);
      socket.send(JSON.stringify({jsonrpc:'2.0', method:'nextBlock', id:2}));
    });
  });
}

async function main() {
  const runtime = path.resolve(process.argv[2] || '');
  if (!runtime.startsWith(path.join(root, '.deployment-smoke') + path.sep)) throw new Error('Explicit disposable runtime required');
  const rawGenesis = fs.readFileSync(path.join(runtime, 'runtime/genesis-shelley.json'));
  const genesis = JSON.parse(rawGenesis);
  if (genesis.networkMagic !== 42 || genesis.slotLength !== 1) throw new Error('Only the explicit local one-second-slot network is supported');
  const block = await firstBlock();
  if (block.height !== 0 || block.era !== 'conway' || block.ancestor !== 'genesis' || !Array.isArray(block.transactions) || block.slot >= genesis.epochLength)
    throw new Error('First block is not the supported Conway genesis successor; restore complete history instead');
  // Genesis may contain the harness faucet funding. No protocol transaction
  // may be omitted from retained transaction evidence by this narrow repair.
  for (const tx of block.transactions) {
    const allowed = new Set(['id','spends','inputs','outputs','fee','validityInterval','treasury','signatories']);
    if (Object.keys(tx).some(key => !allowed.has(key)) || tx.outputs.some(output =>
      Object.keys(output).some(key => !['address','value'].includes(key)) || Object.keys(output.value).some(key => key !== 'ada')))
      throw new Error('First block contains more than plain ADA funding; complete transaction replay is required');
  }
  const nonce = digest(rawGenesis);
  const db = new Client({connectionString:'postgres://postgres@127.0.0.1:27432/migration_yaci'});
  await db.connect();
  try {
    await db.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
    const later = (await db.query('SELECT 1 FROM epoch_nonce WHERE epoch > 0 LIMIT 1')).rows;
    if (later.length) throw new Error('Later nonces already exist; restore complete nonce history instead of repairing genesis retroactively');
    const next = (await db.query('SELECT hash,prev_hash FROM block WHERE number=1 AND epoch=0')).rows;
    if (next.length !== 1 || next[0].prev_hash !== block.id) throw new Error('Canonical retained history does not extend the replayed first block');
    const existing = (await db.query('SELECT hash FROM block WHERE number=0')).rows;
    if (existing.length > 1 || (existing.length === 1 && existing[0].hash !== block.id)) throw new Error('Conflicting first block history');
    const timestamp = Math.floor(Date.parse(genesis.systemStart)/1000) + block.slot;
    const issuer = block.issuer;
    const certificate = issuer.operationalCertificate;
    if (!existing.length) await db.query(`INSERT INTO block(hash,number,body_size,epoch,block_time,era,issuer_vkey,prev_hash,protocol_version,slot,vrf_result,vrf_vkey,no_of_txs,slot_leader,epoch_slot,op_cert_hot_vkey,op_cert_seq_number,op_cert_kes_period,op_cert_sigma)
      VALUES($1,0,$2,0,$3,7,$4,NULL,$5,$6,$7,$8,$14,$9,$6::bigint::integer,$10,$11,$12,$13)`,
      [block.id,block.size.bytes,timestamp,issuer.verificationKey,`${block.protocol.version.major}.${block.protocol.version.minor}`,block.slot,issuer.leaderValue,issuer.vrfVerificationKey,digest(Buffer.from(issuer.verificationKey,'hex'),28),certificate.kes.verificationKey,certificate.count,certificate.kes.period,certificate.sigma,block.transactions.length]);
    const current = (await db.query('SELECT nonce,block,slot FROM epoch_nonce WHERE epoch=0')).rows;
    if (current.length && (current[0].nonce !== nonce || Number(current[0].block) !== 0 || Number(current[0].slot) !== block.slot)) throw new Error('Conflicting genesis nonce evidence');
    if (!current.length) await db.query(`INSERT INTO epoch_nonce(epoch,nonce,evolving_nonce,candidate_nonce,lab_nonce,last_epoch_block_nonce,slot,block,block_time)
      VALUES(0,$1,$1,$1,NULL,NULL,$2,0,$3)`,[nonce,block.slot,timestamp]);
    await db.query('COMMIT');
    // Independently repeat canonical node replay after publishing index data.
    if ((await firstBlock()).id !== block.id) throw new Error('First block rolled back during repair; rebuild disposable history');
    const report = {purpose:'actual genesis header replay for nonce reconstruction; plain ADA funding transaction bodies are not reconstructed; no verifier changes',source:'local Ogmios chain sync from origin',block,genesisNonce:nonce};
    fs.writeFileSync(path.join(runtime,'genesis-history-replay.json'),JSON.stringify(report,null,2)+'\n');
    console.log(JSON.stringify({firstBlock:block.id,slot:block.slot,genesisNonce:nonce}));
  } catch(error) { await db.query('ROLLBACK'); throw error; }
  finally { await db.end(); }
}
main().catch(error => {console.error(error);process.exitCode=1;});
