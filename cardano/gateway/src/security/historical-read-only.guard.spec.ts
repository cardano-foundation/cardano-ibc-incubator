import { historicalReadOnly, HistoricalReadOnlyGuard } from './historical-read-only.guard';

describe('historical recovery mode', () => {
  const original = process.env.GATEWAY_HISTORICAL_READ_ONLY;
  afterEach(() => {
    if (original === undefined) delete process.env.GATEWAY_HISTORICAL_READ_ONLY;
    else process.env.GATEWAY_HISTORICAL_READ_ONLY = original;
  });
  it('requires an explicit boolean and does not silently reinterpret a typo', () => {
    expect(historicalReadOnly({})).toBe(false);
    expect(historicalReadOnly({ GATEWAY_HISTORICAL_READ_ONLY: 'true' })).toBe(true);
    expect(() => historicalReadOnly({ GATEWAY_HISTORICAL_READ_ONLY: '1' })).toThrow('must be true or false');
  });
  it('rejects transaction RPCs for the entire lifetime of a read-only instance', () => {
    process.env.GATEWAY_HISTORICAL_READ_ONLY = 'true';
    const guard = new HistoricalReadOnlyGuard();
    delete process.env.GATEWAY_HISTORICAL_READ_ONLY;
    expect(() => guard.canActivate()).toThrow('historical read-only mode');
  });
  it('leaves normal instances subject to their existing authentication and on-chain gates', () => {
    delete process.env.GATEWAY_HISTORICAL_READ_ONLY;
    expect(new HistoricalReadOnlyGuard().canActivate()).toBe(true);
  });
});
