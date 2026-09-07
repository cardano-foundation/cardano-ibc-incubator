import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

export const fixtures = [
  ['host_state', 'host_state_stt.host_state_stt.spend', 'host_state_stt.test',
    'host_update_client_capacity_minimum_history_succeeds'],
  ['adjacent_all_signed', 'spending_client.spend_client.spend', 'spending_client_capacity.test',
    'update_client_capacity_adjacent_all_signed_45_succeeds'],
  ['adjacent_mixed', 'spending_client.spend_client.spend', 'spending_client_capacity.test',
    'update_client_capacity_adjacent_mixed_45_succeeds'],
  ['non_adjacent_mixed', 'spending_client.spend_client.spend', 'spending_client_capacity.test',
    'update_client_capacity_non_adjacent_mixed_45_succeeds'],
];

function passingTest(report, moduleName, title) {
  const matches = report.modules?.filter((module) => module.name === moduleName)
    .flatMap((module) => module.tests ?? []).filter((test) => test.title === title) ?? [];
  if (matches.length !== 1 || matches[0].status !== 'pass') {
    throw new Error(`Expected one passing test: ${moduleName}.${title}`);
  }
  return matches[0];
}

export function extractFixtures(report) {
  const exported = new Map();
  for (const [moduleName, title] of [
    ['host_state_stt.test', 'export_capacity_calibration_fixture'],
    ['spending_client_capacity.test', 'export_capacity_calibration_fixtures'],
  ]) {
    const test = passingTest(report, moduleName, title);
    for (const trace of test.traces ?? []) {
      const match = /^budget-calibration:([a-z_]+): h'([\da-f]+)'$/i.exec(trace);
      if (!match) continue;
      if (exported.has(match[1])) throw new Error(`Duplicate exported fixture: ${match[1]}`);
      exported.set(match[1], match[2].toLowerCase());
    }
  }
  for (const [name] of fixtures) {
    if (!exported.has(name)) throw new Error(`Missing exported fixture: ${name}`);
  }
  if (exported.size !== fixtures.length) throw new Error('Unexpected exported fixture');
  return exported;
}

export function executionUnits(value) {
  if (!value || !['mem', 'cpu'].every((key) => Number.isSafeInteger(value[key]) && value[key] >= 0)) {
    throw new Error('Invalid execution units');
  }
  return { mem: value.mem, cpu: value.cpu };
}

export function compareFixture(name, helper, compiled) {
  helper = executionUnits(helper);
  compiled = executionUnits(compiled);
  return {
    fixture: name,
    helper,
    compiled,
    difference: { mem: compiled.mem - helper.mem, cpu: compiled.cpu - helper.cpu },
  };
}

export function productionValidator(blueprint, title) {
  const compiler = blueprint.preamble?.compiler;
  if (compiler?.name !== 'Aiken' || !/^v?1\.1\.21(?:\+[\da-f]+)?$/.test(compiler.version)
      || blueprint.preamble?.plutusVersion !== 'v3') {
    throw new Error('Calibration requires a Plutus V3 blueprint built with Aiken v1.1.21');
  }
  const matches = blueprint.validators?.filter((entry) => entry.title === title) ?? [];
  if (matches.length !== 1) throw new Error(`Expected one production validator: ${title}`);
  return matches[0];
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} failed (${result.status}):\n${result.stderr}\n${result.stdout}`);
  }
  return result.stdout;
}

export function calibrate({ aikenReportPath, blueprintPath, exportReportPath }) {
  const aikenReport = JSON.parse(readFileSync(aikenReportPath, 'utf8'));
  const blueprint = JSON.parse(readFileSync(blueprintPath, 'utf8'));
  // Export tests deliberately retain traces. Their costs are never measured.
  const exportReport = exportReportPath
    ? JSON.parse(readFileSync(exportReportPath, 'utf8'))
    : JSON.parse(run('aiken', [
      'check', '--deny', '--trace-level', 'verbose', '--exact-match',
      '-m', 'spending_client_capacity.{export_capacity_calibration_fixtures}',
      '-m', 'host_state_stt.{export_capacity_calibration_fixture}',
    ], { cwd: resolve(repositoryRoot, 'cardano/onchain') }));
  const exported = extractFixtures(exportReport);
  const manifest = resolve(repositoryRoot, 'scripts/ci/aiken-budget-evaluator/Cargo.toml');
  const targetDirectory = resolve(dirname(manifest), 'target');
  console.error('Building the pinned UPLC evaluator');
  run('cargo', ['build', '--locked', '--release', '--manifest-path', manifest, '--target-dir', targetDirectory]);
  const evaluator = resolve(targetDirectory, 'release/aiken-budget-evaluator');
  let diagnosticBudget;
  const samples = fixtures.map(([name, title, moduleName, testTitle]) => {
    const validator = productionValidator(blueprint, title);
    const measurement = JSON.parse(run(evaluator, [], {
      input: JSON.stringify({ compiledCode: validator.compiledCode, argumentsCbor: exported.get(name) }),
    }));
    const compiled = executionUnits(measurement.executionUnits);
    const budget = executionUnits(measurement.diagnosticBudget);
    if (diagnosticBudget && (budget.mem !== diagnosticBudget.mem || budget.cpu !== diagnosticBudget.cpu)) {
      throw new Error('Evaluator diagnostic budget changed between fixtures');
    }
    diagnosticBudget = budget;
    console.error(`Evaluated ${name}: ${compiled.mem} memory, ${compiled.cpu} CPU`);
    return {
      ...compareFixture(name, passingTest(aikenReport, moduleName, testTitle).execution_units, compiled),
      validator: title,
      blueprintHash: validator.hash,
    };
  });
  return {
    schemaVersion: 1,
    measurement: 'compiled-validator-fixture-calibration',
    ledgerEvaluated: false,
    evaluator: {
      name: 'uplc',
      version: '1.1.21',
      costModel: 'built-in Plutus V3 defaults',
      diagnosticBudget,
      expectedBuildTraceLevel: 'silent',
    },
    note: 'Each sample reuses one unit-test fixture. These are not a combined transaction or a ledger admissibility check.',
    samples,
  };
}

function main(args) {
  if (args.includes('--help')) {
    console.log('Usage: node scripts/ci/calibrate-aiken-budgets.mjs --aiken-report FILE [--blueprint FILE] [--export-report FILE]');
    return;
  }
  const options = { blueprintPath: resolve(repositoryRoot, 'cardano/onchain/plutus.json') };
  const names = { '--aiken-report': 'aikenReportPath', '--blueprint': 'blueprintPath', '--export-report': 'exportReportPath' };
  for (let index = 0; index < args.length; index += 2) {
    const name = names[args[index]];
    if (!name || !args[index + 1]) throw new Error(`Unknown or incomplete argument: ${args[index]}`);
    options[name] = resolve(args[index + 1]);
  }
  if (!options.aikenReportPath) throw new Error('--aiken-report is required');
  console.log(JSON.stringify(calibrate(options), null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
