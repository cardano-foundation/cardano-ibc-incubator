import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AsyncMutex } from './asyncMutex';
import {
  decodeAcknowledgement,
  encodeAcknowledgement,
  type Acknowledgement,
} from './acknowledgementCodec';
import { transferEscrowShardTokenName } from './index';
import { LucidIbcAdapter } from './lucidIbcAdapter';
import * as Lucid from '@lucid-evolution/lucid';

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

const TestLucid = {
  Data: {
    Bytes: () => 'bytes',
    Object: (schema: unknown) => schema,
    Enum: (schema: unknown) => schema,
    to: (value: unknown) => JSON.stringify(value),
    from: (encoded: string) => JSON.parse(encoded),
  },
} as unknown as typeof import('@lucid-evolution/lucid');

describe('tx-builder runtime serialization', () => {
  it('frames channel and denomination boundaries in escrow shard names', () => {
    const suffix = 'ab'.repeat(28);
    const first = transferEscrowShardTokenName(
      Buffer.from('channel-1').toString('hex'),
      Buffer.from(`23${suffix}`).toString('hex'),
    );
    const formerlyAliased = transferEscrowShardTokenName(
      Buffer.from('channel-123').toString('hex'),
      Buffer.from(suffix).toString('hex'),
    );

    assert.equal(
      first,
      '82bd61ddc779508a845de79b0119ec03c6c5f4adaec7e1462052cc50',
    );
    assert.notEqual(first, formerlyAliased);
    assert.throws(
      () => transferEscrowShardTokenName('not-hex', '00'),
      /channelId must be an even-length hexadecimal string/,
    );
  });

  it('encodes the one-constructor escrow shard redeemer as the Aiken wire type', async () => {
    const adapter = new LucidIbcAdapter(Lucid, {} as never, {} as never);
    const encoded = await adapter.encode(
      {
        CreateEscrowShard: {
          channel_id: '00',
          denom: '01',
          data: {
            denom: '01',
            amount: '31',
            sender: '02',
            receiver: '03',
            memo: '',
          },
          registry_siblings: ['00'.repeat(32)],
        },
      },
      'transferEscrowShardRedeemer',
    );

    assert.equal(
      encoded,
      [
        'd87984',
        '4100',
        '4101',
        'd87985410141314102410340',
        '815820',
        '00'.repeat(32),
      ].join(''),
    );
  });

  it('runs queued operations one at a time in submission order', async () => {
    const mutex = new AsyncMutex();
    const firstCanFinish = deferred();
    const firstStarted = deferred();
    const order: string[] = [];

    const first = mutex.runExclusive(async () => {
      order.push('first:start');
      firstStarted.resolve();
      await firstCanFinish.promise;
      order.push('first:end');
      return 'first';
    });
    const second = mutex.runExclusive(async () => {
      order.push('second:start');
      order.push('second:end');
      return 'second';
    });
    const third = mutex.runExclusive(async () => {
      order.push('third:start');
      order.push('third:end');
      return 'third';
    });

    await firstStarted.promise;
    await Promise.resolve();
    assert.deepEqual(order, ['first:start']);

    firstCanFinish.resolve();
    assert.deepEqual(await Promise.all([first, second, third]), [
      'first',
      'second',
      'third',
    ]);
    assert.deepEqual(order, [
      'first:start',
      'first:end',
      'second:start',
      'second:end',
      'third:start',
      'third:end',
    ]);
  });
});

describe('acknowledgement codec', () => {
  it('round-trips acknowledgement result and error responses', () => {
    const success: Acknowledgement = {
      response: {
        AcknowledgementResult: {
          result: Buffer.from('ok').toString('hex'),
        },
      },
    };
    const failure: Acknowledgement = {
      response: {
        AcknowledgementError: {
          err: Buffer.from('insufficient funds').toString('hex'),
        },
      },
    };

    assert.deepEqual(
      decodeAcknowledgement(
        encodeAcknowledgement(success, TestLucid),
        TestLucid,
      ),
      success,
    );
    assert.deepEqual(
      decodeAcknowledgement(
        encodeAcknowledgement(failure, TestLucid),
        TestLucid,
      ),
      failure,
    );
  });
});
