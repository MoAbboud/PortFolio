// The maths panel shows the step the car actually took, and its sums add up.

import test from 'node:test';
import assert from 'node:assert/strict';

import { ENGINES } from '../engines/index.js';
import { PERFECT } from '../engines/perfect/index.js';
import { explain, equations } from '../ui/insight.js';
import { initialState, step } from '../sim/step.js';
import { emptyInputs, applyEvent } from '../sim/inputs.js';

// Every state of a run with the inputs that moved it on, so explain() can be held to it.
function steps(engine, log) {
  let state = initialState(engine, null, { gearbox: log.gearbox, tractionControl: log.tractionControl });
  let inputs = emptyInputs();
  let next = 0;
  const out = [];
  for (let n = 0; n < log.steps; n++) {
    while (next < log.events.length && log.events[next][0] === n) {
      inputs = applyEvent(inputs, log.events[next][1], log.events[next][2]);
      next += 1;
    }
    const after = step(engine, null, state, inputs);
    out.push({ before: state, inputs, after });
    state = after;
  }
  return out;
}

for (const id of ['v4', 'v12']) {
  const engine = ENGINES.find((e) => e.id === id);
  const run = steps(engine, PERFECT[id].log);

  test(`${engine.label}: the panel's numbers are the step the car took, and they add up`, () => {
    let checked = 0;
    for (let i = 0; i < run.length; i += 37) {
      const { before, inputs, after } = run[i];
      const x = explain(engine, before, inputs);
      // The same step: its acceleration and the clutch torque are what the state recorded.
      assert.equal(x.a, after.a);
      assert.equal(x.clutchCarries, after.clutchNm);
      // Newton's second law, from the solver's own joint forces.
      const net = x.tyreForce - x.drag - x.rolling - x.brakeForce;
      assert.ok(Math.abs(net - x.mass * x.a) < 1e-6 * Math.max(1, Math.abs(net)), `step ${before.step}: ${net} against ${x.mass * x.a}`);
      // The engine's torque is its combustion, starter and losses.
      assert.ok(Math.abs(x.combustion + x.starter - x.losses - x.torque) < 1e-9);
      // Every equation has its numbers in.
      for (const q of equations(x)) assert.doesNotMatch(q.worked, /undefined|NaN/, q.name);
      checked += 1;
    }
    assert.ok(checked > 100);
  });
}

test('the panel names the joints\' states: gripping, slipping, spinning', () => {
  const engine = ENGINES.find((e) => e.id === 'v12');
  const states = new Set();
  for (const { before, inputs } of steps(engine, PERFECT.v12.log)) {
    const x = explain(engine, before, inputs);
    states.add(`clutch ${x.clutchState}`).add(`tyres ${x.tyreState}`);
  }
  for (const s of ['clutch gripping', 'clutch slipping', 'tyres gripping', 'tyres spinning']) assert.ok(states.has(s), s);
});
