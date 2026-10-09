import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { replay, checkScript } from '../sim/replay.js';

test('events are applied before the step they are numbered for', () => {
  const seen = [];
  replay(null, null, {
    steps: 5,
    events: [[0, 'thr', 100], [2, 'thr', 300], [2, 'clutch', 1023], [4, 'thr', 0]],
  }, (state, inputs) => seen.push([state.step, inputs.thr, inputs.clutch]));

  // state.step is the count after the step, so the step numbered n reports n + 1.
  assert.deepEqual(seen, [
    [1, 100, 0],
    [2, 100, 0],
    [3, 300, 1023],
    [4, 300, 1023],
    [5, 0, 1023],
  ]);
});

test('a replay runs exactly the steps the script asks for', () => {
  const end = replay(null, null, { steps: 1234, events: [] });
  assert.equal(end.step, 1234);
});

test('the same script gives the same run, every time', () => {
  const script = JSON.parse(readFileSync(new URL('./scripts/idle.json', import.meta.url)));
  const a = [];
  const b = [];
  replay(null, null, script, (s, i) => a.push(JSON.stringify([s, i])));
  replay(null, null, script, (s, i) => b.push(JSON.stringify([s, i])));
  assert.deepEqual(a, b);
});

test('a broken script is refused before a single step is taken', () => {
  assert.throws(() => checkScript({ steps: 10 }), /events must be a list/);
  assert.throws(() => checkScript({ steps: 1.5, events: [] }), /whole number/);
  assert.throws(() => checkScript({ steps: 10, events: [[10, 'thr', 1]] }), /outside 0 to 9/);
  assert.throws(() => checkScript({ steps: 10, events: [[5, 'thr', 1], [3, 'thr', 0]] }),
    /comes after step 5/);
  assert.throws(() => checkScript({ steps: 10, events: [[1, 'thr']] }), /not \[step, channel, value\]/);

  let stepped = false;
  assert.throws(() => replay(null, null, { steps: 10, events: [[12, 'thr', 1]] },
    () => { stepped = true; }));
  assert.equal(stepped, false);
});

test('a bad value inside a valid script still stops the replay', () => {
  assert.throws(() => replay(null, null, { steps: 5, events: [[1, 'thr', 5000]] }),
    /thr cannot be 5000/);
});
