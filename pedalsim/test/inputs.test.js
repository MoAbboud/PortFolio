import test from 'node:test';
import assert from 'node:assert/strict';

import { quantise, pedal, applyEvent, emptyInputs, PEDAL_MAX } from '../sim/inputs.js';

test('a pedal fraction becomes a whole number from 0 to 1023', () => {
  assert.equal(quantise(0), 0);
  assert.equal(quantise(1), PEDAL_MAX);
  assert.equal(quantise(0.5), 512);
  // A controller axis can read a hair past its end. That is a pedal on the floor.
  assert.equal(quantise(1.0002), PEDAL_MAX);
  assert.equal(quantise(-0.01), 0);
});

test('rounding happens once: the fraction the step sees is the one the log can store', () => {
  // A live run and its replay must see the same number. The live side rounds a fraction to
  // an integer, the log stores the integer, the replay reads it back - so the step must only
  // ever see integer / 1023, never the raw fraction.
  for (const raw of [0.1, 0.333, 0.71828, 0.999]) {
    const stored = quantise(raw);
    const seen = pedal({ thr: stored }, 'thr');
    assert.equal(seen * PEDAL_MAX, stored);
  }
});

test('an event changes one channel and returns new inputs', () => {
  const before = emptyInputs();
  const after = applyEvent(before, 'thr', 700);
  assert.equal(after.thr, 700);
  assert.equal(before.thr, 0);
});

test('a bad event is refused loudly, not replayed quietly', () => {
  const inputs = emptyInputs();
  assert.throws(() => applyEvent(inputs, 'nitrous', 1), /unknown input channel/);
  assert.throws(() => applyEvent(inputs, 'thr', 0.5), /thr cannot be/);
  assert.throws(() => applyEvent(inputs, 'thr', 1024), /thr cannot be/);
  assert.throws(() => applyEvent(inputs, 'gear', 7), /gear cannot be/);
  assert.throws(() => applyEvent(inputs, 'key', 2), /key cannot be/);
  assert.equal(applyEvent(inputs, 'gear', 'D').gear, 'D');
  assert.equal(applyEvent(inputs, 'gear', -1).gear, -1);
});
