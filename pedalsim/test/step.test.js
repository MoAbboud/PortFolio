import test from 'node:test';
import assert from 'node:assert/strict';

import { initialState, step, DT, STEPS_PER_SECOND, SIM_VERSION } from '../sim/step.js';
import { emptyInputs } from '../sim/inputs.js';

test('the step count is the clock: a thousand steps a second', () => {
  assert.equal(STEPS_PER_SECOND, 1000);
  assert.equal(DT, 1 / 1000);
  let state = initialState();
  for (let i = 0; i < 2500; i++) state = step(null, null, state, emptyInputs());
  assert.equal(state.step, 2500);
  assert.equal(state.step * DT, 2.5);
});

test('a car starts still, in neutral, with the engine off', () => {
  const s = initialState();
  for (const k of ['step', 'we', 'ww', 'v', 'a', 'gear', 'G', 'load']) assert.equal(s[k], 0, k);
  assert.equal(s.running, false);
  assert.equal(s.box, 'manual');
});

test('traction control is on for the automatic and off for the manual unless asked', () => {
  assert.equal(initialState(null, null, { gearbox: 'auto' }).tractionControl, true);
  assert.equal(initialState(null, null, { gearbox: 'manual' }).tractionControl, false);
  assert.equal(initialState(null, null, { gearbox: 'manual', tractionControl: true }).tractionControl, true);
});

test('a step never changes the state it was given', () => {
  // The live car, the ghost of the perfect run and a replay each hold their own state. If
  // stepping one could touch another's, the ghost would drift into the driver's run.
  const before = initialState();
  const frozen = structuredClone(before);
  const after = step(null, null, before, emptyInputs());
  assert.deepEqual(before, frozen);
  assert.notEqual(after, before);
});

test('SIM_VERSION is a whole number, so a run log can say which simulation made it', () => {
  assert.ok(Number.isInteger(SIM_VERSION) && SIM_VERSION >= 0);
});
