#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const coreDir = path.join(
  root,
  "cosmos/cardano-probabilistic-light-client-core",
);
const v8Dir = path.join(root, "cosmos/cardano-probabilistic-light-client-v8");
const v10Dir = path.join(root, "cosmos/cardano-probabilistic-light-client-v10");

const sharedSourceFiles = [
  "adapter_test.go",
  "client_state.go",
  "codec.go",
  "consensus_state.go",
  "core_bridge.go",
  "core_bridge_test.go",
  "core_conversion.gen.go",
  "errors.go",
  "events.go",
  "header.go",
  "height.go",
  "heuristic_policy.go",
  "host_state_commitment.go",
  "host_state_datum.go",
  "ibc_state_proof.go",
  "internal/cardanodatum/tm_helper.go",
  "internal/cardanodatum/types.go",
  "keys.go",
  "misbehavour.go",
  "payload_size_test.go",
  "probabilistic.pb.go",
  "state_machine.go",
  "store.go",
  "store_compat_test.go",
  "upgrade.go"
];

const protoFile = "proto/ibc/lightclients/probabilistic/v1/probabilistic.proto";
const expectedTypeUrls = [
  "/ibc.lightclients.probabilistic.v1.ClientState",
  "/ibc.lightclients.probabilistic.v1.ConsensusState",
  "/ibc.lightclients.probabilistic.v1.ProbabilisticHeader",
  "/ibc.lightclients.probabilistic.v1.Misbehaviour",
  "/ibc.lightclients.probabilistic.v1.Height",
];

function read(filePath) {
  return fs.readFileSync(filePath, "utf8").replace(/\r\n/g, "\n");
}

function mustExist(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`missing expected file: ${path.relative(root, filePath)}`);
  }
}

function normalizeCommon(content) {
  return content
    .replaceAll(
      "github.com/cardano-foundation/cardano-ibc-incubator/cosmos/cardano-probabilistic-light-client-v8",
      "github.com/cardano-foundation/cardano-ibc-incubator/cosmos/cardano-probabilistic-light-client-<IBC_GO_MAJOR>",
    )
    .replaceAll(
      "github.com/cardano-foundation/cardano-ibc-incubator/cosmos/cardano-probabilistic-light-client-v10",
      "github.com/cardano-foundation/cardano-ibc-incubator/cosmos/cardano-probabilistic-light-client-<IBC_GO_MAJOR>",
    )
    .replaceAll(
      "github.com/cosmos/ibc-go/v8",
      "github.com/cosmos/ibc-go/v<IBC_GO_MAJOR>",
    )
    .replaceAll(
      "github.com/cosmos/ibc-go/v10",
      "github.com/cosmos/ibc-go/v<IBC_GO_MAJOR>",
    )
    .replaceAll("commitmenttypesv2", "commitmenttypes")
    .replaceAll(
      "modules/core/23-commitment/types/v2",
      "modules/core/23-commitment/types",
    );
}

function normalizeGo(filePath) {
  return normalizeCommon(read(filePath)).replace(
    /var fileDescriptor_[A-Za-z0-9_]+ = \[\]byte\{[\s\S]*?\n}\n/g,
    "var fileDescriptor_<NORMALIZED> = []byte{\n}\n",
  );
}

function normalizeProto(filePath) {
  return normalizeCommon(read(filePath)).replace(
    /option go_package = ".*?";/,
    'option go_package = "<NORMALIZED>";',
  );
}

function unifiedPreview(left, right) {
  const leftLines = left.split("\n");
  const rightLines = right.split("\n");
  const max = Math.max(leftLines.length, rightLines.length);

  for (let i = 0; i < max; i += 1) {
    if (leftLines[i] !== rightLines[i]) {
      const start = Math.max(0, i - 4);
      const end = Math.min(max, i + 8);
      const lines = [];
      for (let j = start; j < end; j += 1) {
        const lineNo = String(j + 1).padStart(4, " ");
        if (leftLines[j] === rightLines[j]) {
          lines.push(` ${lineNo} ${leftLines[j] ?? ""}`);
        } else {
          lines.push(`-${lineNo} ${leftLines[j] ?? ""}`);
          lines.push(`+${lineNo} ${rightLines[j] ?? ""}`);
        }
      }
      return lines.join("\n");
    }
  }

  return "<no line-level diff available>";
}

function assertEqual(label, left, right) {
  if (left === right) {
    return;
  }

  throw new Error(
    `${label} drifted after normalization:\n${unifiedPreview(left, right)}`,
  );
}

function parseConst(content, name) {
  const re = new RegExp(`\\b${name}\\s*=\\s*"([^"]+)"`);
  return content.match(re)?.[1];
}

function parseProtoPackage(content) {
  return content.match(/^package\s+([^;]+);/m)?.[1];
}

function parseMessageNames(content) {
  return [...content.matchAll(/^message\s+([A-Za-z0-9_]+)\s*\{/gm)].map(
    (match) => match[1],
  );
}

function parseProtoFields(content) {
  const messages = new Map();
  const messageRe = /^message\s+([A-Za-z0-9_]+)\s*\{([\s\S]*?)^}/gm;
  let messageMatch;

  while ((messageMatch = messageRe.exec(content)) !== null) {
    const [, messageName, body] = messageMatch;
    const fields = [];

    for (const rawLine of body.split("\n")) {
      const line = rawLine.trim();
      if (
        line === "" ||
        line.startsWith("option ") ||
        line.startsWith("//") ||
        line.startsWith("reserved ")
      ) {
        if (line.startsWith("reserved ")) {
          fields.push(line);
        }
        continue;
      }

      const fieldMatch = line.match(
        /^(?:(repeated|optional)\s+)?([A-Za-z0-9_.]+)\s+([A-Za-z0-9_]+)\s*=\s*([0-9]+)(?:\s+\[(.*)\])?;/,
      );
      if (fieldMatch) {
        const [, label = "", type, name, number, options = ""] = fieldMatch;
        fields.push(`${number}:${label}:${type}:${name}:${options}`);
      }
    }

    messages.set(messageName, fields);
  }

  return messages;
}

function stableJson(value) {
  if (value instanceof Map) {
    return JSON.stringify(
      [...value.entries()].sort(([left], [right]) => left.localeCompare(right)),
      null,
      2,
    );
  }
  return JSON.stringify(value, null, 2);
}

function listFiles(dir, predicate, base = dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listFiles(fullPath, predicate, base));
    } else if (predicate(fullPath)) {
      files.push(path.relative(base, fullPath));
    }
  }

  return files.sort();
}

function assertFileInventory() {
  const relevant = (filePath) =>
    filePath.endsWith(".go") || filePath.endsWith(".proto");
  const expectedV8 = [...sharedSourceFiles, "module.go", protoFile].sort();
  const expectedV10 = [
    ...sharedSourceFiles,
    "events_test.go",
    "light_client_module.go",
    "module.go",
    protoFile,
  ].sort();

  assertEqual(
    "v8 Go/proto file inventory",
    stableJson(listFiles(v8Dir, relevant)),
    stableJson(expectedV8),
  );
  assertEqual(
    "v10 Go/proto file inventory",
    stableJson(listFiles(v10Dir, relevant)),
    stableJson(expectedV10),
  );
}

function assertPublicIdentity() {
  const v8Keys = read(path.join(coreDir, "state/keys.go"));
  const v10Keys = read(path.join(coreDir, "state/keys.go"));
  for (const dir of [v8Dir, v10Dir]) {
    if (!/\bModuleName\s*=\s*state\.ModuleName/.test(read(path.join(dir, "keys.go")))) {
      throw new Error(`${path.basename(dir)} must use the shared ModuleName`);
    }
  }
  const v8Proto = read(path.join(v8Dir, protoFile));
  const v10Proto = read(path.join(v10Dir, protoFile));

  assertEqual(
    "ModuleName",
    parseConst(v8Keys, "ModuleName"),
    parseConst(v10Keys, "ModuleName"),
  );
  assertEqual(
    "ModuleName value",
    parseConst(v8Keys, "ModuleName"),
    "08-cardano-probabilistic",
  );
  assertEqual(
    "protobuf package",
    parseProtoPackage(v8Proto),
    parseProtoPackage(v10Proto),
  );
  assertEqual(
    "protobuf package value",
    parseProtoPackage(v8Proto),
    "ibc.lightclients.probabilistic.v1",
  );
  assertEqual(
    "protobuf message names",
    stableJson(parseMessageNames(v8Proto)),
    stableJson(parseMessageNames(v10Proto)),
  );
  assertEqual(
    "protobuf field map",
    stableJson(parseProtoFields(v8Proto)),
    stableJson(parseProtoFields(v10Proto)),
  );

  const v8Generated = read(path.join(v8Dir, "probabilistic.pb.go"));
  const v10Generated = read(path.join(v10Dir, "probabilistic.pb.go"));
  if (v8Generated === v10Generated) {
    throw new Error(
      "v8 and v10 generated protobufs are identical; regenerate each file from its version-specific go_package",
    );
  }
  for (const typeUrl of expectedTypeUrls) {
    const messageName = typeUrl.slice(typeUrl.lastIndexOf(".") + 1);
    const protoName = typeUrl.slice(1);
    if (
      !v8Generated.includes(`"${protoName}"`) ||
      !v10Generated.includes(`"${protoName}"`)
    ) {
      throw new Error(
        `missing expected protobuf name ${protoName} for type URL ${typeUrl} in generated code`,
      );
    }
    if (
      !v8Generated.includes(`type ${messageName} struct`) ||
      !v10Generated.includes(`type ${messageName} struct`)
    ) {
      throw new Error(`missing generated message struct ${messageName}`);
    }
  }
}

function assertCoreSourceParity() {
  for (const relativePath of sharedSourceFiles) {
    const v8File = path.join(v8Dir, relativePath);
    const v10File = path.join(v10Dir, relativePath);
    mustExist(v8File);
    mustExist(v10File);
    assertEqual(relativePath, normalizeGo(v8File), normalizeGo(v10File));
  }

  assertEqual(
    protoFile,
    normalizeProto(path.join(v8Dir, protoFile)),
    normalizeProto(path.join(v10Dir, protoFile)),
  );
}

function assertAdapterBoundaries() {
  const v8Module = read(path.join(v8Dir, "module.go"));
  const v10Module = read(path.join(v10Dir, "module.go"));

  if (fs.existsSync(path.join(v8Dir, "light_client_module.go"))) {
    throw new Error(
      "v8 module must not contain v10-only light_client_module.go",
    );
  }
  mustExist(path.join(v10Dir, "light_client_module.go"));

  if (!/func NewAppModule\(\) AppModule/.test(v8Module)) {
    throw new Error(
      "v8 AppModule constructor should remain a no-argument ibc-go/v8 app module shim",
    );
  }
  if (
    !/func NewAppModule\(lightClientModule LightClientModule\) AppModule/.test(
      v10Module,
    )
  ) {
    throw new Error(
      "v10 AppModule constructor should keep the ibc-go/v10 LightClientModule route",
    );
  }
  if (
    !/var _ exported\.LightClientModule = \(\*LightClientModule\)\(nil\)/.test(
      read(path.join(v10Dir, "light_client_module.go")),
    )
  ) {
    throw new Error(
      "v10 light_client_module.go must implement exported.LightClientModule",
    );
  }
}

function assertModuleTargets() {
  const coreMod = read(path.join(coreDir, "go.mod"));
  const v8Mod = read(path.join(v8Dir, "go.mod"));
  const v10Mod = read(path.join(v10Dir, "go.mod"));

  const expected = [
    [
      coreMod,
      "module github.com/cardano-foundation/cardano-ibc-incubator/cosmos/cardano-probabilistic-light-client-core",
    ],
    [
      v8Mod,
      "module github.com/cardano-foundation/cardano-ibc-incubator/cosmos/cardano-probabilistic-light-client-v8",
    ],
    [
      v8Mod,
      "github.com/cardano-foundation/cardano-ibc-incubator/cosmos/cardano-probabilistic-light-client-core v0.1.5",
    ],
    [v8Mod, "github.com/cosmos/ibc-go/v8 v8.7.0"],
    [
      v10Mod,
      "module github.com/cardano-foundation/cardano-ibc-incubator/cosmos/cardano-probabilistic-light-client-v10",
    ],
    [
      v10Mod,
      "github.com/cardano-foundation/cardano-ibc-incubator/cosmos/cardano-probabilistic-light-client-core v0.1.5",
    ],
    [v10Mod, "github.com/cosmos/ibc-go/v10 v10.2.0"],
  ];

  for (const [content, needle] of expected) {
    if (!content.includes(needle)) {
      throw new Error(`go.mod target assertion failed, missing: ${needle}`);
    }
  }
}

function assertSharedCoreExtraction() {
  const coreFiles = [
    "cardano_block.go",
    "host_state.go",
    "ibc_state_proof.go",
    "cardanodatum/types.go",
  ];
  for (const relativePath of coreFiles) {
    mustExist(path.join(coreDir, relativePath));
  }

  const adapterFiles = [
    ...[v8Dir, v10Dir].flatMap(dir => [
      "core_bridge.go", "core_conversion.gen.go", "state_machine.go", "store.go",
      "ibc_state_proof.go", "internal/cardanodatum/types.go",
    ].map(file => path.join(dir, file))),
  ];
  for (const filePath of adapterFiles) {
    if (!read(filePath).includes("cardano-probabilistic-light-client-core")) {
      throw new Error(`${path.relative(root, filePath)} must use the shared core`);
    }
  }

  const forbiddenAdapterPatterns = [
    /\bfunc\s+ComputeRootFromProofPath\b/,
    /\bfunc\s+leafHash\b/,
    /\btype\s+jsonMerkleProof\b/,
    /\btype\s+HostStateDatum\s+struct\b/,
    /\bfunc\s+DecodeTransactionBody\b/,
    /\bfunc\s+ExtractIbcStateRootFromTransactionBody\b/,
  ];

  for (const filePath of adapterFiles) {
    const content = read(filePath);
    for (const pattern of forbiddenAdapterPatterns) {
      if (pattern.test(content)) {
        throw new Error(
          `${path.relative(root, filePath)} redefines shared core logic matching ${pattern}`,
        );
      }
    }
  }
}

// These are review budgets, not a reason to compress code. New validation or
// transition logic belongs in core/state. Raise a budget only for host API work.
const adapterLineBudgets = {
  "client_state.go": 170,
  "codec.go": 20,
  "consensus_state.go": 30,
  "core_bridge.go": 80,
  "errors.go": 30,
  "events.go": 110,
  "header.go": 40,
  "height.go": 90,
  "heuristic_policy.go": 20,
  "host_state_commitment.go": 10,
  "host_state_datum.go": 10,
  "ibc_state_proof.go": 200,
  "internal/cardanodatum/tm_helper.go": 310,
  "internal/cardanodatum/types.go": 30,
  "keys.go": 20,
  "light_client_module.go": 180,
  "misbehavour.go": 40,
  "module.go": 60,
  "state_machine.go": 60,
  "store.go": 100,
  "upgrade.go": 30
};

function assertThinAdapters() {
  for (const dir of [v8Dir, v10Dir]) {
    for (const file of listFiles(dir, f => f.endsWith(".go"))) {
      if (file.endsWith("_test.go") || file.endsWith(".pb.go") || file.endsWith(".gen.go")) continue;
      const source = read(path.join(dir, file));
      const lines = source.trimEnd().split("\n").length;
      if (!adapterLineBudgets[file] || lines > adapterLineBudgets[file]) {
        throw new Error(`${path.basename(dir)}/${file} exceeds its thin adapter budget (${lines}/${adapterLineBudgets[file] ?? 0} lines). Put shared logic in core/state.`);
      }
      if (/\b(?:computeHeaderSecurityMetrics|verifyBridgeContinuity|verifyHeaderTemporalContinuity|validateCheckpointFields|persistCheckpoint|validateOperationalCertificateCounterRecovery|authenticateProbabilisticBlock)\s*\(/.test(source)) {
        throw new Error(`${file} reintroduces shared state-machine logic`);
      }
      if (/"(?:github.com\/blinklabs-io\/gouroboros|math\/bits)/.test(source)) {
        throw new Error(`${file} imports Cardano verification or scoring dependencies in an adapter`);
      }
    }
  }
  for (const file of listFiles(coreDir, f => f.endsWith(".go"))) {
    if (/"github.com\/cosmos\/(?:ibc-go|cosmos-sdk)\//.test(read(path.join(coreDir, file)))) {
      throw new Error(`${file} makes the shared core depend on an IBC or SDK version`);
    }
  }
  for (const file of ["update.go", "checkpoint.go", "time_validation.go", "proposal_handle.go", "misbehaviour_handle.go", "block_authentication.go"]) {
    mustExist(path.join(coreDir, "state", file));
  }
}

try {
  assertModuleTargets();
  assertSharedCoreExtraction();
  assertFileInventory();
  assertThinAdapters();
  assertPublicIdentity();
  assertCoreSourceParity();
  assertAdapterBoundaries();
  console.log("light client parity check passed");
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
