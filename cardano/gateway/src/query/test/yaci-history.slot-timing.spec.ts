import { ConfigService } from '@nestjs/config';
import { EntityManager } from 'typeorm';
import { LucidService } from '../../shared/modules/lucid/lucid.service';
import { YaciHistoryService } from '../services/yaci-history.service';

describe('sub-second local history', () => {
  const zeroTime = Date.parse('2025-12-31T00:00:00Z');
  const service = new YaciHistoryService(
    { get: (key: string) => key === 'cardanoNetwork' ? 'Custom' : undefined } as ConfigService,
    { LucidImporter: { SLOT_CONFIG_NETWORK: {
      Custom: { zeroTime, zeroSlot: 0, slotLength: 100 },
    } } } as unknown as LucidService,
    {} as EntityManager,
  );

  it('recovers the exact timestamp from a slot despite rounded history seconds', () => {
    const block = (service as any).mapHistoryBlockRow({
      number: 1, hash: 'aa', prev_hash: 'bb', slot: '41', epoch: 0,
      block_time: Math.floor(zeroTime / 1000) + 4, slot_leader: '',
    });
    expect(block.timestampUnixNs).toBe(BigInt(zeroTime + 4100) * 1_000_000n);
    expect((service as any).trySlotFromUnixSeconds(zeroTime / 1000 + 3, block)).toBe(30n);
  });
});
