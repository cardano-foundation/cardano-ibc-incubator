import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  aikenSemanticSignature,
  classifyAikenChanges,
  classifyCiWorkflowChange,
} from './detect-aiken-semantic-changes.mjs';

test('scopes edits to existing workflow jobs and falls back for shared changes', () => {
  const source = readFileSync(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8');
  const gatewayEdit = source.replace(
    '      - name: Check collateral selection against Hermes policy',
    '      - name: Check gateway collateral',
  );
  assert.notEqual(gatewayEdit, source);
  assert.deepEqual(classifyCiWorkflowChange(source, gatewayEdit), { relevant: false, fuzz: false });

  const budgetEdit = source.replace('      - name: Collect Aiken execution units', '      - name: Collect budget units');
  assert.notEqual(budgetEdit, source);
  assert.deepEqual(classifyCiWorkflowChange(source, budgetEdit), { relevant: true, fuzz: false });

  for (const changed of [
    source.replace('    name: Cardano Onchain Aiken Property/Fuzz', '    name: Validator fuzz tests'),
    source.replace('  CI: true', '  CI: false'),
    `${source}\n  new-job:\n    runs-on: ubuntu-latest\n`,
    source.replace('  gateway:', '  gateway: &shared-job'),
  ]) {
    assert.notEqual(changed, source);
    assert.deepEqual(classifyCiWorkflowChange(source, changed), { relevant: true, fuzz: true });
  }
  assert.deepEqual(classifyCiWorkflowChange(undefined, source), { relevant: true, fuzz: true });
  assert.deepEqual(classifyCiWorkflowChange(source, 'jobs: {}'), { relevant: true, fuzz: true });
});

test('separates transaction inputs from validator and fuzz infrastructure changes', () => {
  const repo = mkdtempSync(join(tmpdir(), 'aiken-suite-detector-'));
  try {
    execFileSync('git', ['init', '-q'], { cwd: repo });
    execFileSync('git', ['config', 'user.email', 'ci@example.com'], { cwd: repo });
    execFileSync('git', ['config', 'user.name', 'CI'], { cwd: repo });
    execFileSync('git', ['commit', '--allow-empty', '-qm', 'base'], { cwd: repo });
    for (const [path, relevant, fuzz] of [
      ['cardano/gateway/package.json', true, false],
      ['cardano/gateway/package-lock.json', true, false],
      ['cardano/offchain/src/deployment.ts', true, false],
      ['cardano/gateway/src/shared/types/channel/channel-datum.ts', true, false],
      ['packages/cardano-ibc-tx-builder-runtime/package-lock.json', true, false],
      ['chains/cardano/config/devnet/genesis-conway.json', true, false],
      ['scripts/ci/collect-cardano-tx-budget-units.sh', true, false],
      ['cardano/onchain/aiken.lock', true, true],
      ['cardano/onchain/validators/new.ak', true, true],
      ['scripts/ci/check-aiken-fuzz-coverage.mjs', true, true],
      ['scripts/ci/check-aiken-layering.sh', true, true],
      ['scripts/ci/detect-aiken-semantic-changes.mjs', true, true],
      ['.github/actions/setup/action.yml', true, true],
      ['cardano/gateway/src/query/query.controller.ts', false, false],
    ]) {
      const target = join(repo, path);
      mkdirSync(join(target, '..'), { recursive: true });
      writeFileSync(target, '// changed\n');
      execFileSync('git', ['add', '.'], { cwd: repo });
      execFileSync('git', ['commit', '-qm', path], { cwd: repo });
      const result = classifyAikenChanges(repo, 'HEAD^', 'HEAD');
      assert.equal(result.aikenRelevantChanged, relevant, path);
      assert.equal(result.aikenFuzzChanged, fuzz, path);
    }
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('aggregate requires budgets without fuzz and rejects failed required jobs', () => {
  const workflow = readFileSync(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8');
  const aggregate = workflow.slice(workflow.indexOf('  aiken:\n'), workflow.indexOf('  tx-budgets:\n'));
  const script = aggregate.match(/node - <<'NODE'\n([\s\S]*?)\n          NODE/)[1]
    .replace(/^          /gm, '');
  const run = (fuzz, overrides = {}, changed = 'true') => {
    const needs = Object.fromEntries([
      'aiken-changes', 'aiken-static', 'generated-artifacts', 'tx-budgets',
      'aiken-smoke', 'aiken-fuzz', 'aiken-mutations', 'deno-offchain', 'deno-funds',
    ].map((name) => [name, { result: !fuzz && ['aiken-smoke', 'aiken-fuzz', 'aiken-mutations'].includes(name) ? 'skipped' : 'success' }]));
    for (const [name, result] of Object.entries(overrides)) needs[name] = { result };
    return execFileSync(process.execPath, ['-e', script], {
      env: {
        ...process.env,
        AIKEN_CHANGED: changed,
        AIKEN_FILES_CHANGED: 'false',
        AIKEN_PR_CHANGED: changed,
        AIKEN_FUZZ_CHANGED: String(fuzz),
        NEEDS_JSON: JSON.stringify(needs),
      },
      stdio: 'pipe',
    });
  };
  assert.doesNotThrow(() => run(false));
  assert.throws(() => run(false, { 'deno-offchain': 'failure' }));
  assert.throws(() => run(true, { 'deno-offchain': 'skipped' }));
  assert.throws(() => run(false, { 'deno-funds': 'failure' }));
  assert.throws(() => run(true, { 'deno-funds': 'skipped' }));
  assert.throws(() => run(false, { 'tx-budgets': 'failure' }));
  assert.throws(() => run(false, { 'tx-budgets': 'skipped' }));
  assert.doesNotThrow(() => run(true));
  assert.throws(() => run(true, { 'aiken-fuzz': 'skipped' }));
  assert.throws(() => run(true, { 'aiken-mutations': 'failure' }));
  assert.throws(() => run(true, { 'aiken-smoke': 'failure' }));
  assert.throws(() => run(false, {}, 'invalid'));
  assert.doesNotThrow(() => run(false, { 'tx-budgets': 'skipped', 'aiken-static': 'skipped' }, 'false'));
});

test('ignores ordinary standalone, trailing, and nested line-comment text', () => {
  const before = `
pub fn value() {
  let url = "//uatom"
  url
}
`;
  const after = `
// A comment containing "quotes", #"bytes", and // another marker.
pub fn value() { // trailing comment
  let url = "//uatom" // unchanged literal
  // let ignored = @"commented-out code"
  url
}
`;
  assert.equal(aikenSemanticSignature(after), aikenSemanticSignature(before));
});

test('preserves comment markers and escapes inside every quoted literal form', () => {
  const before = `test value() {
    "\\\"//bare" == #"2f2f" && @"//text" == @"//text"
  }`;
  const after = before.replace('2f2f', '2f30');
  assert.notEqual(aikenSemanticSignature(after), aikenSemanticSignature(before));
  assert.doesNotThrow(() =>
    aikenSemanticSignature(String.raw`let value = "\\" // unmatched "`),
  );
});

test('preserves multiline literals and treats block-comment markers as code', () => {
  const multiline = `let value = "first
// still literal"`;
  assert.match(aikenSemanticSignature(multiline), /\/\/ still literal/);
  assert.notEqual(
    aikenSemanticSignature('let value = "first\r\nsecond"'),
    aikenSemanticSignature('let value = "first\nsecond"'),
  );
  assert.notEqual(
    aikenSemanticSignature('let value = "first\rsecond"'),
    aikenSemanticSignature('let value = "first\nsecond"'),
  );
  assert.notEqual(
    aikenSemanticSignature('let value = 1 /* marker */'),
    aikenSemanticSignature('let value = 1 /* changed */'),
  );
});

test('treats documentation comments and real code edits as relevant', () => {
  assert.notEqual(
    aikenSemanticSignature('/// old docs\npub fn value() { 1 }'),
    aikenSemanticSignature('/// new docs\npub fn value() { 1 }'),
  );
  assert.notEqual(
    aikenSemanticSignature('pub fn value() { foo bar }'),
    aikenSemanticSignature('pub fn value() { foobar }'),
  );
  assert.notEqual(
    aikenSemanticSignature('pub fn value() { #[0] }'),
    aikenSemanticSignature('pub fn value() { #[1] }'),
  );
  assert.notEqual(
    aikenSemanticSignature('pub fn value() { 1 - 2 }'),
    aikenSemanticSignature('pub fn value() { 1\n- 2 }'),
  );
  assert.notEqual(
    aikenSemanticSignature('pub fn value() { apply(1) }'),
    aikenSemanticSignature('pub fn value() { apply\n(1) }'),
  );
  assert.notEqual(
    aikenSemanticSignature('pub fn value() { 1 |> apply }'),
    aikenSemanticSignature('pub fn value() { 1\n|> apply }'),
  );
  assert.notEqual(
    aikenSemanticSignature('/// must match\nexpect value == 1'),
    aikenSemanticSignature('/// must match\n\nexpect value == 1'),
  );
  assert.notEqual(
    aikenSemanticSignature('/// must match\nexpect value == 1'),
    aikenSemanticSignature('/// must match\n// interruption\nexpect value == 1'),
  );
});

test('fails closed for malformed literals and unsupported whitespace', () => {
  assert.throws(
    () => aikenSemanticSignature('let value = "unterminated'),
    /unterminated quoted literal/,
  );
  for (const unsupportedWhitespace of ['\u000b', '\u000c', '\u00a0', '\u2028']) {
    assert.throws(
      () => aikenSemanticSignature(`let value${unsupportedWhitespace}= 1`),
      /unsupported whitespace/,
    );
  }
  assert.throws(
    () => aikenSemanticSignature('let value = 1\rlet other = 2'),
    /bare carriage return/,
  );
  assert.equal(
    aikenSemanticSignature('// unmatched " and \\\npub fn value() { 1 }'),
    aikenSemanticSignature('pub fn value() { 1 }'),
  );
});

test('classifies modified comments as trivia and source additions as relevant', () => {
  const repo = mkdtempSync(join(tmpdir(), 'aiken-change-detector-'));
  try {
    execFileSync('git', ['init', '-q'], { cwd: repo });
    execFileSync('git', ['config', 'user.email', 'ci@example.com'], { cwd: repo });
    execFileSync('git', ['config', 'user.name', 'CI'], { cwd: repo });
    const sourceDir = join(repo, 'cardano/onchain/validators');
    mkdirSync(sourceDir, { recursive: true });
const sourcePath = join(sourceDir, 'example.ak');
    writeFileSync(sourcePath, 'pub fn value() { 1 }\n');
    execFileSync('git', ['add', '.'], { cwd: repo });
    execFileSync('git', ['commit', '-qm', 'base'], { cwd: repo });
    const base = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: repo,
      encoding: 'utf8',
    }).trim();

    writeFileSync(sourcePath, '// explanation\npub fn value() { 1 } // same code\n');
    execFileSync('git', ['commit', '-qam', 'comments'], { cwd: repo });
    const comments = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: repo,
      encoding: 'utf8',
    }).trim();
    assert.deepEqual(classifyAikenChanges(repo, base, comments), {
      aikenFilesChanged: true,
      aikenRelevantChanged: false,
      aikenFuzzChanged: false,
      changedFiles: ['cardano/onchain/validators/example.ak'],
      reasons: [],
    });

    writeFileSync(sourcePath, '/// blueprint docs\npub fn value() { 1 }\n');
    execFileSync('git', ['commit', '-qam', 'docs'], { cwd: repo });
    const docs = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: repo,
      encoding: 'utf8',
    }).trim();
    const docsResult = classifyAikenChanges(repo, comments, docs);
    assert.equal(docsResult.aikenRelevantChanged, true);

    writeFileSync(sourcePath, '/// blueprint docs\npub fn value() { 2 }\n');
    execFileSync('git', ['commit', '-qam', 'code'], { cwd: repo });
    const code = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: repo,
      encoding: 'utf8',
    }).trim();
    const codeResult = classifyAikenChanges(repo, docs, code);
    assert.equal(codeResult.aikenRelevantChanged, true);
    assert.match(codeResult.reasons[0], /outside ordinary comments/);

    writeFileSync(join(sourceDir, 'added.ak'), '// new file\n');
    execFileSync('git', ['add', '.'], { cwd: repo });
    execFileSync('git', ['commit', '-qm', 'add source'], { cwd: repo });
    const added = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: repo,
      encoding: 'utf8',
    }).trim();
    const result = classifyAikenChanges(repo, code, added);
    assert.equal(result.aikenFilesChanged, true);
    assert.equal(result.aikenRelevantChanged, true);
    assert.match(result.reasons[0], /added, deleted, renamed, or changed mode/);

    execFileSync(
      'git',
      [
        'mv',
        'cardano/onchain/validators/added.ak',
        'cardano/onchain/validators/moved.ak',
      ],
      { cwd: repo },
    );
    execFileSync('git', ['commit', '-qm', 'rename source'], { cwd: repo });
    const renamed = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: repo,
      encoding: 'utf8',
    }).trim();
    assert.equal(
      classifyAikenChanges(repo, added, renamed).aikenRelevantChanged,
      true,
    );

    execFileSync(
      'git',
      ['update-index', '--chmod=+x', 'cardano/onchain/validators/example.ak'],
      { cwd: repo },
    );
    execFileSync('git', ['commit', '-qm', 'change source mode'], { cwd: repo });
    const modeChanged = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: repo,
      encoding: 'utf8',
    }).trim();
    assert.equal(
      classifyAikenChanges(repo, renamed, modeChanged).aikenRelevantChanged,
      true,
    );

    rmSync(join(sourceDir, 'moved.ak'));
    execFileSync('git', ['add', '-u'], { cwd: repo });
    execFileSync('git', ['commit', '-qm', 'delete source'], { cwd: repo });
    const deleted = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: repo,
      encoding: 'utf8',
    }).trim();
    assert.equal(
      classifyAikenChanges(repo, modeChanged, deleted).aikenRelevantChanged,
      true,
    );

    const workflowDir = join(repo, '.github/workflows');
    mkdirSync(workflowDir, { recursive: true });
    writeFileSync(join(workflowDir, 'extra.yml'), 'name: Extra\n');
    execFileSync('git', ['add', '.'], { cwd: repo });
    execFileSync('git', ['commit', '-qm', 'change CI'], { cwd: repo });
    const workflowChanged = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: repo,
      encoding: 'utf8',
    }).trim();
    const workflowResult = classifyAikenChanges(repo, deleted, workflowChanged);
    assert.equal(workflowResult.aikenRelevantChanged, true);

    const gatewayTypeDir = join(repo, 'cardano/gateway/src/shared/types/channel');
    mkdirSync(gatewayTypeDir, { recursive: true });
    writeFileSync(join(gatewayTypeDir, 'channel-redeemer.ts'), 'export const value = 1;\n');
    execFileSync('git', ['add', '.'], { cwd: repo });
    execFileSync('git', ['commit', '-qm', 'change budget encoder'], { cwd: repo });
    const budgetInputChanged = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: repo,
      encoding: 'utf8',
    }).trim();
    assert.equal(
      classifyAikenChanges(repo, workflowChanged, budgetInputChanged)
        .aikenRelevantChanged,
      true,
    );

    const helperDir = join(repo, 'cardano/gateway/src/shared/helpers');
    mkdirSync(helperDir, { recursive: true });
    writeFileSync(join(helperDir, 'hex.ts'), 'export const toHex = () => "00";\n');
    execFileSync('git', ['add', '.'], { cwd: repo });
    execFileSync('git', ['commit', '-qm', 'change budget helper'], { cwd: repo });
    const budgetHelperChanged = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: repo,
      encoding: 'utf8',
    }).trim();
    assert.equal(
      classifyAikenChanges(repo, budgetInputChanged, budgetHelperChanged)
        .aikenRelevantChanged,
      true,
    );

    const txBudgetLimitsDir = join(repo, 'cardano/gateway/src/scripts/ci');
    mkdirSync(txBudgetLimitsDir, { recursive: true });
    writeFileSync(
      join(txBudgetLimitsDir, 'tx-budget-limits.ts'),
      'export const maxTxExMem = 16500000;\n',
    );
    execFileSync('git', ['add', '.'], { cwd: repo });
    execFileSync('git', ['commit', '-qm', 'change transaction budget limit'], {
      cwd: repo,
    });
    const txBudgetLimitsChanged = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: repo,
      encoding: 'utf8',
    }).trim();
    assert.equal(
      classifyAikenChanges(repo, budgetHelperChanged, txBudgetLimitsChanged)
        .aikenRelevantChanged,
      true,
    );

    const offchainDir = join(repo, 'cardano/offchain/src');
    mkdirSync(offchainDir, { recursive: true });
    writeFileSync(join(offchainDir, 'packet-budgets.test.ts'), '// complete transaction budgets\n');
    execFileSync('git', ['add', '.'], { cwd: repo });
    execFileSync('git', ['commit', '-qm', 'test: change complete transaction budgets'], { cwd: repo });
    assert.equal(
      classifyAikenChanges(repo, txBudgetLimitsChanged, 'HEAD').aikenRelevantChanged,
      true,
    );

    const capacityFixtureDir = join(
      repo,
      'cardano/gateway/src/scripts/test/fixtures/tendermint-update-capacity',
    );
    mkdirSync(capacityFixtureDir, { recursive: true });
    writeFileSync(
      join(capacityFixtureDir, 'manifest.json'),
      '{"chainId":"injective-1"}\n',
    );
    execFileSync('git', ['add', '.'], { cwd: repo });
    execFileSync('git', ['commit', '-qm', 'change capacity fixture'], {
      cwd: repo,
    });
    const capacityFixtureChanged = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: repo,
      encoding: 'utf8',
    }).trim();
    assert.equal(
      classifyAikenChanges(repo, txBudgetLimitsChanged, capacityFixtureChanged)
        .aikenRelevantChanged,
      true,
    );

    const lucidServiceDir = join(repo, 'cardano/gateway/src/shared/modules/lucid');
    mkdirSync(lucidServiceDir, { recursive: true });
    writeFileSync(
      join(lucidServiceDir, 'lucid.service.ts'),
      'export const encode = () => "00";\n',
    );
    execFileSync('git', ['add', '.'], { cwd: repo });
    execFileSync('git', ['commit', '-qm', 'change capacity encoder'], {
      cwd: repo,
    });
    const capacityEncoderChanged = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: repo,
      encoding: 'utf8',
    }).trim();
    assert.equal(
      classifyAikenChanges(repo, capacityFixtureChanged, capacityEncoderChanged)
        .aikenRelevantChanged,
      true,
    );
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});


test('reruns the budget gate when only applied deployment inputs change', () => {
  const repo = mkdtempSync(join(tmpdir(), 'deployment-change-detector-'));
  try {
    execFileSync('git', ['init', '-q'], { cwd: repo });
    execFileSync('git', ['config', 'user.email', 'ci@example.com'], { cwd: repo });
    execFileSync('git', ['config', 'user.name', 'CI'], { cwd: repo });
    execFileSync('git', ['commit', '--allow-empty', '-qm', 'base'], { cwd: repo });
    for (const path of [
      'cardano/offchain/src/deployment-plan.ts',
      'cardano/offchain/scripts/export-deployment-plan.ts',
      'cardano/offchain/deno.lock',
      'cardano/gateway/src/scripts/ci/applied-deployment-plan.ts',
    ]) {
      const base = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
      const target = join(repo, path);
      mkdirSync(join(target, '..'), { recursive: true });
      writeFileSync(target, '// changed applied deployment input\n');
      execFileSync('git', ['add', '.'], { cwd: repo });
      execFileSync('git', ['commit', '-qm', 'deployment input'], { cwd: repo });
      const result = classifyAikenChanges(repo, base, 'HEAD');
      assert.equal(result.aikenFilesChanged, false, path);
      assert.equal(result.aikenRelevantChanged, true, path);
      assert.equal(result.aikenFuzzChanged, false, path);
    }
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});
