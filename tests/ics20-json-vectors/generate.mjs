#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(SCRIPT_DIRECTORY, "../..");
const CASES_PATH = path.join(SCRIPT_DIRECTORY, "cases.json");
const GO_GENERATOR_TEMPLATE_PATH = path.join(
  SCRIPT_DIRECTORY,
  "go-generator.go.tmpl",
);
const VECTORS_PATH = path.join(SCRIPT_DIRECTORY, "vectors.json");
const AIKEN_VECTORS_PATH = path.join(
  REPOSITORY_ROOT,
  "cardano/onchain/lib/ibc/apps/transfer/types/fungible_token_packet_data_vectors.test.ak",
);

const FIELD_NAMES = ["denom", "amount", "sender", "receiver", "memo"];
const MAX_PACKET_BYTES = 512;
const EXACT_LIMIT_PROFILES = {
  maximum_packet_bytes: ["cardano", "ibcGoV8", "ibcGoV10"],
  maximum_go_escaped_packet_bytes: ["ibcGoV8", "ibcGoV10"],
};
const GO_GENERATORS = [
  {
    profile: "ibcGoV8",
    module: "github.com/cosmos/ibc-go/v8",
    version: "v8.7.0",
    directory: "cosmos/cardano-probabilistic-light-client-v8",
  },
  {
    profile: "ibcGoV10",
    module: "github.com/cosmos/ibc-go/v10",
    version: "v10.2.0",
    directory: "cosmos/cardano-mithril-light-client-v10",
  },
];

function assertExactKeys(value, expected, description) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${description} must be an object`);
  }
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
    throw new Error(
      `${description} has keys ${JSON.stringify(actual)}; expected ${JSON.stringify(wanted)}`,
    );
  }
}

function readCases() {
  const cases = JSON.parse(readFileSync(CASES_PATH, "utf8"));
  if (!Array.isArray(cases) || cases.length === 0) {
    throw new Error("cases.json must contain a non-empty array");
  }
  const names = new Set();
  for (const [index, testCase] of cases.entries()) {
    assertExactKeys(testCase, ["name", "data"], `case ${index}`);
    if (!/^[a-z][a-z0-9_]*$/.test(testCase.name) || names.has(testCase.name)) {
      throw new Error(
        `case ${index} has an invalid or duplicate name ${testCase.name}`,
      );
    }
    names.add(testCase.name);
    assertExactKeys(testCase.data, FIELD_NAMES, `case ${testCase.name}.data`);
    for (const field of FIELD_NAMES) {
      if (typeof testCase.data[field] !== "string") {
        throw new Error(`case ${testCase.name}.data.${field} must be a string`);
      }
    }
  }
  return cases;
}

function cardanoJSON(data) {
  const sorted = {};
  for (const field of ["amount", "denom", "memo", "receiver", "sender"]) {
    if (data[field].length > 0) {
      sorted[field] = data[field];
    }
  }
  return JSON.stringify(sorted);
}

function wireEncoding(json) {
  return {
    json,
    hex: Buffer.from(json, "utf8").toString("hex"),
  };
}

function runGoGenerator(configuration) {
  const temporaryDirectory = mkdtempSync(
    path.join(tmpdir(), "ics20-json-vectors-"),
  );
  const goSourcePath = path.join(temporaryDirectory, "main.go");
  const template = readFileSync(GO_GENERATOR_TEMPLATE_PATH, "utf8");
  writeFileSync(
    goSourcePath,
    template.replaceAll("__IBC_GO_MODULE__", configuration.module),
    "utf8",
  );
  let stdout;
  try {
    stdout = execFileSync("go", ["run", goSourcePath, CASES_PATH], {
      cwd: path.join(REPOSITORY_ROOT, configuration.directory),
      encoding: "utf8",
      env: {
        ...process.env,
        GOTOOLCHAIN: "go1.25.13",
        GOWORK: "off",
      },
      maxBuffer: 10 * 1024 * 1024,
    });
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
  const generated = JSON.parse(stdout);
  if (
    generated.module !== configuration.module ||
    generated.version !== configuration.version
  ) {
    throw new Error(
      `${configuration.profile} used ${generated.module}@${generated.version}; ` +
        `expected ${configuration.module}@${configuration.version}`,
    );
  }
  return generated.vectors;
}

function combineVectors(cases, generatedByProfile) {
  const vectors = cases.map((testCase, index) => {
    const wire = {
      cardano: wireEncoding(cardanoJSON(testCase.data)),
    };
    for (const configuration of GO_GENERATORS) {
      const generated = generatedByProfile[configuration.profile][index];
      if (generated?.name !== testCase.name) {
        throw new Error(
          `${configuration.profile} vector ${index} is ${generated?.name}; expected ${testCase.name}`,
        );
      }
      const encoding = wireEncoding(generated.json);
      if (encoding.hex !== generated.hex) {
        throw new Error(
          `${configuration.profile} emitted inconsistent JSON and hex`,
        );
      }
      wire[configuration.profile] = encoding;
    }

    for (const [profile, encoding] of Object.entries(wire)) {
      const packetBytes = Buffer.from(encoding.hex, "hex").byteLength;
      if (packetBytes > MAX_PACKET_BYTES) {
        throw new Error(
          `${testCase.name}.${profile} is ${packetBytes} bytes; ` +
            `maximum is ${MAX_PACKET_BYTES}`,
        );
      }
    }

    for (const profile of EXACT_LIMIT_PROFILES[testCase.name] ?? []) {
      const packetBytes = Buffer.from(wire[profile].hex, "hex").byteLength;
      if (packetBytes !== MAX_PACKET_BYTES) {
        throw new Error(
          `${testCase.name}.${profile} is ${packetBytes} bytes; ` +
            `expected exactly ${MAX_PACKET_BYTES}`,
        );
      }
    }

    return { ...testCase, wire };
  });

  for (const caseName of Object.keys(EXACT_LIMIT_PROFILES)) {
    if (!vectors.some((vector) => vector.name === caseName)) {
      throw new Error(`missing exact-limit case ${caseName}`);
    }
  }

  return vectors;
}

function byteArrayHex(value) {
  return `#"${Buffer.from(value, "utf8").toString("hex")}"`;
}

function renderAiken(vectors) {
  const lines = [
    "// Generated by tests/ics20-json-vectors/generate.mjs. Do not edit by hand.",
    "// The Cosmos bytes come from ibc-go v8.7.0 and v10.2.0 GetBytes().",
    "use ibc/apps/transfer/types/fungible_token_packet_data.{FungibleTokenPacketData} as packet_data",
    "",
  ];
  for (const vector of vectors) {
    lines.push(
      `fn ${vector.name}() -> FungibleTokenPacketData {`,
      "  FungibleTokenPacketData {",
      `    denom: ${byteArrayHex(vector.data.denom)},`,
      `    amount: ${byteArrayHex(vector.data.amount)},`,
      `    sender: ${byteArrayHex(vector.data.sender)},`,
      `    receiver: ${byteArrayHex(vector.data.receiver)},`,
      `    memo: ${byteArrayHex(vector.data.memo)},`,
      "  }",
      "}",
      "",
      `test pinned_${vector.name}_cardano_bytes() {`,
      `  packet_data.get_bytes(${vector.name}()) == #"${vector.wire.cardano.hex}"`,
      "}",
      "",
      `test pinned_${vector.name}_ibc_go_v8_bytes() {`,
      "  let expected =",
      `    #"${vector.wire.ibcGoV8.hex}"`,
      "  and {",
      `    packet_data.get_v8_bytes(${vector.name}()) == expected,`,
      `    packet_data.matches_bytes(${vector.name}(), expected),`,
      "  }",
      "}",
      "",
      `test pinned_${vector.name}_ibc_go_v10_bytes() {`,
      "  let expected =",
      `    #"${vector.wire.ibcGoV10.hex}"`,
      "  and {",
      `    packet_data.get_v10_bytes(${vector.name}()) == expected,`,
      `    packet_data.matches_bytes(${vector.name}(), expected),`,
      "  }",
      "}",
      "",
    );
  }
  return lines.join("\n");
}

function expectedFiles() {
  const cases = readCases();
  const generatedByProfile = Object.fromEntries(
    GO_GENERATORS.map((configuration) => [
      configuration.profile,
      runGoGenerator(configuration),
    ]),
  );
  const vectors = combineVectors(cases, generatedByProfile);
  const manifest = {
    schemaVersion: 1,
    sources: Object.fromEntries(
      GO_GENERATORS.map(({ profile, module, version }) => [
        profile,
        { module, version },
      ]),
    ),
    vectors,
  };
  return {
    vectors: `${JSON.stringify(manifest, null, 2)}\n`,
    aiken: renderAiken(vectors),
  };
}

function main() {
  const mode = process.argv[2] ?? "--check";
  if (!["--check", "--write"].includes(mode)) {
    throw new Error("usage: generate.mjs [--check|--write]");
  }
  const expected = expectedFiles();
  const outputs = [
    [VECTORS_PATH, expected.vectors],
    [AIKEN_VECTORS_PATH, expected.aiken],
  ];
  if (mode === "--write") {
    for (const [outputPath, content] of outputs) {
      writeFileSync(outputPath, content, "utf8");
      console.log(`Wrote ${path.relative(REPOSITORY_ROOT, outputPath)}`);
    }
    return;
  }
  for (const [outputPath, expectedContent] of outputs) {
    const actual = readFileSync(outputPath, "utf8");
    if (actual !== expectedContent) {
      throw new Error(
        `${path.relative(REPOSITORY_ROOT, outputPath)} is stale; run ` +
          "`node tests/ics20-json-vectors/generate.mjs --write`",
      );
    }
    console.log(`Validated ${path.relative(REPOSITORY_ROOT, outputPath)}`);
  }
}

try {
  main();
} catch (error) {
  console.error(
    error instanceof Error ? (error.stack ?? error.message) : error,
  );
  process.exitCode = 1;
}
