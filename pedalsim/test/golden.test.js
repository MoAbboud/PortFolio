// The simulation's numbers may only change when SIM_VERSION says so.
//
// A run log records the SIM_VERSION that made it. If the step changed what it computes but
// kept the same version, every shared link and every stored perfect run would quietly replay
// to a different result. This test is what stops that.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { fingerprints } from '../tools/golden.js';
import { SIM_VERSION } from '../sim/step.js';

const golden = JSON.parse(readFileSync(new URL('./golden.json', import.meta.url), 'utf8'));

test('the stored fingerprints are for this SIM_VERSION', () => {
  assert.equal(golden.simVersion, SIM_VERSION,
    'SIM_VERSION moved: if the change was meant, run node tools/golden.js --write');
});

test('the same inputs give exactly the numbers they gave when SIM_VERSION was set', () => {
  const now = fingerprints();
  for (const [id, hash] of Object.entries(golden.traces)) {
    assert.equal(now.traces[id], hash,
      `${id}'s numbers moved without SIM_VERSION moving: bump it in sim/step.js, ` +
      'then run node tools/golden.js --write');
  }
  assert.deepEqual(Object.keys(now.traces), Object.keys(golden.traces));
});
