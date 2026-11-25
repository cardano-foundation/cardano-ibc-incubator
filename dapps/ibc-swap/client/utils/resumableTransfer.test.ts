/* global globalThis */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  clearResumableTransfer,
  persistResumableTransfer,
  readResumableTransfer,
  type ResumableTransferRecord,
} from './resumableTransfer';

const record: ResumableTransferRecord = {
  version: 1,
  sourceTxHash: 'ab'.repeat(32),
  sourceChainId: 'cardano-devnet',
  destinationChainId: 'localosmosis',
  createdAt: '2026-01-01T00:00:00.000Z',
};

const quotaExceeded = () => {
  throw new DOMException('Storage is full', 'QuotaExceededError');
};

const browserLocation = { href: '', search: '' };

const withBrowser = (storage: Partial<Storage>, run: () => void) => {
  const original = (globalThis as any).window;
  browserLocation.href = 'https://swap.example/transfer';
  browserLocation.search = '';
  (globalThis as any).window = {
    localStorage: storage,
    location: browserLocation,
    history: {
      replaceState: (_state: unknown, _unused: string, url: string) => {
        browserLocation.href = url;
        browserLocation.search = new URL(url).search;
      },
    },
  };
  try {
    run();
  } finally {
    (globalThis as any).window = original;
  }
};

test('persisting a transfer survives full storage and still writes the URL', () => {
  withBrowser({ setItem: quotaExceeded, getItem: () => null }, () => {
    assert.deepEqual(persistResumableTransfer(record), {
      stored: false,
      urlUpdated: true,
    });
    const params = new URL(browserLocation.href).searchParams;
    assert.equal(params.get('sourceTxHash'), record.sourceTxHash);
    assert.equal(params.get('sourceChainId'), record.sourceChainId);
    assert.equal(params.get('destinationChainId'), record.destinationChainId);
    assert.equal(readResumableTransfer()?.sourceTxHash, record.sourceTxHash);
  });
});

test('persisting a transfer reports a stored record', () => {
  const values = new Map<string, string>();
  withBrowser(
    {
      setItem: (key, value) => values.set(key, value),
      getItem: (key) => values.get(key) ?? null,
    },
    () => {
      assert.deepEqual(persistResumableTransfer(record), {
        stored: true,
        urlUpdated: true,
      });
      assert.deepEqual(readResumableTransfer(), record);
    },
  );
});

test('clearing a transfer survives blocked storage and still clears the URL', () => {
  withBrowser(
    {
      setItem: quotaExceeded,
      removeItem: () => {
        throw new DOMException('Storage is blocked', 'SecurityError');
      },
    },
    () => {
      persistResumableTransfer(record);
      assert.notEqual(browserLocation.search, '');
      assert.doesNotThrow(() => clearResumableTransfer());
      assert.equal(browserLocation.search, '');
    },
  );
});
