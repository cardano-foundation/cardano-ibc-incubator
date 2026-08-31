import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  analyzeCapacityScenario,
  analyzeProofCapacityScenario,
  CARDANO_MAX_TX_EX_MEM,
  CARDANO_MAX_TX_EX_STEPS,
  CARDANO_MAX_TX_SIZE_BYTES,
  CARDANO_SAFE_TX_EX_MEM,
  CARDANO_SAFE_TX_EX_STEPS,
  CARDANO_SAFE_TX_SIZE_BYTES,
  DEFAULT_NORMALIZED_FIXTURE_PATH,
  loadNormalizedCapacityFixture,
  resizeCapacityScenario,
  STRUCTURAL_PLACEHOLDER_EX_UNITS,
  type CapacityScenarioReport,
  type ProofStructuralExUnits,
  type StructuralExUnits,
} from './tendermint-update-capacity';

type AikenCheckReport = {
  modules: Array<{
    name: string;
    tests: Array<{
      title: string;
      execution_units?: { mem: number | null; cpu: number | null };
    }>;
  }>;
};

type ExUnits = { mem: bigint; steps: bigint };

type ComparisonRow = {
  id: 'direct' | 'sp1';
  label: string;
  signedBytes: number;
  memory: number;
  cpu: number;
  report: CapacityScenarioReport;
};

type ScalingRow = {
  validatorCount: number;
  directSignedBytes: number;
};

type NetworkProofObservation = {
  status: 'not_submitted' | 'submitted' | 'fulfilled' | 'failed';
  requestId: string | null;
  requestToFulfillmentSeconds: number | null;
  gasLimitPgu: number | null;
  gasUsedPgu: number | null;
};

type PersistentWrapperObservation = {
  classification: 'single-local-observation';
  runId: string;
  measuredOn: string;
  requestCount: number;
  fixture: { path: string; sha256: string };
  benchmarkScript: { path: string; sha256: string };
  timings: {
    processStartToReadinessSeconds: number;
    proofSeconds: number[];
    processTotalWallSeconds: number;
  };
  resources: {
    maximumResidentBytesApprox: number;
    measurement: string;
    qualification: string;
  };
  host: {
    model: string;
    processor: string;
    memoryBytes: number;
    performanceCores: number;
    efficiencyCores: number;
    operatingSystem: string;
    architecture: string;
  };
  tools: {
    go: string;
    gnark: string;
    gnarkCrypto: string;
  };
  verificationKeySha256: string;
};

type Sp1Provenance = {
  guestRunner: {
    source: { path: string; sha256: string };
    cpuBenchmarkScript: { path: string; sha256: string };
    cargoLock: { path: string; sha256: string };
    cargoManifest: { path: string; sha256: string };
    observationsCheckedOn: string;
    measurementMethod: string;
    rerunInCi: boolean;
    cpuTuning: {
      fullGroth16: {
        runnerSource: {
          relationship: string;
          commit: string;
          path: string;
          sha256: string;
        };
        inputRelationship: string;
      };
      [key: string]: unknown;
    };
  };
  guestExecutions: Array<{
    case: string;
    fixture: string;
    validators: number;
    measuredAtUnixSeconds: number;
    executeSeconds: number;
    instructions: number;
    syscalls: number;
    localEstimatedPgu: number;
    publicValuesSha256: string;
    networkProof: NetworkProofObservation;
    executionStatus: string;
  }>;
  cardanoGroth16Verifier: {
    aikenVersion: string;
  };
  proverService: {
    persistentWrapperBenchmark: PersistentWrapperObservation;
    injective45Regression: {
      sp1ProveSeconds: number;
      sp1PeakResidentBytes: number;
      wrapperKeyLoadSeconds: number;
      outerWrapperSeconds: number;
    };
  };
};

const repoRoot = path.resolve(__dirname, '../../../../..');
const assetsDir = path.join(repoRoot, 'docs/assets');
const dataPath = path.join(assetsDir, 'tendermint-update-benchmark.json');
const comparisonSvgPath = path.join(assetsDir, 'tendermint-update-budget-comparison.svg');
const scalingSvgPath = path.join(assetsDir, 'tendermint-update-validator-scaling.svg');
const defaultAikenReportPath = path.join(repoRoot, 'aiken-check.json');
const provenancePath = path.join(repoRoot, 'studies/sp1_tendermint_cardano/provenance.json');
const blueprintPath = path.join(repoRoot, 'cardano/onchain/plutus.json');
const onchainRoot = path.join(repoRoot, 'cardano/onchain');

const testNames = {
  hostState: 'host_state_stt.test.host_update_client_capacity_minimum_history_succeeds',
  directClient: 'spending_client_capacity.test.update_client_capacity_adjacent_all_signed_45_succeeds',
  proofClient: 'spending_client.test.proof_update_budget_gate_succeeds',
  tendermintProof:
    'ibc/client/ics_007_tendermint_client/proof_update/state.test.full_transaction_accepts_exact_proof_update',
} as const;

const validatorCounts = [4, 16, 32, 45, 64, 100, 200] as const;

function parseArgs(argv: string[]): { write: boolean; aikenReportPath: string } {
  let write = false;
  let aikenReportPath = defaultAikenReportPath;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--write') {
      write = true;
    } else if (argument === '--check') {
      write = false;
    } else if (argument === '--aiken-report') {
      const value = argv[index + 1];
      if (!value) {
        throw new Error('--aiken-report requires a path');
      }
      aikenReportPath = path.resolve(value);
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  return { write, aikenReportPath };
}

function readJson<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
}

function validateProvenanceFile(file: { path: string; sha256: string }, label: string): void {
  const filePath = path.join(repoRoot, file.path);
  const actual = createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
  if (actual !== file.sha256) {
    throw new Error(`${label} SHA-256 is ${actual}; expected ${file.sha256}`);
  }
}

function validateNetworkProofObservation(observation: NetworkProofObservation, caseName: string): void {
  const actualValues = [observation.requestToFulfillmentSeconds, observation.gasLimitPgu, observation.gasUsedPgu];
  if (observation.status !== 'fulfilled' && actualValues.some((value) => value !== null)) {
    throw new Error(`${caseName} has network measurements without a fulfilled proof request`);
  }
  if (observation.status === 'not_submitted' && observation.requestId !== null) {
    throw new Error(`${caseName} is marked not_submitted but has a network request ID`);
  }
  if (
    observation.status === 'fulfilled' &&
    (observation.requestId === null || actualValues.some((value) => value === null))
  ) {
    throw new Error(`${caseName} has an incomplete fulfilled network proof observation`);
  }
}

function validatePersistentWrapperObservation(observation: PersistentWrapperObservation): void {
  if (observation.classification !== 'single-local-observation') {
    throw new Error('Persistent wrapper benchmark must be classified as a single local observation');
  }
  if (!Number.isSafeInteger(observation.requestCount) || observation.requestCount < 1) {
    throw new Error('Persistent wrapper benchmark requestCount must be a positive integer');
  }
  if (observation.timings.proofSeconds.length !== observation.requestCount) {
    throw new Error('Persistent wrapper benchmark must record one proof time per request');
  }
  const positiveTimings = [
    observation.timings.processStartToReadinessSeconds,
    observation.timings.processTotalWallSeconds,
    ...observation.timings.proofSeconds,
  ];
  if (positiveTimings.some((value) => !Number.isFinite(value) || value <= 0)) {
    throw new Error('Persistent wrapper benchmark timings must be finite positive numbers');
  }
  const measuredWorkSeconds =
    observation.timings.processStartToReadinessSeconds +
    observation.timings.proofSeconds.reduce((total, value) => total + value, 0);
  if (observation.timings.processTotalWallSeconds < measuredWorkSeconds) {
    throw new Error('Persistent wrapper total wall time is shorter than readiness plus proof timings');
  }
  if (
    !Number.isSafeInteger(observation.resources.maximumResidentBytesApprox) ||
    observation.resources.maximumResidentBytesApprox <= 0
  ) {
    throw new Error('Persistent wrapper approximate peak resident memory must be a positive byte count');
  }
  if (!observation.resources.qualification.toLowerCase().includes('approximately')) {
    throw new Error('Persistent wrapper approximate peak resident memory must remain qualified');
  }
}

function validateHistoricalGroth16Attribution(provenance: Sp1Provenance): void {
  const source = provenance.guestRunner.cpuTuning.fullGroth16.runnerSource;
  if (source.relationship !== 'pre-alignment-prototype-not-the-current-attested-runner') {
    throw new Error('Historical Groth16 observation must remain attributed to the pre-alignment prototype');
  }
  if (!/^[0-9a-f]{40}$/.test(source.commit) || !/^[0-9a-f]{64}$/.test(source.sha256)) {
    throw new Error('Historical Groth16 runner attribution has an invalid commit or source SHA-256');
  }
  if (!provenance.guestRunner.cpuTuning.fullGroth16.inputRelationship.includes('intentionally differ')) {
    throw new Error('Historical Groth16 input differences must remain explicit');
  }
}

function aikenUnits(report: AikenCheckReport): Map<string, ExUnits> {
  const result = new Map<string, ExUnits>();
  for (const module of report.modules) {
    for (const test of module.tests) {
      const mem = test.execution_units?.mem;
      const cpu = test.execution_units?.cpu;
      if (typeof mem === 'number' && typeof cpu === 'number') {
        result.set(`${module.name}.${test.title}`, { mem: BigInt(mem), steps: BigInt(cpu) });
      }
    }
  }
  return result;
}

function requiredUnits(units: Map<string, ExUnits>, testName: string): ExUnits {
  const value = units.get(testName);
  if (!value) {
    throw new Error(`Aiken report is missing execution units for ${testName}`);
  }
  return value;
}

function numberFromDecimal(value: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`Expected a safe integer; found ${value}`);
  }
  return parsed;
}

function formatInteger(value: number): string {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value);
}

function formatPercent(value: number, limit: number): string {
  return `${((value / limit) * 100).toFixed(1)}%`;
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function svgPreamble(title: string, description: string, width: number, height: number): string[] {
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="chart-title chart-description">`,
    `  <title id="chart-title">${escapeXml(title)}</title>`,
    `  <desc id="chart-description">${escapeXml(description)}</desc>`,
    '  <defs>',
    '    <pattern id="direct-pattern" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">',
    '      <rect width="8" height="8" fill="#9a3412"/>',
    '      <line x1="0" y1="0" x2="0" y2="8" stroke="#fed7aa" stroke-width="2"/>',
    '    </pattern>',
    '    <style>',
    '      text { font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; fill: #111827; }',
    '      .title { font-size: 25px; font-weight: 700; }',
    '      .subtitle { font-size: 15px; fill: #374151; }',
    '      .metric { font-size: 17px; font-weight: 700; }',
    '      .label { font-size: 15px; font-weight: 600; }',
    '      .value { font-size: 14px; font-variant-numeric: tabular-nums; }',
    '      .value-light { font-size: 14px; font-variant-numeric: tabular-nums; fill: #ffffff; font-weight: 600; }',
    '      .axis { font-size: 13px; fill: #4b5563; }',
    '      .note { font-size: 13px; fill: #374151; }',
    '      .grid { stroke: #e5e7eb; stroke-width: 1; }',
    '      .limit { stroke: #111827; stroke-width: 2; stroke-dasharray: 7 5; }',
    '      .safe { stroke: #6b7280; stroke-width: 2; stroke-dasharray: 2 5; }',
    '    </style>',
    '  </defs>',
    `  <rect width="${width}" height="${height}" fill="#ffffff"/>`,
  ];
}

function renderComparisonSvg(rows: ComparisonRow[]): string {
  const width = 1080;
  const height = 720;
  const direct = rows.find((row) => row.id === 'direct');
  const sp1 = rows.find((row) => row.id === 'sp1');
  if (!direct || !sp1) {
    throw new Error('Comparison chart requires direct and SP1 rows');
  }

  const description =
    `For matching public outputs of a real adjacent 45-validator Injective transition at the one-to-two-state boundary, ` +
    `direct verification uses ${formatInteger(direct.signedBytes)} signed structural bytes, ` +
    `with summed Aiken contexts of ${formatInteger(direct.memory)} memory units and ${formatInteger(direct.cpu)} ` +
    `CPU steps. SP1 uses ${formatInteger(sp1.signedBytes)} structural bytes, with summed contexts of ` +
    `${formatInteger(sp1.memory)} memory units and ${formatInteger(sp1.cpu)} CPU steps. Limits are guides; ` +
    `the sums are not a full-transaction ledger evaluation.`;
  const lines = svgPreamble(
    'Structural size and Aiken context estimates for the matched Injective public transition',
    description,
    width,
    height,
  );
  lines.push(
    '  <text class="title" x="50" y="45">Structural size and Aiken estimates at the 45-validator boundary</text>',
    '  <text class="subtitle" x="50" y="72">Matched public transition; one retained consensus state becomes two</text>',
    '  <rect x="708" y="64" width="18" height="18" fill="url(#direct-pattern)"/>',
    '  <text class="axis" x="734" y="78">Direct</text>',
    '  <rect x="815" y="64" width="18" height="18" fill="#0369a1"/>',
    '  <text class="axis" x="841" y="78">SP1</text>',
    '  <line class="limit" x1="905" y1="73" x2="929" y2="73"/>',
    '  <text class="axis" x="937" y="78">pinned mainnet max</text>',
  );

  const metrics = [
    {
      label: 'Signed transaction bytes',
      direct: direct.signedBytes,
      sp1: sp1.signedBytes,
      networkMaximum: CARDANO_MAX_TX_SIZE_BYTES,
      safe: CARDANO_SAFE_TX_SIZE_BYTES,
    },
    {
      label: 'Memory-unit estimate (summed contexts)',
      direct: direct.memory,
      sp1: sp1.memory,
      networkMaximum: Number(CARDANO_MAX_TX_EX_MEM),
      safe: Number(CARDANO_SAFE_TX_EX_MEM),
    },
    {
      label: 'CPU-step estimate (summed contexts)',
      direct: direct.cpu,
      sp1: sp1.cpu,
      networkMaximum: Number(CARDANO_MAX_TX_EX_STEPS),
      safe: Number(CARDANO_SAFE_TX_EX_STEPS),
    },
  ];
  const chartX = 250;
  const chartWidth = 745;
  const sectionTops = [108, 286, 464];

  metrics.forEach((metric, metricIndex) => {
    const top = sectionTops[metricIndex];
    const max = Math.max(metric.direct, metric.sp1, metric.networkMaximum) * 1.08;
    const scale = (value: number) => chartX + (value / max) * chartWidth;
    const networkMaximumX = scale(metric.networkMaximum);
    const safeX = scale(metric.safe);
    lines.push(
      `  <text class="metric" x="50" y="${top + 18}">${escapeXml(metric.label)}</text>`,
      `  <line class="grid" x1="${chartX}" y1="${top + 34}" x2="${chartX + chartWidth}" y2="${top + 34}"/>`,
      `  <line class="grid" x1="${chartX}" y1="${top + 119}" x2="${chartX + chartWidth}" y2="${top + 119}"/>`,
      `  <line class="safe" x1="${safeX.toFixed(1)}" y1="${top + 29}" x2="${safeX.toFixed(1)}" y2="${top + 124}"/>`,
      `  <line class="limit" x1="${networkMaximumX.toFixed(1)}" y1="${top + 29}" x2="${networkMaximumX.toFixed(1)}" y2="${top + 124}"/>`,
      `  <text class="axis" text-anchor="middle" x="${safeX.toFixed(1)}" y="${top + 143}">safe ${formatInteger(metric.safe)}</text>`,
      `  <text class="axis" text-anchor="middle" x="${networkMaximumX.toFixed(1)}" y="${top + 160}">max ${formatInteger(metric.networkMaximum)}</text>`,
    );

    const bars = [
      { label: 'Direct', value: metric.direct, y: top + 45, fill: 'url(#direct-pattern)' },
      { label: 'SP1', value: metric.sp1, y: top + 88, fill: '#0369a1' },
    ];
    bars.forEach((bar) => {
      const end = scale(bar.value);
      const status =
        bar.value > metric.networkMaximum ? (metricIndex === 0 ? ' — over limit' : ' — sum exceeds limit') : '';
      const placeInside = end > 780;
      const valueX = placeInside ? end - 9 : end + 9;
      const valueAnchor = placeInside ? 'end' : 'start';
      const valueClass = placeInside ? 'value-light' : 'value';
      lines.push(
        `  <text class="label" text-anchor="end" x="${chartX - 14}" y="${bar.y + 20}">${bar.label}</text>`,
        `  <rect x="${chartX}" y="${bar.y}" width="${Math.max(2, end - chartX).toFixed(1)}" height="28" rx="3" fill="${bar.fill}"/>`,
        `  <text class="${valueClass}" text-anchor="${valueAnchor}" x="${valueX.toFixed(1)}" y="${bar.y + 20}">${formatInteger(bar.value)} (${formatPercent(bar.value, metric.networkMaximum)})${status}</text>`,
      );
    });
  });

  lines.push(
    '  <text class="note" x="50" y="667">Sizes are unbalanced structural lower bounds. Execution units are sums of isolated Aiken unit contexts.</text>',
    '  <text class="note" x="50" y="690">The sums are not a completed transaction evaluation and do not establish that SP1 fits the safe execution budget.</text>',
    '</svg>',
    '',
  );
  return lines.join('\n');
}

function roundUp(value: number, increment: number): number {
  return Math.ceil(value / increment) * increment;
}

function renderScalingSvg(rows: ScalingRow[], sp1SignedBytes: number): string {
  const width = 1080;
  const height = 650;
  const description =
    `Encoding-only direct transaction sizes are shown at ${rows.map((row) => row.validatorCount).join(', ')} ` +
    `validators. The SP1 guide is ${formatInteger(sp1SignedBytes)} bytes and validator-independent at this ` +
    `one-to-two-state/field-width boundary because validator data is absent from its Cardano payload. ` +
    `Transaction size can still vary with history and integer widths. Only the 45-validator point uses the real ` +
    `tracked proof and public-transition artifact.`;
  const lines = svgPreamble('Validator-count effect on Cardano transaction encoding', description, width, height);
  lines.push(
    '  <text class="title" x="50" y="45">Validator-count effect on Cardano transaction encoding</text>',
    '  <text class="subtitle" x="50" y="72">SP1 is validator-independent at this one-to-two-state/field-width boundary</text>',
  );

  const plot = { left: 105, right: 1015, top: 115, bottom: 515 };
  const maxValue = Math.max(...rows.map((row) => row.directSignedBytes), sp1SignedBytes);
  const yIncrement = maxValue > 50_000 ? 20_000 : maxValue > 25_000 ? 10_000 : 5_000;
  const yMax = roundUp(maxValue * 1.08, yIncrement);
  const minimumValidatorCount = Math.min(...rows.map((row) => row.validatorCount));
  const maximumValidatorCount = Math.max(...rows.map((row) => row.validatorCount));
  const validatorCountRange = Math.max(1, maximumValidatorCount - minimumValidatorCount);
  const xFor = (validatorCount: number) =>
    plot.left + ((validatorCount - minimumValidatorCount) / validatorCountRange) * (plot.right - plot.left);
  const yFor = (value: number) => plot.bottom - (value / yMax) * (plot.bottom - plot.top);

  for (let value = 0; value <= yMax; value += yIncrement) {
    const y = yFor(value);
    lines.push(
      `  <line class="grid" x1="${plot.left}" y1="${y.toFixed(1)}" x2="${plot.right}" y2="${y.toFixed(1)}"/>`,
      `  <text class="axis" text-anchor="end" x="${plot.left - 12}" y="${(y + 5).toFixed(1)}">${formatInteger(value)}</text>`,
    );
  }

  const safeY = yFor(CARDANO_SAFE_TX_SIZE_BYTES);
  const networkMaximumY = yFor(CARDANO_MAX_TX_SIZE_BYTES);
  const sp1Y = yFor(sp1SignedBytes);
  lines.push(
    `  <line class="safe" x1="${plot.left}" y1="${safeY.toFixed(1)}" x2="${plot.right}" y2="${safeY.toFixed(1)}"/>`,
    `  <text class="axis" x="${plot.right - 250}" y="${(safeY + 19).toFixed(1)}">project safe size ${formatInteger(CARDANO_SAFE_TX_SIZE_BYTES)}</text>`,
    `  <line class="limit" x1="${plot.left}" y1="${networkMaximumY.toFixed(1)}" x2="${plot.right}" y2="${networkMaximumY.toFixed(1)}"/>`,
    `  <text class="axis" x="${plot.right - 250}" y="${(networkMaximumY - 7).toFixed(1)}">pinned mainnet maxTxSize ${formatInteger(CARDANO_MAX_TX_SIZE_BYTES)}</text>`,
    `  <line x1="${plot.left}" y1="${sp1Y.toFixed(1)}" x2="${plot.right}" y2="${sp1Y.toFixed(1)}" stroke="#0369a1" stroke-width="3" stroke-dasharray="10 5"/>`,
    `  <text class="label" fill="#0369a1" text-anchor="end" x="${plot.right}" y="${(sp1Y - 10).toFixed(1)}">SP1 validator-independent at this boundary: ${formatInteger(sp1SignedBytes)} bytes</text>`,
  );

  const points = rows.map((row) => ({ x: xFor(row.validatorCount), y: yFor(row.directSignedBytes) }));
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    lines.push(
      `  <line x1="${previous.x.toFixed(1)}" y1="${previous.y.toFixed(1)}" x2="${current.x.toFixed(1)}" y2="${current.y.toFixed(1)}" stroke="#111827" stroke-width="5" stroke-linecap="round"/>`,
    );
  }
  rows.forEach((row) => {
    const x = xFor(row.validatorCount);
    const y = yFor(row.directSignedBytes);
    const labelY = y - 13;
    lines.push(
      `  <circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="7" fill="url(#direct-pattern)" stroke="#7c2d12" stroke-width="2"/>`,
      `  <text class="value" text-anchor="middle" x="${x.toFixed(1)}" y="${labelY.toFixed(1)}">${formatInteger(row.directSignedBytes)}</text>`,
      `  <text class="axis" text-anchor="middle" x="${x.toFixed(1)}" y="${plot.bottom + 28}">${row.validatorCount}</text>`,
    );
  });
  lines.push(
    `  <text class="label" text-anchor="middle" x="${(plot.left + plot.right) / 2}" y="${plot.bottom + 58}">Tendermint validators</text>`,
    '  <text class="axis" transform="translate(27 345) rotate(-90)" text-anchor="middle">Structural signed bytes</text>',
    '  <text class="note" x="50" y="597">The resized direct cases preserve production field widths but are not valid Tendermint headers. They measure encoding growth only.</text>',
    '  <text class="note" x="50" y="620">Do not infer proving latency or a validator-count ceiling from this chart; the generated 200-validator SP1 case was only mock-proved.</text>',
    '</svg>',
    '',
  );
  return lines.join('\n');
}

let cachedLocalAikenModules: Map<string, string> | undefined;

function localAikenModules(): Map<string, string> {
  if (cachedLocalAikenModules) {
    return cachedLocalAikenModules;
  }
  const modules = new Map<string, string>();
  const visit = (directory: string, modulePrefix: string) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      const normalizedName = entry.name.replaceAll('-', '_');
      if (entry.isDirectory()) {
        visit(entryPath, modulePrefix ? `${modulePrefix}/${normalizedName}` : normalizedName);
      } else if (entry.isFile() && entry.name.endsWith('.ak') && !entry.name.endsWith('.test.ak')) {
        const basename = normalizedName.slice(0, -3);
        modules.set(modulePrefix ? `${modulePrefix}/${basename}` : basename, entryPath);
      }
    }
  };
  visit(path.join(onchainRoot, 'lib'), '');
  visit(path.join(onchainRoot, 'validators'), '');
  cachedLocalAikenModules = modules;
  return modules;
}

function resolveLocalAikenModule(moduleName: string): string | undefined {
  return localAikenModules().get(moduleName);
}

function aikenImportClosure(entryPoints: string[]): Set<string> {
  const closure = new Set<string>();
  const pending = [...entryPoints];
  while (pending.length > 0) {
    const filePath = path.resolve(pending.pop()!);
    if (closure.has(filePath)) {
      continue;
    }
    if (!fs.existsSync(filePath)) {
      throw new Error(`Missing Aiken entry point: ${filePath}`);
    }
    closure.add(filePath);
    const source = fs.readFileSync(filePath, 'utf8');
    for (const match of source.matchAll(/^\s*use\s+([a-zA-Z0-9_/-]+)/gm)) {
      const imported = resolveLocalAikenModule(match[1]);
      if (imported && !closure.has(imported)) {
        pending.push(imported);
      }
    }
  }
  return closure;
}

function sourceLines(filePath: string): number {
  return fs
    .readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .filter((line) => {
      const trimmed = line.trim();
      return trimmed.length > 0 && !trimmed.startsWith('//');
    }).length;
}

function summarizeFiles(files: Set<string>) {
  return {
    files: files.size,
    sourceLines: [...files].reduce((total, filePath) => total + sourceLines(filePath), 0),
  };
}

function difference(left: Set<string>, right: Set<string>): Set<string> {
  return new Set([...left].filter((value) => !right.has(value)));
}

function intersection(left: Set<string>, right: Set<string>): Set<string> {
  return new Set([...left].filter((value) => right.has(value)));
}

function blueprintScriptBytes() {
  const blueprint = readJson<{ validators: Array<{ title: string; compiledCode: string }> }>(blueprintPath);
  const bytes = (title: string) => {
    const validator = blueprint.validators.find((candidate) => candidate.title === title);
    if (!validator) {
      throw new Error(`Blueprint is missing ${title}`);
    }
    return validator.compiledCode.length / 2;
  };
  return {
    directClient: bytes('spending_client_legacy.spend_client.spend'),
    sp1Client: bytes('spending_client.spend_client.spend'),
    sp1ProofWithdrawal: bytes('withdraw_tendermint_update.verify_tendermint_update.withdraw'),
  };
}

function implementationSurface() {
  const direct = aikenImportClosure([path.join(onchainRoot, 'validators/spending_client_legacy.ak')]);
  const sp1 = aikenImportClosure([
    path.join(onchainRoot, 'validators/spending_client.ak'),
    path.join(onchainRoot, 'validators/withdraw_tendermint_update.ak'),
  ]);
  return {
    method:
      'Nonblank, non-comment Aiken source lines in the transitive local-import closure; tests and generated fixtures are excluded unless imported by an entry point.',
    directReachable: summarizeFiles(direct),
    sp1Reachable: summarizeFiles(sp1),
    directOnly: summarizeFiles(difference(direct, sp1)),
    sp1Only: summarizeFiles(difference(sp1, direct)),
    shared: summarizeFiles(intersection(direct, sp1)),
    entryPoints: {
      direct: ['cardano/onchain/validators/spending_client_legacy.ak'],
      sp1: [
        'cardano/onchain/validators/spending_client.ak',
        'cardano/onchain/validators/withdraw_tendermint_update.ak',
      ],
    },
    unparameterizedBlueprintBytes: blueprintScriptBytes(),
  };
}

function checkOrWrite(filePath: string, content: string, write: boolean): boolean {
  if (write) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content);
    console.log(`wrote ${path.relative(repoRoot, filePath)}`);
    return true;
  }
  const existing = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : undefined;
  if (existing !== content) {
    console.error(`${path.relative(repoRoot, filePath)} is missing or stale; rerun with --write`);
    return false;
  }
  console.log(`checked ${path.relative(repoRoot, filePath)}`);
  return true;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const aikenReport = readJson<AikenCheckReport>(options.aikenReportPath);
  const units = aikenUnits(aikenReport);
  const directExUnits: StructuralExUnits = {
    hostState: requiredUnits(units, testNames.hostState),
    spendClient: requiredUnits(units, testNames.directClient),
  };
  const proofExUnits: ProofStructuralExUnits = {
    hostState: requiredUnits(units, testNames.hostState),
    spendClient: requiredUnits(units, testNames.proofClient),
    tendermintProof: requiredUnits(units, testNames.tendermintProof),
  };

  const fixture = loadNormalizedCapacityFixture();
  const scenario = fixture.scenarios.adjacent_all_signed;
  const [directArtifact, proofArtifact] = await Promise.all([
    analyzeCapacityScenario('adjacent_all_signed_direct', scenario, directExUnits, 'aiken-unit-tests'),
    analyzeProofCapacityScenario('adjacent_all_signed_sp1', scenario, proofExUnits, 'aiken-unit-tests'),
  ]);
  const comparison: ComparisonRow[] = [
    {
      id: 'direct',
      label: 'Direct Aiken verification',
      signedBytes: directArtifact.report.signedBytes,
      memory: numberFromDecimal(directArtifact.report.scriptExUnits.total.mem),
      cpu: numberFromDecimal(directArtifact.report.scriptExUnits.total.steps),
      report: directArtifact.report,
    },
    {
      id: 'sp1',
      label: 'SP1 proof verification',
      signedBytes: proofArtifact.report.signedBytes,
      memory: numberFromDecimal(proofArtifact.report.scriptExUnits.total.mem),
      cpu: numberFromDecimal(proofArtifact.report.scriptExUnits.total.steps),
      report: proofArtifact.report,
    },
  ];

  const scaling: ScalingRow[] = [];
  for (const validatorCount of validatorCounts) {
    const resized = resizeCapacityScenario(scenario, validatorCount);
    const artifact = await analyzeCapacityScenario(
      `encoding_only_direct_${validatorCount}`,
      resized,
      STRUCTURAL_PLACEHOLDER_EX_UNITS,
      'structural-placeholder',
    );
    scaling.push({ validatorCount, directSignedBytes: artifact.report.signedBytes });
  }

  const provenance = readJson<Sp1Provenance>(provenancePath);
  validateProvenanceFile(provenance.guestRunner.source, 'SP1 guest runner source');
  validateProvenanceFile(provenance.guestRunner.cpuBenchmarkScript, 'SP1 CPU benchmark script');
  validateProvenanceFile(provenance.guestRunner.cargoLock, 'SP1 guest runner Cargo.lock');
  validateProvenanceFile(provenance.guestRunner.cargoManifest, 'SP1 guest runner Cargo.toml');
  const persistentWrapper = provenance.proverService.persistentWrapperBenchmark;
  validateProvenanceFile(persistentWrapper.fixture, 'persistent wrapper benchmark fixture');
  validateProvenanceFile(persistentWrapper.benchmarkScript, 'persistent wrapper benchmark script');
  validatePersistentWrapperObservation(persistentWrapper);
  validateHistoricalGroth16Attribution(provenance);
  const selectedAikenUnitContexts = Object.entries(testNames).map(([role, test]) => {
    const measured = requiredUnits(units, test);
    return {
      role,
      test,
      memory: Number(measured.mem),
      cpu: Number(measured.steps),
    };
  });
  const selectedAikenUnitContextsSha256 = createHash('sha256')
    .update(JSON.stringify(selectedAikenUnitContexts))
    .digest('hex');
  const injectiveProof = provenance.proverService.injective45Regression;
  const injectiveGuest = provenance.guestExecutions.find((observation) => observation.case === 'injective-45');
  const syntheticGuest = provenance.guestExecutions.find((observation) => observation.case === 'synthetic-200');
  if (!injectiveGuest || !syntheticGuest) {
    throw new Error('SP1 provenance must contain injective-45 and synthetic-200 guest observations');
  }
  validateNetworkProofObservation(injectiveGuest.networkProof, injectiveGuest.case);
  validateNetworkProofObservation(syntheticGuest.networkProof, syntheticGuest.case);
  const normalizedHeader = scenario.header;
  const commitFlags = normalizedHeader.signed_header.commit.signatures.map((signature) =>
    Number(signature.block_id_flag),
  );
  const data = {
    schemaVersion: 2,
    benchmarkBoundary: {
      fixture: path.relative(repoRoot, DEFAULT_NORMALIZED_FIXTURE_PATH),
      scenario: 'adjacent_all_signed',
      chainId: normalizedHeader.signed_header.header.chain_id,
      trustedHeight: String(normalizedHeader.trusted_height.revision_height),
      newHeight: String(normalizedHeader.signed_header.header.height),
      validators: normalizedHeader.validator_set.validators.length,
      commitSlots: {
        commit: commitFlags.filter((flag) => flag === 2).length,
        absent: commitFlags.filter((flag) => flag === 1).length,
        nil: commitFlags.filter((flag) => flag === 3).length,
      },
      consensusHistory: { input: 1, output: 2, removed: 0 },
      samePublicTransitionForBothPaths: true,
      rawHeaderIdentityVerified: false,
    },
    protocolParameterSnapshot: {
      network: 'Cardano mainnet',
      epoch: 651,
      checkedOn: '2026-08-27',
      source: 'https://api.koios.rest/api/v1/epoch_params?epoch_no=eq.651',
      repositoryRecord: 'docs/caribic-network-limits.md',
    },
    limits: {
      signedBytes: {
        pinnedMainnetMaximum: CARDANO_MAX_TX_SIZE_BYTES,
        projectSafe: CARDANO_SAFE_TX_SIZE_BYTES,
      },
      memory: {
        pinnedMainnetMaximum: Number(CARDANO_MAX_TX_EX_MEM),
        projectSafe: Number(CARDANO_SAFE_TX_EX_MEM),
      },
      cpu: {
        pinnedMainnetMaximum: Number(CARDANO_MAX_TX_EX_STEPS),
        projectSafe: Number(CARDANO_SAFE_TX_EX_STEPS),
      },
    },
    aikenEvaluationContext: {
      tool: 'Aiken',
      version: provenance.cardanoGroth16Verifier.aikenVersion,
      evaluator: 'aiken check unit-test evaluator',
      currentMainnetCostModelParityVerified: false,
      selectedUnitContexts: selectedAikenUnitContexts,
      selectedUnitContextsSha256: selectedAikenUnitContextsSha256,
    },
    cardanoComparison: comparison.map((row) => ({
      id: row.id,
      label: row.label,
      signedBytes: row.signedBytes,
      memory: row.memory,
      cpu: row.cpu,
      pinnedMainnetSizeMargin: row.report.absoluteSizeMarginBytes,
      pinnedMainnetMemoryMargin: numberFromDecimal(row.report.scriptExUnits.absoluteMargin.mem),
      pinnedMainnetCpuMargin: numberFromDecimal(row.report.scriptExUnits.absoluteMargin.steps),
      payloads: row.report.payloads,
      transactionShape: row.report.shape,
      classification: row.report.classification,
      ledgerEvaluated: row.report.ledgerEvaluated,
      providerCompleted: row.report.providerCompleted,
      balanced: row.report.balanced,
      exUnitsSource: row.report.exUnitsSource,
      exUnitsClassification: 'summed-isolated-aiken-unit-context-estimate',
      exUnitTests:
        row.id === 'direct'
          ? [testNames.hostState, testNames.directClient]
          : [testNames.hostState, testNames.proofClient, testNames.tendermintProof],
    })),
    validatorScaling: {
      classification: 'encoding-only-synthetic-resize',
      direct: scaling,
      sp1BoundarySignedBytes: proofArtifact.report.signedBytes,
      qualification:
        'Resized direct cases preserve production field widths but are not consensus-valid headers. The SP1 line is validator-independent at this one-to-two-state/field-width boundary; transaction size can still vary with history and integer widths. Only its 45-validator point uses the tracked proof and public-transition artifact.',
    },
    sp1GuestObservations: [
      {
        id: injectiveGuest.case,
        fixture: injectiveGuest.fixture,
        validators: injectiveGuest.validators,
        measuredAtUnixSeconds: injectiveGuest.measuredAtUnixSeconds,
        executeSeconds: injectiveGuest.executeSeconds,
        instructions: injectiveGuest.instructions,
        syscalls: injectiveGuest.syscalls,
        localEstimatedPgu: injectiveGuest.localEstimatedPgu,
        publicValuesSha256: injectiveGuest.publicValuesSha256,
        networkProof: injectiveGuest.networkProof,
        proofStatus: injectiveGuest.executionStatus,
        proveSeconds: injectiveProof.sp1ProveSeconds,
        peakResidentBytes: injectiveProof.sp1PeakResidentBytes,
        wrapperKeyLoadSeconds: injectiveProof.wrapperKeyLoadSeconds,
        outerWrapperSeconds: injectiveProof.outerWrapperSeconds,
      },
      {
        id: syntheticGuest.case,
        fixture: syntheticGuest.fixture,
        validators: syntheticGuest.validators,
        measuredAtUnixSeconds: syntheticGuest.measuredAtUnixSeconds,
        executeSeconds: syntheticGuest.executeSeconds,
        instructions: syntheticGuest.instructions,
        syscalls: syntheticGuest.syscalls,
        localEstimatedPgu: syntheticGuest.localEstimatedPgu,
        publicValuesSha256: syntheticGuest.publicValuesSha256,
        networkProof: syntheticGuest.networkProof,
        proofStatus: syntheticGuest.executionStatus,
        proveSeconds: null,
        peakResidentBytes: null,
        wrapperKeyLoadSeconds: null,
        outerWrapperSeconds: null,
      },
    ],
    sp1GuestObservationProvenance: provenance.guestRunner,
    persistentWrapperObservation: persistentWrapper,
    implementationSurface: implementationSurface(),
    caveats: [
      'Signed sizes are deterministic structural lower bounds, not balanced or provider-completed transactions.',
      'Execution units are sums of isolated Aiken unit contexts, not values extracted from a completed ledger evaluation.',
      'The Aiken unit-test evaluator and its cost model have not been verified as current-mainnet cost-model parity; execution margins are branch-local estimates.',
      'The summed SP1 contexts do not all carry the modeled three-input, two-output, three-redeemer transaction; a matched full-transaction ledger evaluation is still required.',
      'The 10-state SP1 transaction-budget gate uses coarse payload-size placeholders and is intentionally excluded from this matched comparison.',
      'No fee, confirmation latency, throughput, or infrastructure-cost comparison has been measured.',
      'No network proof request was submitted for either execution benchmark; network proof latency and actual network PGU use remain unmeasured.',
      'The 45-validator proving latency and peak memory are one local development observation; hardware metadata and repeated-run statistics were not recorded.',
      'The persistent-wrapper startup, two proof timings, total wall time, and approximate peak memory are one Apple M5 process observation, not a latency distribution.',
      'Execution latency and local estimated PGU are single Apple M5 observations. Instructions, syscalls, and local estimated PGU use SP1 6.1.0; CI verifies the pinned runner source, Cargo.toml, and Cargo.lock hashes but does not rerun the guest.',
      'The synthetic 200-validator case was executed and mock-proved; no full SP1 Groth16 or wrapped proof was generated or timed.',
    ],
    sources: {
      proofProvenance: path.relative(repoRoot, provenancePath),
      aikenExecutionUnits: 'generated Aiken JSON supplied through --aiken-report',
      generator: path.relative(repoRoot, __filename),
    },
  };

  const outputs = [
    [dataPath, `${JSON.stringify(data, null, 2)}\n`],
    [comparisonSvgPath, renderComparisonSvg(comparison)],
    [scalingSvgPath, renderScalingSvg(scaling, proofArtifact.report.signedBytes)],
  ] as const;
  const ok = outputs.map(([filePath, content]) => checkOrWrite(filePath, content, options.write)).every(Boolean);
  if (!ok) {
    process.exitCode = 1;
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? (error.stack ?? error.message) : error);
  process.exitCode = 1;
});
