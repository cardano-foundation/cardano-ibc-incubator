import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export function createPacketStateMock() {
  return {
    events: jest.fn().mockResolvedValue([]),
    snapshot: jest.fn(async () =>
      Buffer.from(
        readFileSync(
          resolve(
            __dirname,
            '../../../../../cosmos/cardano-probabilistic-light-client-core/testdata/gateway-packet-snapshot.hex',
          ),
          'utf8',
        ).trim(),
        'hex',
      ),
    ),
    proof: jest.fn(),
    entries: jest.fn(),
  };
}
