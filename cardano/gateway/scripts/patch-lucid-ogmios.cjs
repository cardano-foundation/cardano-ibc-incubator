const fs = require('node:fs');
const path = require('node:path');

// Ogmios 6.x validates explicit JSON scripts at their language's introduction
// version. Tagged ledger CBOR preserves later builtins for normal evaluation.
// https://github.com/CardanoSolutions/ogmios/blob/v6.12.0/server/src/Ogmios/Data/Json/Query.hs#L2123-L2170
const directory = path.dirname(require.resolve('@lucid-evolution/provider'));
const metadata = JSON.parse(fs.readFileSync(path.join(directory, '../package.json'), 'utf8'));
if (metadata.version !== '0.1.94') {
  throw new Error(`Review the Lucid Ogmios patch before using provider version ${metadata.version}`);
}

const updates = ['index.js', 'index.cjs'].map((name) => {
  const file = path.join(directory, name);
  let source = fs.readFileSync(file, 'utf8');
  const esm = name === 'index.js';
  const imports = esm
    ? 'import ogmiosScriptCbor from "cbor";\n' +
      'import { toScriptRef as toOgmiosScriptRef } from "@lucid-evolution/utils";\n'
    : 'const ogmiosScriptCbor = require("cbor");\n' +
      'const { toScriptRef: toOgmiosScriptRef } = require("@lucid-evolution/utils");\n';
  const start = 'var toOgmiosUTxOs = (utxos) => {';
  const withImports = imports + start;
  const replacements = [[start, withImports]];
  for (const version of [1, 2, 3]) {
    const singleCbor = esm ? 'applySingleCborEncoding2' : '(0, import_utils3.applySingleCborEncoding)';
    replacements.push([
      `          return {\n            language: "plutus:v${version}",\n` +
        `            cbor: ${singleCbor}(scriptRef.script)\n          };`,
      '          return ogmiosScriptCbor.encode(new ogmiosScriptCbor.Tagged(\n' +
        '            24, Buffer.from(toOgmiosScriptRef(scriptRef).to_cbor_bytes())\n' +
        '          )).toString("hex");',
    ]);
  }
  if (source.includes(withImports)) {
    if (source.split(replacements[1][1]).length !== 4 ||
        replacements.slice(1).some(([before]) => source.includes(before))) {
      throw new Error(`Lucid Ogmios patch is incomplete in ${name}`);
    }
    return [file, source];
  }
  for (const [before, after] of replacements) {
    if (source.split(before).length !== 2) {
      throw new Error(`Lucid Ogmios patch does not match ${name}, review the dependency change`);
    }
    source = source.replace(before, after);
  }
  return [file, source];
});
for (const [file, source] of updates) fs.writeFileSync(file, source);
