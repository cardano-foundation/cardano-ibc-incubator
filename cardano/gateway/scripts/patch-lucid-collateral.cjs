const fs = require('node:fs');
const path = require('node:path');

// Lucid permits regular/collateral overlap, which Hermes deliberately refuses
// to sign. Keep both published module formats compatible with that policy.
const replacements = [
  [
    '      totalCollateral,\n      walletInputs\n    );',
    '      totalCollateral,\n      walletInputs.filter((input) => !config.consumedInputs.some(\n' +
      '        (spent) => spent.txHash === input.txHash && spent.outputIndex === input.outputIndex\n' +
      '      ))\n    );',
  ],
  [
    '    evaluatedScriptBody = (yield* selectionAndEvaluation(\n      walletInputs,\n',
    '    evaluatedScriptBody = (yield* selectionAndEvaluation(\n      walletInputs.filter((input) => !collateralInput.some(\n' +
      '        (reserved) => reserved.txHash === input.txHash && reserved.outputIndex === input.outputIndex\n' +
      '      )),\n',
  ],
];

const directory = path.dirname(require.resolve('@lucid-evolution/lucid'));
const metadata = JSON.parse(fs.readFileSync(path.join(directory, '../package.json'), 'utf8'));
if (metadata.version !== '0.6.5') {
  throw new Error(`Review the Lucid collateral patch before using version ${metadata.version}`);
}
const updates = ['index.js', 'index.cjs'].map((name) => {
  const file = path.join(directory, name);
  let source = fs.readFileSync(file, 'utf8');
  for (const [before, after] of replacements) {
    if (source.includes(after)) continue;
    if (source.split(before).length !== 2) {
      throw new Error(`Lucid collateral patch does not match ${name}, review the dependency change`);
    }
    source = source.replace(before, after);
  }
  return [file, source];
});
for (const [file, source] of updates) fs.writeFileSync(file, source);
