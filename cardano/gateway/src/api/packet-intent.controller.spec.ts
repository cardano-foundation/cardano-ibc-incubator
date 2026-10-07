import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PacketIntentController } from './packet-intent.controller';
import { PacketLaneService } from '../tx/packet-lane.service';
import { HistoricalReadOnlyGuard } from '../security/historical-read-only.guard';

jest.mock('../tx/packet-lane.service', () => ({ PacketLaneService: class {} }));

describe('intent owner cancellation HTTP boundary', () => {
  const original = process.env.GATEWAY_HISTORICAL_READ_ONLY;
  afterEach(() => {
    if (original === undefined) delete process.env.GATEWAY_HISTORICAL_READ_ONLY;
    else process.env.GATEWAY_HISTORICAL_READ_ONLY = original;
  });
  it.each([false, true])('builds unsigned cancellation only in ordinary mode (read-only=%s)', async (readOnly) => {
    process.env.GATEWAY_HISTORICAL_READ_ONLY = String(readOnly);
    const cancelIntent = jest.fn().mockResolvedValue({ unsigned_tx: { type_url: '', value: Buffer.from('deadbeef') } });
    const module = await Test.createTestingModule({
      controllers: [PacketIntentController],
      providers: [HistoricalReadOnlyGuard, { provide: PacketLaneService, useValue: { cancelIntent } }],
    }).compile();
    const app = module.createNestApplication();
    await app.init();
    const hash = 'ab'.repeat(32);
    try {
      const response = await request(app.getHttpServer())
        .post(`/api/cardano/intents/channel-0/${hash}/cancel`)
        .send({ signer: 'owner', output_index: 1 });
      expect(response.status).toBe(readOnly ? 503 : 200);
      if (readOnly) expect(cancelIntent).not.toHaveBeenCalled();
      else {
        expect(cancelIntent).toHaveBeenCalledWith('channel-0', hash, 'owner', 1);
        expect(response.body.unsigned_tx.value).toBe(Buffer.from('deadbeef').toString('base64'));
      }
    } finally {
      await app.close();
    }
  });
});
