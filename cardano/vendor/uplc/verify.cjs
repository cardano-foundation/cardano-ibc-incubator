const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, 'artifact-sha256.json'), 'utf8'));
for (const [name, expected] of Object.entries(manifest)) {
  const actual = createHash('sha256').update(fs.readFileSync(path.join(__dirname, name))).digest('hex');
  if (actual !== expected) throw new Error(`Evaluator artifact/source checksum mismatch: ${name}`);
}
console.log(`Verified ${Object.keys(manifest).length} pinned evaluator source/artifact hashes`);
