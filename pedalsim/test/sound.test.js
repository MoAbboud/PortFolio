// The engine sound's table: one engine cycle of exhaust pulses, built from each engine.

import test from 'node:test';
import assert from 'node:assert/strict';

import { ENGINES } from '../engines/index.js';
import { engineTable, firingHz, TABLE_SIZE } from '../ui/sound-table.js';

// Peaks: samples higher than both neighbours and well above the average.
function peaks(table) {
  const out = [];
  for (let i = 0; i < table.length; i++) {
    const prev = table[(i - 1 + table.length) % table.length];
    const next = table[(i + 1) % table.length];
    if (table[i] > prev && table[i] >= next && table[i] > 0.3) out.push(i);
  }
  return out;
}

test('one pulse per cylinder, evenly spaced through the cycle', () => {
  for (const e of ENGINES) {
    const { table, firingAngles } = engineTable(e);
    assert.equal(table.length, TABLE_SIZE);
    const found = peaks(table);
    assert.equal(found.length, e.cylinders, `${e.label}: ${found.length} pulses`);
    found.forEach((i, c) => {
      const deg = (i / TABLE_SIZE) * 720;
      const want = firingAngles[c];
      const off = Math.min(Math.abs(deg - want), 720 - Math.abs(deg - want));
      assert.ok(off < 3, `${e.label} cylinder ${c} at ${deg}, wants ${want}`);
    });
  }
});

test('every engine at the same level: centred on zero, peaking at one', () => {
  for (const e of ENGINES) {
    const { table } = engineTable(e);
    let mean = 0;
    let peak = 0;
    for (const v of table) {
      mean += v;
      peak = Math.max(peak, Math.abs(v));
    }
    assert.ok(Math.abs(mean / table.length) < 1e-6);
    assert.ok(Math.abs(peak - 1) < 1e-6);
  }
});

test('the same engine always sounds the same; different engines do not', () => {
  const a = engineTable(ENGINES[2]).table;
  const b = engineTable(ENGINES[2]).table;
  assert.deepEqual(a, b);
  assert.notDeepEqual(engineTable(ENGINES[0]).table, engineTable(ENGINES[4]).table);
});

test('the pitch is the firing frequency: rpm / 60 times half the cylinders', () => {
  assert.equal(firingHz({ cylinders: 8 }, 6000), 400);
  assert.equal(firingHz({ cylinders: 4 }, 900), 30);
  assert.equal(firingHz({ cylinders: 12 }, 9000), 900);
});
