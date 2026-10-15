import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as Lucid from '@lucid-evolution/lucid';
import { decodeChannelDatum } from './channelDatum';

test('historical full channel datums from older deployments fail with a schema error', async () => {
  for (const stateFields of [7, 8, 9]) {
    const legacy = new Lucid.Constr(0, [
      new Lucid.Constr(0, Array.from({ length: stateFields }, () => 0n)), '', new Lucid.Constr(0, ['', '']),
    ]);
    await assert.rejects(decodeChannelDatum(Lucid.Data.to(legacy), Lucid), /Incompatible channel datum schema.*schema 5/);
  }
});
