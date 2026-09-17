// Bind all four exact raw body fields, including witnesses, to the canonical
// header. A transaction-body hash alone does not authenticate its witnesses.
const path = require('node:path');
const { createRequire } = require('node:module');
const req = createRequire(path.resolve(__dirname, '../../cardano/gateway/package.json'));
const { Cbor, LazyCborArray } = req('@harmoniclabs/cbor');
const { blake2b } = req('@noble/hashes/blake2b');
const CML = req('@dcspark/cardano-multiplatform-lib-nodejs');
const hash = bytes => Buffer.from(blake2b(bytes, { dkLen: 32 }));

function authenticateBlock(bytes, expectedHash) {
  const { parsed, offset } = Cbor.parseLazyWithOffset(bytes);
  if (!(parsed instanceof LazyCborArray) || parsed.array.length !== 5 || offset !== bytes.length)
    throw new Error('Expected one complete five-field Cardano block');
  if (hash(parsed.array[0]).toString('hex') !== expectedHash)
    throw new Error('Canonical block header hash mismatch');
  const header = CML.Header.from_cbor_bytes(parsed.array[0]);
  const body = hash(Buffer.concat(parsed.array.slice(1).map(hash))).toString('hex');
  if (body !== header.header_body().block_body_hash().to_hex())
    throw new Error('Canonical block body/witness hash mismatch');
  return CML.Block.from_cbor_bytes(bytes);
}

module.exports = { authenticateBlock };
