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
  assert.deepEqual(initialState(), { step: 0, running: false, we: 0, v: 0, gear: 0 });
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
