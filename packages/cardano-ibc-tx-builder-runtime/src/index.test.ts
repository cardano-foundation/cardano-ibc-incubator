import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AsyncMutex } from './asyncMutex';
import {
  decodeAcknowledgement,
  encodeAcknowledgement,
  type Acknowledgement,
} from './acknowledgementCodec';

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
