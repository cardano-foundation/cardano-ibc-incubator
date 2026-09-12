#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const PROJECT_ID = "PVT_kwDOAjXEkc4A0HGO"; // cardano-foundation project 32
export const FIELD_NAME = "Partner binary upgrade";
export const LABEL_NAME = "partner-binary-upgrade";

const snapshotQuery = `query PartnerUpgradeSnapshot($project: ID!, $after: String) {
  node(id: $project) {
    ... on ProjectV2 {
      viewerCanUpdate
      field(name: "Partner binary upgrade") {
        ... on ProjectV2SingleSelectField { id options { id name } }
      }
      items(first: 100, after: $after) {
        nodes {
          id
          fieldValueByName(name: "Partner binary upgrade") {
            ... on ProjectV2ItemFieldSingleSelectValue { optionId }
          }
          content {
            __typename
            ... on DraftIssue { id }
            ... on Issue {
              id
              labels(first: 100) {
                nodes { name }
                pageInfo { hasNextPage endCursor }
              }
            }
            ... on PullRequest {
              id
              labels(first: 100) {
                nodes { name }
                pageInfo { hasNextPage endCursor }
              }
            }
          }
        }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
}`;

const labelsQuery = `query PartnerUpgradeLabels($content: ID!, $after: String!) {
  node(id: $content) {
    ... on Issue {
      labels(first: 100, after: $after) {
        nodes { name }
        pageInfo { hasNextPage endCursor }
      }
    }
    ... on PullRequest {
      labels(first: 100, after: $after) {
        nodes { name }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
}`;

const updateMutation = `mutation SyncPartnerUpgrade(
  $project: ID!, $item: ID!, $field: ID!, $option: String!
) {
  updateProjectV2ItemFieldValue(input: {
    projectId: $project, itemId: $item, fieldId: $field,
    value: { singleSelectOptionId: $option }
  }) { projectV2Item { id } }
}`;

function githubGraphql(query, variables) {
  const response = JSON.parse(execFileSync("gh", ["api", "graphql", "--input", "-"], {
    input: JSON.stringify({ query, variables }),
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    timeout: 60_000,
  }));
  if (response.errors?.length || !response.data) {
    throw new Error("GitHub GraphQL failed: " + JSON.stringify(response.errors));
  }
  return response.data;
}

function nextCursor(connection) {
  if (!connection?.nodes || !connection.pageInfo) {
    throw new Error("Incomplete GitHub response; refusing to infer label absence");
  }
  if (!connection.pageInfo.hasNextPage) return null;
  if (!connection.pageInfo.endCursor) throw new Error("Missing pagination cursor");
  return connection.pageInfo.endCursor;
}

function hasUpgradeLabel(graphql, content) {
  if (content?.__typename === "DraftIssue") return false;
  if (!content || !["Issue", "PullRequest"].includes(content.__typename)) {
    throw new Error("Project content is inaccessible; refusing to infer label absence");
  }
  let labels = content.labels;
  for (;;) {
    const after = nextCursor(labels);
    if (labels.nodes.some((label) => label.name === LABEL_NAME)) return true;
    if (!after) return false;
    labels = graphql(labelsQuery, { content: content.id, after }).node?.labels;
  }
}

function readSnapshot(graphql) {
  let after = null;
  let field;
  let canUpdate = false;
  const items = [];
  do {
    const project = graphql(snapshotQuery, { project: PROJECT_ID, after }).node;
    if (!project?.field?.id) throw new Error("Project or binary-upgrade field is inaccessible");
    field = project.field;
    canUpdate = project.viewerCanUpdate;
    after = nextCursor(project.items);
    for (const item of project.items.nodes) {
      items.push({
        id: item.id,
        current: item.fieldValueByName?.optionId,
        desired: hasUpgradeLabel(graphql, item.content) ? "Required" : "Not required",
      });
    }
  } while (after);
  const options = new Map(field.options.map((option) => [option.name, option.id]));
  if (!options.has("Required") || !options.has("Not required")) {
    throw new Error("The field needs Required and Not required options");
  }
  return { field, options, items, canUpdate };
}

export function syncProject({ graphql = githubGraphql, apply = false, log = console.log } = {}) {
  let changed = 0;
  // Re-read after writes: a label may change while an earlier run is executing.
  for (let attempt = 0; attempt < 4; attempt++) {
    const { field, options, items, canUpdate } = readSnapshot(graphql);
    const drift = items.filter((item) => item.current !== options.get(item.desired));
    if (!apply || !drift.length) {
      for (const item of drift) log(item.id + " -> " + item.desired);
      return { checked: items.length, changed, drift: drift.length };
    }
    if (!canUpdate) throw new Error("The credential cannot update organization Project 32");
    if (attempt === 3) throw new Error("Labels kept changing during synchronization; rerun required");
    for (const item of drift) {
      graphql(updateMutation, {
        project: PROJECT_ID, item: item.id, field: field.id,
        option: options.get(item.desired),
      });
      changed++;
      log(item.id + " -> " + item.desired);
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  if (args.some((arg) => !["--apply", "--check"].includes(arg)) || args.length > 1) {
    console.error("Usage: node scripts/ci/sync-partner-binary-upgrade.mjs [--apply | --check]");
    process.exitCode = 1;
  } else {
    try {
      const result = syncProject({ apply: args.includes("--apply") });
      console.log(JSON.stringify(result));
      if (args.includes("--check") && result.drift) process.exitCode = 1;
    } catch (error) {
      console.error(error.message);
      process.exitCode = 1;
    }
  }
}
