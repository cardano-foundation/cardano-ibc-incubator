#!/usr/bin/env node
import { readdirSync, readFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

// Mask comments and literals without changing offsets, so a comment containing
// `test ...` cannot create a shard or count as use of a generated parameter.
export function mask(source) {
  return source.replace(/\/\/[^\n]*|"(?:\\.|[^"\\])*"/g,
    (text) => text.replace(/[^\n]/g, ' '));
}

export function properties(source, file = '<source>') {
  const code = mask(source);
  const found = [];
  const tests = /\btest\s+(\w+)\s*\(/g;
  for (const match of code.matchAll(tests)) {
    let end = match.index + match[0].length;
    const start = end;
    let depth = 1;
    while (depth && end < code.length) {
      if (code[end] === '(') depth++;
      if (code[end] === ')') depth--;
      end++;
    }
    if (depth) throw new Error(`${file}: unterminated test ${match[1]}`);
    const args = code.slice(start, end - 1);
    if (!/\bvia\b/.test(args)) continue;
    const binding = /^\s*([a-zA-Z_]\w*)\s+via\b/.exec(args)?.[1];
    // Fail closed on new parameter syntax until the inventory supports it.
    if (!binding || binding.startsWith('_')) {
      throw new Error(`${file}:${match[1]}: property must bind generated input`);
    }
    const bodyStart = code.indexOf('{', end);
    if (bodyStart < 0) throw new Error(`${file}: missing property body`);
    end = bodyStart + 1;
    depth = 1;
    while (depth && end < code.length) {
      if (code[end] === '{') depth++;
      if (code[end] === '}') depth--;
      end++;
    }
    const body = code.slice(bodyStart, end);
    if (!new RegExp(`\\b${binding}\\b`).test(body)) {
      throw new Error(`${file}:${match[1]}: generated input is unused`);
    }
    found.push({ title: match[1], file });
  }
  return found;
}

export function inventory(root) {
  const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(dir, entry.name);
    if (entry.isDirectory()) return walk(path);
    return entry.isFile() && path.endsWith('.ak')
      ? properties(readFileSync(path, 'utf8'), relative(root, path)) : [];
  });
  const result = ['lib', 'validators'].flatMap((dir) => walk(resolve(root, dir)));
  if (!result.length) throw new Error('No Aiken properties found');
  const titles = new Set();
  for (const { title } of result) {
    if (titles.has(title)) throw new Error(`Ambiguous property selector: ${title}`);
    titles.add(title);
  }
  return result.sort((a, b) => a.title.localeCompare(b.title));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  // One property per shard: all discovered properties receive the deep budget,
  // including additions that do not follow a hand-maintained naming convention.
  const include = inventory(resolve('cardano/onchain')).map(({ title }) => ({
    suite: title,
  }));
  if (include.length > 256) throw new Error('Property matrix exceeds GitHub job limit');
  console.log(JSON.stringify({ include }));
}
