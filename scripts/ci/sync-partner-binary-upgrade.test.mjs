import assert from "node:assert/strict";
import test from "node:test";
import { LABEL_NAME, PROJECT_ID, syncProject } from "./sync-partner-binary-upgrade.mjs";

function server(rows, { canUpdate = true, onWrite } = {}) {
  const writes = [];
  const labels = (row, start = 0) => ({
    nodes: row.labels.slice(start, start + 100).map((name) => ({ name })),
    pageInfo: {
      hasNextPage: start + 100 < row.labels.length,
      endCursor: String(start + 100),
    },
  });
  function graphql(query, variables) {
    if (query.includes("mutation SyncPartnerUpgrade")) {
      assert.equal(variables.project, PROJECT_ID);
      assert.equal(variables.field, "field-id");
      assert.ok(["required-id", "not-required-id"].includes(variables.option));
      const row = rows.find((item) => item.id === variables.item);
      row.value = variables.option;
      writes.push(variables);
      onWrite?.(row, writes.length);
      return { updateProjectV2ItemFieldValue: { projectV2Item: { id: row.id } } };
    }
    if (query.includes("query PartnerUpgradeLabels")) {
      const row = rows.find((item) => item.id === variables.content);
      return { node: { labels: labels(row, Number(variables.after)) } };
    }
    assert.ok(query.includes("query PartnerUpgradeSnapshot"));
    const start = Number(variables.after || 0);
    return {
      node: {
        viewerCanUpdate: canUpdate,
        field: {
          id: "field-id",
          options: [
            { id: "required-id", name: "Required" },
            { id: "not-required-id", name: "Not required" },
          ],
        },
        items: {
          nodes: rows.slice(start, start + 2).map((row) => ({
            id: row.id,
            fieldValueByName: row.value ? { optionId: row.value } : null,
            content: row.hidden ? null : {
              __typename: row.type || "Issue",
              id: row.id,
              labels: labels(row),
            },
          })),
          pageInfo: { hasNextPage: start + 2 < rows.length, endCursor: String(start + 2) },
        },
      },
    };
  }
  return { graphql, writes };
}

const quiet = () => {};

test("reconciles both directions across project and label pages, including closed items and PRs", () => {
  const rows = [
    { id: "open", labels: [LABEL_NAME], value: "not-required-id", status: "Ready" },
    { id: "pr", type: "PullRequest", labels: ["bug"], value: "required-id" },
    { id: "closed", labels: [LABEL_NAME], state: "CLOSED", archived: true, value: "old-option" },
    { id: "draft", type: "DraftIssue", labels: [], value: "required-id" },
    { id: "many-labels", labels: [...Array.from({ length: 100 }, (_, n) => "label-" + n), LABEL_NAME] },
  ];
  const originalLabels = structuredClone(rows.map((row) => row.labels));
  const fake = server(rows);
  assert.deepEqual(syncProject({ ...fake, apply: true, log: quiet }), { checked: 5, changed: 5, drift: 0 });
  assert.deepEqual(rows.map((row) => row.value), [
    "required-id", "not-required-id", "required-id", "not-required-id", "required-id",
  ]);
  assert.deepEqual(rows.map((row) => row.labels), originalLabels);
  assert.equal(rows[0].status, "Ready");
  assert.equal(rows[2].state, "CLOSED");
  assert.equal(rows[2].archived, true);
  assert.deepEqual(syncProject({ ...fake, apply: true, log: quiet }), { checked: 5, changed: 0, drift: 0 });
  assert.equal(fake.writes.length, 5);
});

test("dry-run reports mismatches without writing", () => {
  const fake = server([{ id: "item", labels: [LABEL_NAME] }]);
  assert.deepEqual(syncProject({ ...fake, log: quiet }), { checked: 1, changed: 0, drift: 1 });
  assert.equal(fake.writes.length, 0);
});

test("inaccessible content cannot be mistaken for an absent label, even after earlier pages", () => {
  const fake = server([
    { id: "one", labels: [LABEL_NAME] },
    { id: "two", labels: [] },
    { id: "hidden", labels: [], hidden: true },
  ]);
  assert.throws(() => syncProject({ ...fake, apply: true, log: quiet }), /inaccessible/);
  assert.equal(fake.writes.length, 0);
});

test("fails without project write access", () => {
  const fake = server([{ id: "item", labels: [LABEL_NAME] }], { canUpdate: false });
  assert.throws(() => syncProject({ ...fake, apply: true, log: quiet }), /cannot update/);
  assert.equal(fake.writes.length, 0);
});

test("a label removed during an older run is reconciled from fresh state", () => {
  const rows = [{ id: "item", labels: [LABEL_NAME], value: "not-required-id" }];
  const fake = server(rows, {
    onWrite(row, count) { if (count === 1) row.labels = []; },
  });
  assert.deepEqual(syncProject({ ...fake, apply: true, log: quiet }), { checked: 1, changed: 2, drift: 0 });
  assert.equal(rows[0].value, "not-required-id");
});
