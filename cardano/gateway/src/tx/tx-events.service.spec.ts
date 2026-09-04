import { TX_EVENTS_CACHE_MAX_ENTRIES, TX_EVENTS_CACHE_TTL_MS, TxEventsService } from './tx-events.service';

describe('TxEventsService cache lifecycle', () => {
  const events = [{ type: 'send_packet', attributes: [{ key: 'sequence', value: '1' }] }];

  afterEach(() => {
    jest.useRealTimers();
  });

  it('removes the expected-root alias when events are taken by transaction hash', () => {
    const service = new TxEventsService();
    service.register('ABC', events, 'ROOT');

    expect(service.take('abc')).toBe(events);
    expect(service.takeByExpectedRoot('root')).toBeUndefined();
    expect((service as any).eventsByTxHash.size).toBe(0);
    expect((service as any).eventsByExpectedRoot.size).toBe(0);
  });

  it('removes the transaction-hash alias when events are taken by expected root', () => {
    const service = new TxEventsService();
    service.register('ABC', events, 'ROOT');

    expect(service.takeByExpectedRoot('root')).toBe(events);
    expect(service.take('abc')).toBeUndefined();
    expect((service as any).eventsByTxHash.size).toBe(0);
    expect((service as any).eventsByExpectedRoot.size).toBe(0);
  });

  it('bounds both indexes when transactions are abandoned', () => {
    const service = new TxEventsService();
    for (let index = 0; index <= TX_EVENTS_CACHE_MAX_ENTRIES; index += 1) {
      service.register(`tx-${index}`, events, `root-${index}`);
    }

    expect((service as any).eventsByTxHash.size).toBe(TX_EVENTS_CACHE_MAX_ENTRIES);
    expect((service as any).eventsByExpectedRoot.size).toBe(TX_EVENTS_CACHE_MAX_ENTRIES);
    expect(service.take('tx-0')).toBeUndefined();
    expect(service.takeByExpectedRoot('root-0')).toBeUndefined();
  });

  it('expires both aliases together and reports both cache gauges', async () => {
    jest.useFakeTimers();
    const metrics = { setCacheEntries: jest.fn() };
    const service = new TxEventsService(metrics as any);
    service.register('tx', events, 'root');

    await jest.advanceTimersByTimeAsync(TX_EVENTS_CACHE_TTL_MS);

    expect((service as any).eventsByTxHash.size).toBe(0);
    expect((service as any).eventsByExpectedRoot.size).toBe(0);
    expect(metrics.setCacheEntries).toHaveBeenCalledWith('tx_events_by_hash', 0);
    expect(metrics.setCacheEntries).toHaveBeenCalledWith('tx_events_by_expected_root', 0);
  });
});
