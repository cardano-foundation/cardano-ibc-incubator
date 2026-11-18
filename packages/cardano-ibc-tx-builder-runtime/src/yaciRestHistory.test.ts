import { strict as assert } from "node:assert";
import { test } from "node:test";
import { YaciRestClient, YaciRestHistoryChangedError } from "./yaciRest.ts";
import { YaciRestHistory } from "./yaciRestHistory.ts";

const anchor = {
  number: 100,
  hash: "aa".repeat(32),
  previous_block: null,
  slot: 1000,
  epoch: 2,
  time: 1000,
  slot_leader: "pool",
  tx_count: 0,
};
const page = { blocks: [{ ...anchor, number: 101, slot: 1001 }, anchor] };

test("epoch history uses its requested anchor even when the latest tip changes", async () => {
  const requested: unknown[] = [];
  const api = {
    block: async (height: unknown) => {
      requested.push(height);
      assert.equal(height, 100);
      return anchor;
    },
    json: async () => page,
  } as unknown as YaciRestClient;
  const rows = await new YaciRestHistory(api).epochBlocks(2, 100);
  assert.deepEqual(
    rows.map((row) => row.number),
    [100],
  );
  assert.deepEqual(requested, [100, 100]);
});

test("epoch history still rejects a rollback of the requested anchor", async () => {
  let reads = 0;
  const api = {
    block: async () =>
      ++reads === 1 ? anchor : { ...anchor, hash: "bb".repeat(32) },
    json: async () => page,
  } as unknown as YaciRestClient;
  await assert.rejects(
    new YaciRestHistory(api).epochBlocks(2, 100),
    YaciRestHistoryChangedError,
  );
});

test("epoch history keeps the latest-tip default for callers without an anchor", async () => {
  const requested: unknown[] = [];
  const api = {
    block: async (height: unknown) => {
      requested.push(height);
      return anchor;
    },
    json: async () => page,
  } as unknown as YaciRestClient;
  await new YaciRestHistory(api).epochBlocks(2);
  assert.deepEqual(requested, ["latest", 100]);
});

function epochPages(second: number[], alter = false) {
  const row = (number: number) => ({ ...anchor, number, slot: number + 900 });
  return {
    block: async () => anchor,
    json: async (path: string) => ({
      blocks: path.endsWith("page=1")
        ? Array.from({ length: 100 }, (_, i) => row(200 - i))
        : second.map((number) => ({
            ...row(number),
            ...(alter && number === 101 ? { slot_leader: "changed" } : {}),
          })),
    }),
  } as unknown as YaciRestClient;
}

test("epoch pagination accepts unchanged overlap as the live tip advances", async () => {
  const rows = await new YaciRestHistory(
    epochPages([102, 101, 100, 99]),
  ).epochBlocks(2, 100);
  assert.deepEqual(
    rows.map((row) => row.number),
    [99, 100],
  );
});

test("epoch pagination rejects changed overlapping evidence", async () => {
  await assert.rejects(
    new YaciRestHistory(epochPages([101, 100], true)).epochBlocks(2, 100),
    /overlap changed/,
  );
});

test("epoch pagination rejects a gap between pages", async () => {
  await assert.rejects(
    new YaciRestHistory(epochPages([99, 98])).epochBlocks(2, 100),
    /skipped a block/,
  );
});

test("epoch pagination rejects duplicates within a page", async () => {
  await assert.rejects(
    new YaciRestHistory(epochPages([101, 101, 100])).epochBlocks(2, 100),
    /not contiguous/,
  );
});

test("epoch pagination rejects a repeated full page", async () => {
  await assert.rejects(
    new YaciRestHistory(
      epochPages(Array.from({ length: 100 }, (_, i) => 200 - i)),
    ).epochBlocks(2, 100),
    /no progress/,
  );
});
