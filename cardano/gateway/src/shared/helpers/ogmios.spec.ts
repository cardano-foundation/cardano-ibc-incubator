import { bech32 } from 'bech32';

const mockOgmiosSockets: Array<{ sent: Array<Record<string, unknown>> }> = [];
const mockOgmiosResponses: Record<string, unknown> = {};

jest.mock('ws', () => {
  const { EventEmitter } = jest.requireActual('events') as typeof import('events');

  class MockWebSocket extends EventEmitter {
    static readonly CONNECTING = 0;
    static readonly OPEN = 1;

    readyState = MockWebSocket.OPEN;
    sent: Array<Record<string, unknown>> = [];

    constructor() {
      super();
      mockOgmiosSockets.push(this);
      queueMicrotask(() => this.emit('open'));
    }

    send(payload: string, callback?: (error?: Error) => void) {
      const request = JSON.parse(payload) as Record<string, unknown>;
      this.sent.push(request);
      callback?.();
      if (request.method === 'releaseLedgerState') {
        return;
      }
      queueMicrotask(() =>
        this.emit(
          'message',
          Buffer.from(
            JSON.stringify({
              jsonrpc: '2.0',
              id: request.id,
              result: mockOgmiosResponses[String(request.method)] ?? {},
            }),
          ),
        ),
      );
    }

    close() {
      this.readyState = 3;
    }

    terminate() {
      this.readyState = 3;
    }
  }

  return { __esModule: true, default: MockWebSocket };
});

import {
  parseOperationalCertificateCounters,
  parseShelleyGenesisConfig,
  parseStakeDistributionRows,
  queryOperationalCertificateCountersAtPoint,
} from './ogmios';

describe('Ogmios stability verification parsing', () => {
  beforeEach(() => {
    mockOgmiosSockets.length = 0;
    for (const key of Object.keys(mockOgmiosResponses)) {
      delete mockOgmiosResponses[key];
    }
  });

  it('parses both KES parameters from the Shelley genesis response', () => {
    expect(
      parseShelleyGenesisConfig({
        era: 'shelley',
        activeSlotsCoefficient: '1/20',
        slotsPerKesPeriod: 129600,
        maxKesEvolutions: 62,
      }),
    ).toEqual({
      slotsPerKesPeriod: 129600,
      maxKesEvolutions: 62,
      activeSlotCoefficientNumerator: 1n,
      activeSlotCoefficientDenominator: 20n,
    });
  });

  it('keeps exact relative stake separately from the rounded scoring weight', () => {
    const [entry] = parseStakeDistributionRows(
      {},
      {
        pool1issuer: {
          stake: '4178103721131/5019556879197493',
          vrf: 'a7'.repeat(32),
        },
      },
    );

    expect(entry.relativeStakeNumerator).toBe(4_178_103_721_131n);
    expect(entry.relativeStakeDenominator).toBe(5_019_556_879_197_493n);
    expect(entry.stake).toBe(832_365_052n);
  });

  it('normalizes positive-stake pools over delegated stake for Praos leader verification', () => {
    const entries = parseStakeDistributionRows(
      {},
      {
        pool1alpha: { stake: '9/56', vrf: 'a1'.repeat(32) },
        pool1beta: { stake: '9/56', vrf: 'b2'.repeat(32) },
        pool1gamma: { stake: '5/28', vrf: 'c3'.repeat(32) },
        pool1delta: { stake: '9/56', vrf: 'd4'.repeat(32) },
        pool1epsilon: { stake: '9/56', vrf: 'e5'.repeat(32) },
      },
      true,
    );

    expect(entries.map((entry) => [entry.relativeStakeNumerator, entry.relativeStakeDenominator])).toEqual([
      [9n, 46n],
      [9n, 46n],
      [5n, 23n],
      [9n, 46n],
      [9n, 46n],
    ]);
    expect(entries.map((entry) => entry.stake)).toEqual([
      195_652_173_913n,
      195_652_173_913n,
      217_391_304_348n,
      195_652_173_913n,
      195_652_173_913n,
    ]);
  });

  it('does not add an unassigned entry when exact pool fractions already sum to one', () => {
    const entries = parseStakeDistributionRows(
      {},
      {
        pool1alpha: { stake: '1/2', vrf: 'a1'.repeat(32) },
        pool1beta: { stake: '1/2', vrf: 'b2'.repeat(32) },
      },
      true,
    );

    expect(entries).toHaveLength(2);
    expect(entries.map((entry) => [entry.relativeStakeNumerator, entry.relativeStakeDenominator])).toEqual([
      [1n, 2n],
      [1n, 2n],
    ]);
  });

  it('does not turn an all-zero pool map into synthetic stake', () => {
    expect(
      parseStakeDistributionRows(
        {},
        {
          pool1alpha: { stake: '0/1', vrf: 'a1'.repeat(32) },
        },
      ),
    ).toEqual([]);
  });

  it('rejects live pool fractions whose exact sum exceeds one', () => {
    expect(() =>
      parseStakeDistributionRows(
        {},
        {
          pool1alpha: { stake: '3/4', vrf: 'a1'.repeat(32) },
          pool1beta: { stake: '3/4', vrf: 'b2'.repeat(32) },
        },
        true,
      ),
    ).toThrow('live stake fractions exceed one');
  });

  it.each(['0/20', '21/20', '0.05', '1/0', '18446744073709551616/18446744073709551616'])(
    'rejects invalid active-slot coefficient %s',
    (activeSlotsCoefficient) => {
      expect(() =>
        parseShelleyGenesisConfig({
          era: 'shelley',
          activeSlotsCoefficient,
          slotsPerKesPeriod: 129600,
          maxKesEvolutions: 62,
        }),
      ).toThrow('invalid activeSlotsCoefficient');
    },
  );

  it('rejects a relative-stake fraction outside protobuf uint64 bounds', () => {
    expect(() =>
      parseStakeDistributionRows(
        {},
        {
          pool1issuer: {
            stake: '1/18446744073709551616',
            vrf: 'a7'.repeat(32),
          },
        },
      ),
    ).toThrow('invalid live stake fraction');
  });

  it.each([
    { era: 'shelley', slotsPerKesPeriod: 129600 },
    { era: 'shelley', slotsPerKesPeriod: 129600, maxKesEvolutions: 0 },
    { era: 'shelley', slotsPerKesPeriod: 129600, maxKesEvolutions: 65 },
    { era: 'shelley', slotsPerKesPeriod: 0, maxKesEvolutions: 62 },
    { era: 'alonzo', slotsPerKesPeriod: 129600, maxKesEvolutions: 62 },
  ])('rejects incomplete or invalid Shelley KES parameters: %p', (config) => {
    expect(() => parseShelleyGenesisConfig(config)).toThrow();
  });

  it('normalizes operational certificate pool ids and preserves uint64 counters', () => {
    const maxUint64 = (1n << 64n) - 1n;
    const poolIdA = bech32.encode('pool', bech32.toWords(Buffer.alloc(28, 0xaa)));
    const poolIdB = bech32.encode('pool', bech32.toWords(Buffer.alloc(28, 0xbb)));

    expect(
      parseOperationalCertificateCounters({
        [` ${poolIdA.toUpperCase()} `]: 7,
        [poolIdB]: maxUint64.toString(),
      }),
    ).toEqual(
      new Map([
        [poolIdA, 7n],
        [poolIdB, maxUint64],
      ]),
    );
  });

  it('accepts an empty counter map because registered pools default to sequence zero', () => {
    expect(parseOperationalCertificateCounters({})).toEqual(new Map());
  });

  it.each([
    null,
    [],
    { invalid: 1 },
    { [bech32.encode('stake', bech32.toWords(Buffer.alloc(28, 4)))]: 1 },
    { [bech32.encode('pool', bech32.toWords(Buffer.alloc(27, 5)))]: 1 },
    { [bech32.encode('pool', bech32.toWords(Buffer.alloc(28, 1)))]: -1 },
    { [bech32.encode('pool', bech32.toWords(Buffer.alloc(28, 2)))]: Number.MAX_SAFE_INTEGER + 1 },
    { [bech32.encode('pool', bech32.toWords(Buffer.alloc(28, 3)))]: (1n << 64n).toString() },
  ])('rejects an invalid operational certificate snapshot: %p', (snapshot) => {
    expect(() => parseOperationalCertificateCounters(snapshot)).toThrow();
  });

  it('rejects pool ids that collide after normalization', () => {
    const poolId = bech32.encode('pool', bech32.toWords(Buffer.alloc(28, 0xcc)));
    expect(() =>
      parseOperationalCertificateCounters({
        [poolId]: 1,
        [poolId.toUpperCase()]: 2,
      }),
    ).toThrow('duplicate operational certificate pool id');
  });

  it('acquires the exact point and queries certificate counters on the same session', async () => {
    const poolId = bech32.encode('pool', bech32.toWords(Buffer.alloc(28, 0xdd)));
    mockOgmiosResponses['acquireLedgerState'] = {};
    mockOgmiosResponses['queryLedgerState/operationalCertificates'] = { [poolId]: 7 };

    await expect(
      queryOperationalCertificateCountersAtPoint('ws://ogmios.test', {
        slot: 1234,
        hash: 'ab'.repeat(32),
      }),
    ).resolves.toEqual(new Map([[poolId, 7n]]));

    expect(mockOgmiosSockets).toHaveLength(1);
    expect(mockOgmiosSockets[0].sent.map((request) => request.method)).toEqual([
      'acquireLedgerState',
      'queryLedgerState/operationalCertificates',
      'releaseLedgerState',
    ]);
    expect(mockOgmiosSockets[0].sent[0].params).toEqual({
      point: { slot: 1234, id: 'ab'.repeat(32) },
    });
  });
});
