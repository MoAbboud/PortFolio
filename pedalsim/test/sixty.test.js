// The 0 to 60 run's rules: when the clock starts, how the crossing is read, and what does not
// count.

import test from 'node:test';
import assert from 'node:assert/strict';

import { createWatch, GO_STEP, COUNTDOWN_STEP, MPH_60, START_GEAR } from '../sim/sixty.js';
import { STEPS_PER_SECOND } from '../sim/clock.js';

// A made-up run: idling in neutral, first gear in during the countdown, then a steady
// acceleration from GO. Enough of a state for the watch.
function run({ a = 8, gear = START_GEAR, creep = 0, upTo = GO_STEP + 6000 } = {}) {
  const watch = createWatch();
  for (let n = 1; n <= upTo; n++) {
    const t = (n - GO_STEP) / STEPS_PER_SECOND;
    watch.see({
      step: n,
      v: n <= GO_STEP ? (n > COUNTDOWN_STEP ? creep : 0) : a * t,
      gear: n > COUNTDOWN_STEP + 100 ? gear : 0,
      running: true,
      grinding: false,
      checkEngine: false,
      blown: false,
      slipJ: 0,
    });
    if (watch.done) break;
  }
  return watch.result();
}

test('the time is from GO to 60 mph, interpolated inside the step', () => {
  // At 8 m/s^2 the car passes 60 mph at exactly 26.8224 / 8 seconds, which falls between steps.
  const r = run({ a: 8 });
  assert.equal(r.finished, true);
  assert.equal(r.clean, true);
  assert.ok(Math.abs(r.time - MPH_60 / 8) < 1e-9, `${r.time}`);
});

test('rolling before GO is a false start and is not timed', () => {
  const r = run({ creep: 0.5 });
  assert.equal(r.falseStart, true);
  assert.equal(r.finished, false);
  assert.equal(r.time, Infinity);
});

test('a run that sets off in second does not count', () => {
  const r = run({ gear: 2 });
  assert.equal(r.startGear, 2);
  assert.equal(r.finished, false);
});

test('a run that never reaches 60 mph is not finished', () => {
  const r = run({ a: 1, upTo: GO_STEP + 5000 });
  assert.equal(r.finished, false);
  assert.equal(r.time, Infinity);
});
