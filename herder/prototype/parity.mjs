// Run the ported pipeline over the benchmark conversations and print JSON on stdout.
//
//   node prototype/parity.mjs
//
// Consumed by prototype/tests/test_parity.py, which runs the Python extractor over the same
// eight files and fails on any difference. That test is the only thing standing between "rules
// generated from one source" and "algorithms hand-ported and quietly wrong".

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseTranscript, extract, uncovered } from './herder.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATASETS = path.join(HERE, '..', 'bench', 'datasets');

const out = {};
for (const name of fs.readdirSync(DATASETS).sort()) {
  const file = path.join(DATASETS, name, 'conversation.txt');
  if (!fs.existsSync(file)) continue;
  const turns = parseTranscript(fs.readFileSync(file, 'utf8'));
  const entries = extract(turns);
  out[name] = {
    turns: turns.length,
    userTurns: turns.filter((t) => t.role === 'user').length,
    candidates: entries.map((e) => ({ kind: e.kind, layer: e.layer, text: e.text })),
    residue: uncovered(turns, entries.map((e) => e.text)),
  };
}

process.stdout.write(JSON.stringify(out, null, 1));
