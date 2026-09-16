import type {
  ConsensusHistoryRecovery,
  HistoryDeployment,
} from "../src/consensus_history_recovery.ts";
import {
  recoveryJson,
  withHistoryDatabase,
} from "./recover-consensus-history.ts";
import { parse as parseToml } from "@std/toml";
import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import { isAbsolute } from "node:path";

const HELP = `Usage:
  measure-live-consensus-history.ts <measurement.json>

Drive a LOCAL, already deployed proof-backed client through real Hermes updates.
No services are started and no ledger parameters are changed. This script never
reads key material; Hermes uses its operator-owned signer and evaluation config.

JSON configuration:
  {
    "hermesCommand": ["/absolute/path/to/hermes", "--config", "/path/config.toml"],
    "hostChainId": "cardano-devnet", "clientId": "07-tendermint-0",
    "counterpartyChainId": "v8-classic-1",
    "deployment": {"clientToken": {"policyId": "...", "name": "..."},
                   "stateAddress": "addr_test1..."},
    "outputDirectory": "/path/to/results", "samples": [100, 300, 1000]
  }
deployment.bootstrap is optional and otherwise discovered from canonical Yaci.
Optional commandTimeoutMs (default 180000) and catchUpTimeoutMs (default 120000).
Optional heightStep (default 1) selects adjacent or explicitly skipped heights.
Counts include the initial checkpoint and live tip; archived count is count - 1.
Use a dedicated client: another updater changing its tip makes this run fail.
hermesCommand must be exactly [absolute executable, "--config", absolute TOML].
The TOML must contain only the two local chains and an absolute pinned manifest
path. Client NFT/address, client ID and signing/query endpoints are cross-checked
before any update; changed TOML/manifest contents abort the run.

Required environment (loopback URLs only, no credential defaults):
  HISTORY_DB_URL, KUPO_URL, OGMIOS_URL, YACI_URL, COSMOS_RPC_URL

Each update advances heightStep Cosmos heights with the current trusted
height; validator count must stay constant. At each sample the script saves the
accepted block and reconstructs its signed transaction, checks ledger size and
execution-budget limits, measures client ADA, and replays into a NEW empty SQLite
index. Signed bytes include block witnesses, not just Yaci's body-only CBOR.
The original submitted transaction envelope is not retained by block storage;
the reported envelope is reconstructed with CML. Execution units are accepted
redeemer budgets, not separately measured evaluator consumption.
Cold replay checks the live out-ref/root and regenerates the oldest witness.
Existing Gateway caches and indexer/node databases are never deleted or modified.
Results are written to a new subdirectory and progress is flushed as JSONL.
Run with Deno >=2.7 --allow-read --allow-write --allow-env --allow-net --allow-run.
`;

export interface MeasurementConfig {
  hermesCommand: string[];
  hostChainId: string;
  clientId: string;
  counterpartyChainId: string;
  deployment: Omit<HistoryDeployment, "bootstrap"> & {
    bootstrap?: HistoryDeployment["bootstrap"];
  };
  outputDirectory: string;
  samples: number[];
  heightStep: number;
  commandTimeoutMs: number;
  catchUpTimeoutMs: number;
}

export interface MeasurementUpdateRequest {
  config: MeasurementConfig;
  trustedHeight: bigint;
  targetHeight: bigint;
  revisionNumber: bigint;
  expectedClientOutRef: { txHash: string; outputIndex: number };
  directory: string;
  signal: AbortSignal;
}

/** Optional local component harness, never selected by JSON configuration. */
export interface MeasurementUpdateDriver {
  label: string;
  update(request: MeasurementUpdateRequest): Promise<void>;
}

export function measurementDriverMetadata(driver?: MeasurementUpdateDriver) {
  if (
    driver && (!driver.label?.trim() || typeof driver.update !== "function")
  ) {
    throw new Error(
      "A component update driver requires an explicit label and callback",
    );
  }
  return {
    updateDriverLabel: driver?.label ?? "Hermes",
    updateDriverMode: driver ? "local-component" : "hermes",
    latencyScope: driver
      ? "component update inclusion/indexing only; not Hermes signing-policy/finality or end-to-end relay latency"
      : "Hermes update including its configured finality wait",
  };
}

export function assertMeasurementLimits(parameters: {
  maxTxSize?: unknown;
  maxTxExMem?: unknown;
  maxTxExSteps?: unknown;
}): void {
  if (
    !Number.isSafeInteger(parameters.maxTxSize) ||
    Number(parameters.maxTxSize) <= 0 ||
    Number(parameters.maxTxSize) > 16_384 ||
    typeof parameters.maxTxExMem !== "bigint" ||
    parameters.maxTxExMem <= 0n || parameters.maxTxExMem > 16_500_000n ||
    typeof parameters.maxTxExSteps !== "bigint" ||
    parameters.maxTxExSteps <= 0n || parameters.maxTxExSteps > 10_000_000_000n
  ) {
    throw new Error(
      "Local transaction limits are missing, invalid or above production benchmark bounds; no updates were submitted",
    );
  }
}

export async function performMeasurementUpdate(
  request: MeasurementUpdateRequest,
  hermesUpdate: () => Promise<void>,
  driver?: MeasurementUpdateDriver,
): Promise<void> {
  measurementDriverMetadata(driver);
  request.signal.throwIfAborted();
  if (driver) await driver.update(request);
  else await hermesUpdate();
  request.signal.throwIfAborted();
}

function positive(value: unknown, label: string, maximum = 600_000): number {
  if (
    !Number.isSafeInteger(value) || Number(value) <= 0 ||
    Number(value) > maximum
  ) {
    throw new Error(
      `${label} must be a positive safe integer at most ${maximum}`,
    );
  }
  return Number(value);
}

export function measurementConfig(value: unknown): MeasurementConfig {
  if (!value || typeof value !== "object") {
    throw new Error("Measurement configuration must be an object");
  }
  const config = value as Record<string, unknown>;
  for (
    const key of [
      "hostChainId",
      "clientId",
      "counterpartyChainId",
      "outputDirectory",
    ]
  ) {
    if (typeof config[key] !== "string" || !(config[key] as string).trim()) {
      throw new Error(`${key} is required`);
    }
  }
  if (
    !Array.isArray(config.hermesCommand) || config.hermesCommand.length !== 3 ||
    config.hermesCommand.some((part) =>
      typeof part !== "string" || !part || part.includes("\0")
    ) || !isAbsolute(config.hermesCommand[0]) ||
    config.hermesCommand[1] !== "--config" ||
    !isAbsolute(config.hermesCommand[2])
  ) {
    throw new Error(
      'hermesCommand must be [absolute executable, "--config", absolute TOML path]',
    );
  }
  if (
    !config.deployment || typeof config.deployment !== "object" ||
    ((config.deployment as HistoryDeployment).layout !== undefined &&
      (config.deployment as HistoryDeployment).layout !== "production")
  ) {
    throw new Error("A production history deployment is required");
  }
  const deployment = config.deployment as HistoryDeployment;
  if (
    !deployment.clientToken ||
    !/^[0-9a-f]{56}$/i.test(deployment.clientToken.policyId) ||
    !/^(?:[0-9a-f]{2}){0,32}$/i.test(deployment.clientToken.name) ||
    typeof deployment.stateAddress !== "string" ||
    !deployment.stateAddress.trim()
  ) {
    throw new Error(
      "deployment requires the exact client NFT and state address",
    );
  }
  const samples = config.samples ?? [100, 300, 1000];
  if (!Array.isArray(samples) || samples.length === 0) {
    throw new Error("samples must be a nonempty increasing array");
  }
  samples.forEach((sample, index) => {
    positive(sample, "sample count", 100_000);
    if (sample < 2 || (index > 0 && sample <= samples[index - 1])) {
      throw new Error(
        "samples must increase strictly and start at two or more checkpoints",
      );
    }
  });
  return {
    ...structuredClone(config),
    samples: [...samples],
    heightStep: positive(config.heightStep ?? 1, "heightStep", 1_000_000),
    commandTimeoutMs: positive(
      config.commandTimeoutMs ?? 180_000,
      "commandTimeoutMs",
    ),
    catchUpTimeoutMs: positive(
      config.catchUpTimeoutMs ?? 120_000,
      "catchUpTimeoutMs",
    ),
  } as unknown as MeasurementConfig;
}

export function loopbackEndpoint(
  value: string | undefined,
  name: string,
  protocols: string[],
): string {
  if (!value) throw new Error(`${name} is required`);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be an absolute URL`);
  }
  if (
    !protocols.includes(url.protocol) ||
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
  ) {
    throw new Error(
      `${name} must use an allowed protocol and a loopback host; public endpoints are forbidden`,
    );
  }
  return url.toString().replace(/\/$/, "");
}

export function updateArguments(
  config: Pick<
    MeasurementConfig,
    "hermesCommand" | "hostChainId" | "clientId" | "heightStep"
  >,
  trusted: bigint,
): string[] {
  return [
    ...config.hermesCommand.slice(1),
    "update",
    "client",
    "--host-chain",
    config.hostChainId,
    "--client",
    config.clientId,
    "--height",
    (trusted + BigInt(config.heightStep)).toString(),
    "--trusted-height",
    trusted.toString(),
  ];
}

type MeasurementEndpoints = { kupo: string; ogmios: string; cosmos: string };

function object(value: unknown, label: string): Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, any>;
}

function endpointIdentity(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`${label} is required`);
  const url = new URL(loopbackEndpoint(value, label, [
    "http:",
    "https:",
    "ws:",
    "wss:",
  ]));
  if (url.username || url.password || url.hash) {
    throw new Error(`${label} must not embed credentials or a fragment`);
  }
  if (url.hostname === "localhost") url.hostname = "127.0.0.1";
  if (url.protocol === "ws:") url.protocol = "http:";
  if (url.protocol === "wss:") url.protocol = "https:";
  return url.toString().replace(/\/$/, "");
}

/** Parse the actual operator TOML, not a second hand-maintained JSON mirror. */
export function measurementHermesChains(
  config: MeasurementConfig,
  configText: string,
  endpoints: MeasurementEndpoints,
): { manifestPath: string } {
  const parsed = parseToml(configText);
  const chains = parsed.chains;
  if (!Array.isArray(chains) || chains.length !== 2) {
    throw new Error(
      "Measurement Hermes TOML must contain exactly the two local chains",
    );
  }
  const chain = (id: string) => {
    const matches = chains.map((entry) => object(entry, "Hermes chain"))
      .filter((entry) => entry.id === id);
    if (matches.length !== 1) {
      throw new Error(`Hermes chain ${id} must occur exactly once`);
    }
    return matches[0];
  };
  const cardano = chain(config.hostChainId);
  const cosmos = chain(config.counterpartyChainId);
  if (
    cardano.type !== "Cardano" || cosmos.type !== "CosmosSdk" ||
    cardano.network_id !== 0
  ) {
    throw new Error(
      "Measurement requires a testnet Cardano host and CosmosSdk counterparty",
    );
  }
  endpointIdentity(cardano.gateway_url, "Hermes Gateway");
  if (cardano.misbehaviour_witness_gateway_url !== undefined) {
    endpointIdentity(
      cardano.misbehaviour_witness_gateway_url,
      "Hermes witness Gateway",
    );
  }
  endpointIdentity(cosmos.grpc_addr, "Hermes Cosmos gRPC");
  if (cosmos.event_source?.url !== undefined) {
    endpointIdentity(cosmos.event_source.url, "Hermes Cosmos event source");
  }
  for (
    const [actual, expected, label] of [
      [cardano.signing_utxo_kupo_url, endpoints.kupo, "Kupo"],
      [cardano.signing_ogmios_url, endpoints.ogmios, "Ogmios"],
      [cosmos.rpc_addr, endpoints.cosmos, "Cosmos RPC"],
    ]
  ) {
    if (
      endpointIdentity(actual, `Hermes ${label}`) !==
        endpointIdentity(expected, `Measurement ${label}`)
    ) {
      throw new Error(`Hermes ${label} differs from the measurement endpoint`);
    }
  }
  if (
    typeof cardano.bridge_manifest_path !== "string" ||
    !isAbsolute(cardano.bridge_manifest_path)
  ) {
    throw new Error(
      "Hermes requires an absolute operator-pinned bridge_manifest_path",
    );
  }
  return { manifestPath: cardano.bridge_manifest_path };
}

export function assertMeasurementManifest(
  config: MeasurementConfig,
  value: unknown,
): void {
  const manifest = object(value, "Pinned bridge manifest");
  const cardano = object(manifest.cardano, "Manifest Cardano identity");
  if (
    manifest.schema_version !== 4 ||
    manifest.consensus_history_format !== "proof-backed-v1" ||
    cardano.chain_id !== config.hostChainId || cardano.network !== "local" ||
    cardano.network_magic !== 42
  ) {
    throw new Error(
      "Pinned manifest must be the selected local magic-42 proof-backed deployment",
    );
  }
  const validators = object(manifest.validators, "Manifest validators");
  const mintClient = object(
    validators.mint_client_stt,
    "Manifest client policy",
  );
  const spendClient = object(
    validators.spend_client,
    "Manifest client validator",
  );
  const hostToken = object(manifest.host_state_nft, "Manifest HostState NFT");
  if (
    typeof hostToken.policy_id !== "string" ||
    !/^[0-9a-f]{56}$/i.test(hostToken.policy_id) ||
    typeof hostToken.token_name !== "string" ||
    !/^(?:[0-9a-f]{2}){0,32}$/i.test(hostToken.token_name)
  ) {
    throw new Error("Pinned manifest has an invalid HostState NFT");
  }
  const sequence = /^07-tendermint-(0|[1-9][0-9]{0,7})$/.exec(config.clientId)
    ?.[1];
  if (sequence === undefined) {
    throw new Error("clientId must have a canonical supported client sequence");
  }
  // The production token ABI is SHA3-256(HostState token)[0:20] ||
  // SHA3-256(UTF8 ibc_client)[0:4] || UTF8 decimal client sequence.
  const digest = (bytes: Uint8Array) =>
    createHash("sha3-256").update(bytes).digest("hex");
  const expectedName =
    digest(Buffer.from(hostToken.policy_id + hostToken.token_name, "hex"))
      .slice(0, 40) +
    digest(Buffer.from("ibc_client")).slice(0, 8) +
    Buffer.from(sequence).toString("hex");
  if (
    mintClient.script_hash !==
      config.deployment.clientToken.policyId.toLowerCase() ||
    spendClient.address !== config.deployment.stateAddress ||
    expectedName !== config.deployment.clientToken.name.toLowerCase()
  ) {
    throw new Error(
      "Measurement client ID/NFT/address does not match the pinned deployment",
    );
  }
}

export function assertMeasurementFilePins(
  expected: { configText: string; manifestText: string },
  current: { configText: string; manifestText: string },
): void {
  if (
    expected.configText !== current.configText ||
    expected.manifestText !== current.manifestText
  ) {
    throw new Error(
      "Operator Hermes config or pinned manifest changed; no further update is authorized",
    );
  }
}

const ref = (utxo: { txHash: string; outputIndex: number }) =>
  `${utxo.txHash}#${utxo.outputIndex}`;
const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));
const redact = (text: string) =>
  text.replace(
    /(?:postgres(?:ql)?|https?|wss?):\/\/[^\s"'<>)]*/gi,
    "[redacted endpoint]",
  );

async function jsonRpc(
  endpoint: string,
  method: string,
  parameters: Record<string, string> = {},
) {
  const url = new URL(`${endpoint}/${method}`);
  for (const [key, value] of Object.entries(parameters)) {
    url.searchParams.set(key, value);
  }
  const response = await fetch(url, {
    signal: AbortSignal.timeout(15_000),
    redirect: "error",
  });
  if (!response.ok) {
    throw new Error(
      `Local Cosmos ${method} failed with HTTP ${response.status}`,
    );
  }
  const value = await response.json();
  if (value.error || !value.result) {
    throw new Error(`Local Cosmos ${method} returned no result`);
  }
  return value.result;
}

async function validators(endpoint: string, height: bigint): Promise<number> {
  const result = await jsonRpc(endpoint, "validators", {
    height: height.toString(),
    page: "1",
    per_page: "1",
  });
  return positive(Number(result.total), "validator count", 100_000);
}

async function retainedHeight(
  endpoint: string,
  height: bigint,
  chainId: string,
  timeout: number,
): Promise<void> {
  const started = performance.now();
  while (true) {
    const status = await jsonRpc(endpoint, "status");
    if (status.node_info.network !== chainId) {
      throw new Error("Local Cosmos endpoint is for a different chain");
    }
    if (BigInt(status.sync_info.earliest_block_height) > height) {
      throw new Error(
        `Cosmos height ${height} was pruned; cannot run adjacent history growth`,
      );
    }
    if (
      BigInt(status.sync_info.latest_block_height) >= height &&
      !status.sync_info.catching_up
    ) return;
    if (performance.now() - started > timeout) {
      throw new Error(
        "Local Cosmos chain did not reach the next header height",
      );
    }
    await sleep(1_000);
  }
}

async function countRecords(index: ConsensusHistoryRecovery) {
  let count = 0;
  let oldest: { revisionNumber: bigint; revisionHeight: bigint } | undefined;
  for await (const entry of index.records()) {
    count++;
    oldest ??= entry.record.height;
  }
  if (!oldest) throw new Error("Recovered client has no accepted checkpoints");
  return { count, oldest };
}

async function databaseBytes(path: string) {
  const sizes = await Promise.all(
    [path, `${path}-wal`, `${path}-shm`].map(async (file) => {
      try {
        return (await Deno.stat(file)).size;
      } catch (error) {
        if (error instanceof Deno.errors.NotFound) return 0;
        throw error;
      }
    }),
  );
  return {
    database: sizes[0],
    wal: sizes[1],
    sharedMemory: sizes[2],
    total: sizes.reduce((sum, size) => sum + size, 0),
  };
}

export async function measureLiveConsensusHistory(
  args: string[],
  driver?: MeasurementUpdateDriver,
): Promise<void> {
  if (args.length === 1 && ["--help", "-h"].includes(args[0])) {
    console.log(HELP);
    return;
  }
  if (args.length !== 1) {
    throw new Error("Expected measurement JSON path; use --help");
  }
  const config = measurementConfig(
    JSON.parse(await Deno.readTextFile(args[0])),
  );
  const driverMetadata = {
    ...measurementDriverMetadata(driver),
    headerHeightStep: config.heightStep,
  };
  const endpoint = (name: string, protocols = ["http:", "https:"]) =>
    loopbackEndpoint(Deno.env.get(name), name, protocols);
  const databaseUrl = endpoint("HISTORY_DB_URL", ["postgres:", "postgresql:"]);
  const kupo = endpoint("KUPO_URL");
  const ogmios = endpoint("OGMIOS_URL", ["http:", "https:", "ws:", "wss:"]);
  const yaci = endpoint("YACI_URL");
  const cosmos = endpoint("COSMOS_RPC_URL");
  const configText = await Deno.readTextFile(config.hermesCommand[2]);
  const { manifestPath } = measurementHermesChains(config, configText, {
    kupo,
    ogmios,
    cosmos,
  });
  const manifestText = await Deno.readTextFile(manifestPath);
  assertMeasurementManifest(config, JSON.parse(manifestText));
  const pinnedFiles = { configText, manifestText };
  const checkFilePins = async () =>
    assertMeasurementFilePins(pinnedFiles, {
      configText: await Deno.readTextFile(config.hermesCommand[2]),
      manifestText: await Deno.readTextFile(manifestPath),
    });
  const [
    { default: pg },
    { CML, Kupmios },
    { ConsensusHistoryRecovery },
    { createYaciHistorySource, discoverYaciHistoryBootstrap },
    { Cbor, LazyCborArray },
    { blake2b },
    { join },
    { queryProtocolParametersCompat },
  ] = await Promise.all([
    import("pg"),
    import("@lucid-evolution/lucid"),
    import("../src/consensus_history_recovery.ts"),
    import("../src/consensus_history_yaci.ts"),
    import("@harmoniclabs/cbor"),
    import("@noble/hashes/blake2b"),
    import("node:path"),
    import("../src/external_cardano.ts"),
  ]);
  const provider = new Kupmios(kupo, ogmios);
  const parameters = await queryProtocolParametersCompat(ogmios);
  // Do not accept inflated local limits as evidence for production capacity.
  assertMeasurementLimits(parameters);
  await Deno.mkdir(config.outputDirectory, { recursive: true });
  const directory = await Deno.makeTempDir({
    dir: config.outputDirectory,
    prefix: "live-history-",
  });
  const journal = await Deno.open(join(directory, "measurements.jsonl"), {
    createNew: true,
    write: true,
  });
  const log = async (value: unknown) => {
    const line = recoveryJson(value).replace(/\n\s*/g, "") + "\n";
    const bytes = new TextEncoder().encode(line);
    let written = 0;
    while (written < bytes.length) {
      written += await journal.write(bytes.subarray(written));
    }
    await journal.sync();
    console.log(line.trim());
  };
  try {
    const database = new pg.Client({
      connectionString: databaseUrl,
      connectionTimeoutMillis: 15_000,
      query_timeout: 30_000,
      statement_timeout: 30_000,
    });
    await withHistoryDatabase(database, async (sql, wait) => {
      const deployment: HistoryDeployment = {
        ...config.deployment,
        layout: "production",
        bootstrap: config.deployment.bootstrap ??
          await discoverYaciHistoryBootstrap(sql, config.deployment),
      };
      const unit = deployment.clientToken.policyId +
        deployment.clientToken.name;
      const source = () =>
        createYaciHistorySource(
          sql,
          deployment,
          () => wait(() => provider.getUtxoByUnit(unit)),
        );
      const warmPath = join(directory, "warm.sqlite");
      const warm = new ConsensusHistoryRecovery(warmPath, deployment);
      try {
        const catchUp = async (expected?: bigint) => {
          const started = performance.now();
          let lastError: unknown;
          while (performance.now() - started < config.catchUpTimeoutMs) {
            try {
              const result = await warm.recover(source());
              const height = warm.current().record.height.revisionHeight;
              if (expected === undefined || height === expected) return result;
              if (height > expected) {
                throw new Error(
                  "Another updater advanced this client beyond the requested height",
                );
              }
              lastError = new Error(
                "Live client has not reached the requested height",
              );
            } catch (error) {
              lastError = error;
            }
            await sleep(1_000);
          }
          throw new Error(
            "History did not converge before its deadline: " +
              redact(
                lastError instanceof Error
                  ? lastError.message
                  : "unknown error",
              ),
          );
        };
        await catchUp();
        const initial = await countRecords(warm);
        let count = initial.count;
        const baselineHeight = warm.current().record.height;
        await retainedHeight(
          cosmos,
          baselineHeight.revisionHeight,
          config.counterpartyChainId,
          config.catchUpTimeoutMs,
        );
        const fixedValidators = await validators(
          cosmos,
          baselineHeight.revisionHeight,
        );
        for await (const entry of warm.records()) {
          if (
            await validators(cosmos, entry.record.height.revisionHeight) !==
              fixedValidators
          ) {
            throw new Error(
              "Pre-existing client history mixes validator counts",
            );
          }
        }
        await Deno.writeTextFile(
          join(directory, "deployment.json"),
          recoveryJson(deployment),
          { createNew: true },
        );
        await Deno.writeTextFile(
          join(directory, "protocol-parameters.json"),
          recoveryJson(parameters),
          { createNew: true },
        );
        const runManifest = {
          ...driverMetadata,
          event: "start",
          directory,
          clientId: config.clientId,
          hostChainId: config.hostChainId,
          counterpartyChainId: config.counterpartyChainId,
          initialAcceptedCheckpoints: count,
          validatorCount: fixedValidators,
          samples: config.samples,
          sizeEncoding:
            "signed transaction reconstructed from accepted block components",
          executionUnits: "accepted redeemer budgets",
          historyCountIncludesLiveTip: true,
        };
        await Deno.writeTextFile(
          join(directory, "measurement-manifest.json"),
          recoveryJson(runManifest),
          { createNew: true },
        );
        await log(runManifest);

        const sample = async () => {
          const current = warm.current();
          const response = await fetch(
            `${yaci}/api/v1/blocks/${current.point.blockHash}/cbor`,
            {
              headers: { accept: "application/octet-stream" },
              signal: AbortSignal.timeout(30_000),
              redirect: "error",
            },
          );
          if (!response.ok) {
            throw new Error(
              `Yaci accepted block CBOR unavailable: HTTP ${response.status}`,
            );
          }
          let blockBytes = new Uint8Array(await response.arrayBuffer());
          if (blockBytes[0] === 0x82 && blockBytes[1] <= 0x17) {
            blockBytes = blockBytes.slice(2);
          }
          const parsed = Cbor.parseLazyWithOffset(blockBytes);
          if (
            !(parsed.parsed instanceof LazyCborArray) ||
            parsed.parsed.array.length !== 5 ||
            parsed.offset !== blockBytes.length ||
            Buffer.from(blake2b(parsed.parsed.array[0], { dkLen: 32 }))
                .toString("hex") !== current.point.blockHash
          ) {
            throw new Error(
              "Yaci block does not match the authenticated history point",
            );
          }
          const block = CML.Block.from_cbor_bytes(blockBytes);
          const txIndex = current.point.transactionIndex;
          if (
            txIndex >= block.transaction_bodies().len() ||
            txIndex >= block.transaction_witness_sets().len() ||
            block.invalid_transactions().includes(txIndex)
          ) {
            throw new Error(
              "Accepted client transaction is missing or invalid in its block",
            );
          }
          const body = block.transaction_bodies().get(txIndex);
          if (CML.hash_transaction(body).to_hex() !== current.point.txHash) {
            throw new Error("Accepted transaction body hash mismatch");
          }
          const witnesses = block.transaction_witness_sets().get(txIndex);
          const redeemers = witnesses.redeemers();
          if (!redeemers || !witnesses.vkeywitnesses()?.len()) {
            throw new Error(
              "Accepted update is missing script redeemers or key witnesses",
            );
          }
          const signed = CML.Transaction.new(
            body,
            witnesses,
            true,
            block.auxiliary_data_set().get(txIndex),
          );
          const signedBytes = signed.to_cbor_bytes();
          const units = CML.compute_total_ex_units(redeemers);
          if (
            signedBytes.length > parameters.maxTxSize ||
            units.mem() > parameters.maxTxExMem ||
            units.steps() > parameters.maxTxExSteps
          ) {
            throw new Error(
              "Accepted update exceeds the pinned local ledger limits",
            );
          }
          const clientOutput = body.outputs().get(current.utxo.outputIndex);
          if (clientOutput.amount().coin() !== current.utxo.assets.lovelace) {
            throw new Error("Client ADA does not match the accepted output");
          }
          const coldPath = join(directory, `cold-${count}.sqlite`);
          const coldStarted = performance.now();
          const cold = new ConsensusHistoryRecovery(coldPath, deployment);
          let recovery;
          let oldestWitness;
          try {
            recovery = await cold.recover(source());
            const recovered = cold.current();
            if (
              ref(recovered.utxo) !== ref(current.utxo) ||
              recovered.root !== current.root
            ) throw new Error("Client changed during cold replay");
            if ((await countRecords(cold)).count !== count) {
              throw new Error(
                "Replayed accepted checkpoint count differs from the driver count",
              );
            }
            oldestWitness = cold.witness(
              deployment.clientToken,
              initial.oldest,
            );
            if (oldestWitness.root !== current.root) {
              throw new Error("Regenerated historical witness root mismatch");
            }
          } finally {
            cold.close();
          }
          const coldMilliseconds = performance.now() - coldStarted;
          const prefix = join(directory, `sample-${count}`);
          await Deno.writeFile(`${prefix}.block.cbor`, blockBytes, {
            createNew: true,
          });
          await Deno.writeTextFile(
            `${prefix}.signed.cbor`,
            Buffer.from(signedBytes).toString("hex"),
            { createNew: true },
          );
          await Deno.writeTextFile(
            `${prefix}.oldest-witness.json`,
            recoveryJson(oldestWitness),
            { createNew: true },
          );
          const result = {
            ...driverMetadata,
            event: "sample",
            acceptedCheckpoints: count,
            archivedCheckpoints: count - 1,
            validatorCount: fixedValidators,
            height: current.record.height,
            clientOutRef: ref(current.utxo),
            historyRoot: current.root,
            signedTransactionBytes: signedBytes.length,
            declaredMemory: units.mem(),
            declaredCpu: units.steps(),
            feeLovelace: body.fee(),
            clientLovelace: current.utxo.assets.lovelace,
            clientMinLovelace: CML.min_ada_required(
              clientOutput,
              parameters.coinsPerUtxoByte,
            ),
            clientDatumBytes: current.utxo.datum!.length / 2,
            warmIndexBytes: await databaseBytes(warmPath),
            coldIndexBytesAfterClose: await databaseBytes(coldPath),
            coldRecoveryMilliseconds: coldMilliseconds,
            coldReplay: recovery,
            oldestWitnessHeight: initial.oldest,
            oldestWitnessSiblings: oldestWitness.siblings.length,
          };
          await Deno.writeTextFile(`${prefix}.json`, recoveryJson(result), {
            createNew: true,
          });
          await log(result);
        };

        for (const target of config.samples) {
          if (count > target) {
            await log({
              event: "sample-skipped",
              target,
              reason: "client already beyond target at run start",
            });
            continue;
          }
          while (count < target) {
            const previous = warm.current();
            const trustedHeight = previous.record.height.revisionHeight;
            const next = trustedHeight + BigInt(config.heightStep);
            await retainedHeight(
              cosmos,
              next,
              config.counterpartyChainId,
              config.catchUpTimeoutMs,
            );
            const validatorCounts = await Promise.all([
              validators(cosmos, next),
              ...(config.heightStep === 1
                ? []
                : [validators(cosmos, trustedHeight + 1n)]),
            ]);
            if (validatorCounts.some((value) => value !== fixedValidators)) {
              throw new Error(
                "Target or trusted-next validator count changed; stop rather than mix benchmark axes",
              );
            }
            const started = performance.now();
            const abort = new AbortController();
            const timer = setTimeout(
              () => abort.abort(),
              config.commandTimeoutMs,
            );
            try {
              await checkFilePins();
              await performMeasurementUpdate({
                config,
                trustedHeight,
                targetHeight: next,
                revisionNumber: baselineHeight.revisionNumber,
                expectedClientOutRef: previous.utxo,
                directory,
                signal: abort.signal,
              }, async () => {
                const command = await new Deno.Command(
                  config.hermesCommand[0],
                  {
                    args: updateArguments(config, trustedHeight),
                    stdin: "null",
                    stdout: "piped",
                    stderr: "piped",
                    signal: abort.signal,
                  },
                ).output();
                if (!command.success) {
                  throw new Error(
                    `Hermes update failed with exit ${command.code}: ` +
                      redact(
                        new TextDecoder().decode(command.stderr).slice(-1_500),
                      ),
                  );
                }
              }, driver);
            } finally {
              clearTimeout(timer);
            }
            const updateMilliseconds = performance.now() - started;
            const replay = await catchUp(next);
            const current = warm.current();
            if (
              current.record.height.revisionNumber !==
                baselineHeight.revisionNumber ||
              ref(current.utxo) === ref(previous.utxo)
            ) {
              throw new Error(
                `${driverMetadata.updateDriverLabel} did not produce the expected new accepted checkpoint`,
              );
            }
            count++;
            await log({
              ...driverMetadata,
              event: "checkpoint",
              acceptedCheckpoints: count,
              height: current.record.height,
              clientOutRef: ref(current.utxo),
              updateMilliseconds,
              warmReplayMilliseconds: replay.milliseconds,
            });
          }
          await sample();
        }
        await log({
          ...driverMetadata,
          event: "complete",
          acceptedCheckpoints: count,
          directory,
        });
      } finally {
        warm.close();
      }
    });
  } finally {
    journal.close();
  }
}

if (import.meta.main) {
  try {
    await measureLiveConsensusHistory(Deno.args);
  } catch (error) {
    console.error(
      "Live history measurement failed: " +
        redact(error instanceof Error ? error.message : "unknown error"),
    );
    Deno.exitCode = 1;
  }
}
