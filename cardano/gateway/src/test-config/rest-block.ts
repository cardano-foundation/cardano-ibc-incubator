import * as CML from '@dcspark/cardano-multiplatform-lib-nodejs';
import * as cbor from 'cbor';
import { blake2b } from '@noble/hashes/blake2b';
import type { YaciRestBlock } from '../shared/helpers/yaci-rest';

/** Structural block fixture. These bytes are not a ledger-valid signed block. */
export function restBlockFixture(height = 100, previousHash = '11'.repeat(32), invalid = [1], marker = 1, spend?: string, burn = false, mint = false, quantity = 1n) {
  const address = CML.Address.from_raw_bytes(Buffer.from('60' + '22'.repeat(28), 'hex'));
  const policy = CML.ScriptHash.from_hex('33'.repeat(28));
  const assetName = CML.AssetName.from_hex('01');
  const bodies = [0, 1].map((index) => {
    const inputs = CML.TransactionInputList.new();
    inputs.add(CML.TransactionInput.new(CML.TransactionHash.from_hex(!index && spend ? spend : (index ? '55' : '44').repeat(32)), 0n));
    const multi = CML.MultiAsset.new();
    multi.set(policy, assetName, quantity);
    const output = CML.TransactionOutput.new(address, CML.Value.new(100n, multi), CML.DatumOption.new_datum(CML.PlutusData.from_cbor_hex('00')));
    const outputs = CML.TransactionOutputList.new();
    if (!burn) outputs.add(output);
    const body = CML.TransactionBody.new(inputs, outputs, BigInt(marker + index));
    if (!index && mint) {
      const minted = CML.Mint.new();
      minted.set(policy, assetName, 1n);
      body.set_mint(minted);
    }
    return body;
  });
  const slot = height * 10;
  const headerBody = [height, slot, Buffer.from(previousHash, 'hex'),
    Buffer.alloc(32, marker), Buffer.alloc(32, 3), [Buffer.alloc(64, 4), Buffer.alloc(80, 5)],
    0, Buffer.alloc(32, 6), [Buffer.alloc(32, 7), 0, 0, Buffer.alloc(64, 8)], [8, 0]];
  const header = [headerBody, Buffer.alloc(448, 9)];
  const headerCbor = cbor.encode(header);
  const hash = Buffer.from(blake2b(headerCbor, { dkLen: 32 })).toString('hex');
  const bytes = cbor.encode([header, bodies.map((body) => cbor.decode(body.to_cbor_bytes())), [new Map(), new Map()], new Map(), invalid]);
  const metadata: YaciRestBlock = {
    number: height, hash, previous_block: previousHash, slot, epoch: 0,
    time: 1700000000 + slot, slot_leader: Buffer.from(blake2b(Buffer.alloc(32, marker), { dkLen: 28 })).toString('hex'), tx_count: 2,
  };
  return { metadata, bytes, bodies, hashes: bodies.map((body) => CML.hash_transaction(body).to_hex()), address: address.to_bech32(), unit: policy.to_hex() + assetName.to_hex() };
}
