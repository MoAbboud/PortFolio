// Fingerprints of the simulation's exact output, so a change to it cannot go unnoticed.
//
//   node tools/golden.js           print the fingerprints
//   node tools/golden.js --write   store them in test/golden.json, with SIM_VERSION
//
// Each engine runs test/scripts/workout.json and every state of every step is hashed. A shared
// run link is only replayable if the same inputs still give the same numbers, so
// test/golden.test.js fails whenever they move without SIM_VERSION moving too. When a change
// is meant to alter the numbers: bump SIM_VERSION in sim/step.js, then run --write.

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ENGINES } from '../engines/index.js';
import { replay } from '../sim/replay.js';
import { SIM_VERSION } from '../sim/step.js';

const SCRIPT = new URL('../test/scripts/workout.json', import.meta.url);
const GOLDEN = new URL('../test/golden.json', import.meta.url);

export function fingerprints() {
  const script = JSON.parse(readFileSync(SCRIPT, 'utf8'));
  const out = {};
  for (const engine of ENGINES) {
    const hash = createHash('sha256');
    // JSON prints every number at full precision, so one bit of difference changes the hash.
    replay(engine, null, script, (state) => hash.update(JSON.stringify(state)));
    out[engine.id] = hash.digest('hex');
  }
  return { simVersion: SIM_VERSION, traces: out };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const now = fingerprints();
  if (process.argv.includes('--write')) {
    writeFileSync(GOLDEN, JSON.stringify(now, null, 2) + '\n', 'utf8');
    console.error(`wrote test/golden.json for SIM_VERSION ${SIM_VERSION}`);
  } else {
    console.log(JSON.stringify(now, null, 2));
  }
}
