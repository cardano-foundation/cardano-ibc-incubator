import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { blake2b } from '@noble/hashes/blake2b';
import * as cbor from 'cbor';
import { HistoryService } from '../../../query/services/history.service';
import { MiniProtocalsService } from './mini-protocals.service';

function cardanoBlockFixture(): { blockCbor: Buffer; headerCbor: Buffer; blockHash: string } {
  const headerBody = [
    1,
    2,
    Buffer.alloc(32, 1),
    Buffer.alloc(32, 2),
    Buffer.alloc(32, 3),
    [Buffer.alloc(64, 4), Buffer.alloc(80, 5)],
    0,
    Buffer.alloc(32, 6),
    [Buffer.alloc(32, 7), 0, 0, Buffer.alloc(64, 8)],
    [8, 0],
  ];
  const headerCbor = cbor.encode([headerBody, Buffer.alloc(448, 9)]);
  const blockCbor = cbor.encode([cbor.decode(headerCbor), [], [], new Map(), []]);
  const blockHash = Buffer.from(blake2b(headerCbor, { dkLen: 32 })).toString('hex');
  return { blockCbor, headerCbor, blockHash };
}

describe('MiniProtocalsService block header extraction', () => {
  const service = new MiniProtocalsService({} as HistoryService, {} as ConfigService, {} as Logger);

  it('returns the exact signed header bytes and checks their Cardano hash', () => {
    const fixture = cardanoBlockFixture();

    expect(service.extractBlockHeaderCbor(fixture.blockCbor, fixture.blockHash)).toEqual(fixture.headerCbor);
  });

  it('rejects a fetched block whose signed header does not match the indexed hash', () => {
    const fixture = cardanoBlockFixture();

    expect(() => service.extractBlockHeaderCbor(fixture.blockCbor, '00'.repeat(32))).toThrow(
      'does not match requested block',
    );
  });

  it.each([
    ['truncated block', (blockCbor: Buffer) => blockCbor.subarray(0, blockCbor.length - 1)],
    ['trailing bytes', (blockCbor: Buffer) => Buffer.concat([blockCbor, Buffer.from([0])])],
    ['wrong block shape', (_blockCbor: Buffer) => cbor.encode([1, 2, 3])],
  ])('rejects %s CBOR', (_name, mutate) => {
    const fixture = cardanoBlockFixture();

    expect(() => service.extractBlockHeaderCbor(mutate(fixture.blockCbor), fixture.blockHash)).toThrow(
      'Failed to extract authenticated Cardano block header',
    );
  });
});
