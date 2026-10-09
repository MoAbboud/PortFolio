import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { ENGINES } from '../engines/index.js';
import { ENGINES as PARAMS, SHARED } from '../engines/params.js';
import { expectedFiles } from '../tools/build-engines.js';
import {
  displacement, redline, torquePerPascal, breathing, pistonSpeed,
} from '../tools/engine-maths.js';
import { peaks, startUp, freeRev, revTime, run } from '../tools/measure.js';
import { initialState, step } from '../sim/step.js';
import { emptyInputs, PEDAL_MAX } from '../sim/inputs.js';
import { RPM_PER_RAD_S } from '../sim/clock.js';

const near = (a, b, tolerance) =>
  assert.ok(Math.abs(a - b) <= tolerance, `${a} is not within ${tolerance} of ${b}`);
const within = (value, [lo, hi], what) =>
  assert.ok(value >= lo && value <= hi, `${what} is ${value}, published ${lo}-${hi}`);

test('the committed engine files are exactly what the parameters build', () => {
  // The generated files are never edited by hand. If someone did, or changed a parameter
  // without rebuilding, this says which file and how to fix it.
  for (const [name, text] of Object.entries(expectedFiles())) {
    const committed = readFileSync(new URL(`../engines/${name}`, import.meta.url), 'utf8');
    assert.equal(committed, text, `engines/${name} is stale: run node tools/build-engines.js`);
  }
});

test('the page cycles the engines from four cylinders to twelve', () => {
  assert.deepEqual(ENGINES.map((e) => e.label), ['V4', 'V6', 'V8', 'V10', 'V12']);
  assert.deepEqual(ENGINES.map((e) => e.cylinders), [4, 6, 8, 10, 12]);
});

test('displacement is bore area times stroke times cylinders', () => {
  // A 2.0 litre square four: 86 mm bore and stroke.
  const four = { cylinders: 4, bore: 0.086, stroke: 0.086 };
  near(displacement(four) * 1000, 1.998, 0.001);
  // The V12's 94 x 78 mm comes to the 6496 cc its reference engine is quoted at.
  near(displacement(PARAMS.at(-1)) * 1e6, 6496, 1);
});

test('the redline is where the pistons reach the speed the engine is built for', () => {
  // 21.5 m/s on an 89.5 mm stroke: 21.5 * 60 / (2 * 0.0895) = 7206 rpm, quoted as 7200.
  assert.equal(redline({ pistonSpeedMax: 21.5, stroke: 0.0895 }), 7200);
  // Same limit, shorter stroke: more rpm.
  assert.ok(redline({ pistonSpeedMax: 21.5, stroke: 0.078 }) > 7200);
  near(pistonSpeed({ stroke: 0.0895 }, 7200), 21.48, 0.01);
});

test('a four-stroke turns pressure into torque through displacement over 4 pi', () => {
  // 13 bar of brake pressure on 5 litres is about 517 Nm - the V8's class.
  near(13e5 * torquePerPascal({ cylinders: 8, bore: 0.094, stroke: 0.0895 }), 514, 1);
});

test('breathing peaks where it is told to and falls to the given fractions', () => {
  const shape = { peakAt: 0.8, atIdle: 0.7, atRedline: 0.9 };
  near(breathing(shape, 0.8), 1, 1e-12);
  near(breathing(shape, 0.1), 0.7, 1e-12);
  near(breathing(shape, 1.0), 0.9, 1e-12);
  assert.ok(breathing(shape, 0.79) < 1 && breathing(shape, 0.81) < 1);
});

for (const engine of ENGINES) {
  const t = PARAMS.find((p) => p.id === engine.id).targets;

  test(`${engine.label} makes what its reference engine is published to make`, () => {
    const p = peaks(engine);
    within(Math.round(p.peakTorque), t.peakTorque, 'peak torque, Nm');
    within(p.peakTorqueRpm, t.peakTorqueRpm, 'peak torque rpm');
    within(Math.round(p.peakPower), t.peakPower, 'peak power, kW');
    within(p.peakPowerRpm, t.peakPowerRpm, 'peak power rpm');
    if (t.redline) within(engine.redlineRpm, t.redline, 'redline');
    // Power peaks after torque, as it must: power is torque times speed.
    assert.ok(p.peakPowerRpm > p.peakTorqueRpm);
  });

  test(`${engine.label} starts on the key and settles at its idle`, () => {
    const s = startUp(engine);
    assert.equal(s.running, true);
    near(s.idle, engine.idleRpm, 10);
    assert.ok(s.idleSpread < 10, `idle wanders by ${s.idleSpread} rpm`);
    // A start flares above idle, like a real one, but not wildly.
    assert.ok(s.flare > engine.idleRpm && s.flare < engine.idleRpm * 2);
  });

  test(`${engine.label}: every held throttle in neutral gives its own steady rpm, rising with it`, () => {
    // The author's first requirement: the rpm represents the amount of gas. In neutral each
    // pedal position settles where combustion exactly feeds friction and pumping.
    let last = engine.idleRpm;
    for (const pedal of [0.1, 0.15, 0.2, 0.25, 0.3]) {
      const r = freeRev(engine, pedal);
      if (r.max >= engine.limiterRpm) break; // on the limiter: that pedal is past the top
      assert.ok(r.mean > last + 200, `${pedal * 100}% gives ${r.mean}, not above ${last}`);
      assert.ok(r.max - r.min < r.mean * 0.01, `${pedal * 100}% still moving by ${r.max - r.min} rpm`);
      last = r.mean;
    }
    assert.ok(last > engine.redlineRpm * 0.5, 'the pedal never reached the upper half of the revs');
  });

  test(`${engine.label} bounces off its limiter flat out, and never passes it`, () => {
    const r = freeRev(engine, 1);
    assert.ok(r.max >= engine.limiterRpm, 'never reached the limiter');
    assert.ok(r.max < engine.limiterRpm + 100, `overshot the limiter to ${r.max}`);
    assert.ok(r.min > engine.limiterRpm - engine.limiterHysteresisRpm - 150, 'fell too far');
    assert.ok(r.max - r.min > 20, 'the needle should bounce, not sit');
  });

  test(`${engine.label} revs from idle to redline in under the 0.6 s quoted for the fastest road V10`, () => {
    // Lexus quoted 0.6 s from idle to 9000 rpm for the LFA's V10, an engine famous for it.
    // None of these should be quicker than that, and none should feel lazy.
    const t = revTime(engine);
    assert.ok(t >= 0.5 && t <= 0.9, `${t} s`);
  });

  test(`${engine.label} comes back down to idle after a blip without dipping toward a stall`, () => {
    const on = 4000;
    const off = on + 1500;
    const { rpms, states } = run(engine, off + 8000, [[on, 'thr', PEDAL_MAX], [off, 'thr', 0]]);
    const after = rpms.slice(off);
    assert.ok(Math.min(...after) > engine.idleRpm * 0.85, `dipped to ${Math.min(...after)}`);
    near(after.at(-1), engine.idleRpm, 10);
    assert.equal(states.at(-1).running, true);
  });

  test(`${engine.label} stalls below its stall speed once the key is let go`, () => {
    const slow = { ...initialState(), running: true, we: (engine.stallRpm - 50) / RPM_PER_RAD_S };
    const next = step(engine, null, slow, emptyInputs());
    assert.equal(next.running, false);
    // With the key held the starter is still helping, so it is not a stall yet.
    const held = step(engine, null, slow, { ...emptyInputs(), key: 1 });
    assert.equal(held.running, true);
  });

  test(`${engine.label} does nothing without the key, and a dead engine coasts to a stop`, () => {
    let state = initialState();
    for (let i = 0; i < 2000; i++) state = step(engine, null, state, { ...emptyInputs(), thr: PEDAL_MAX });
    assert.equal(state.we, 0);
    assert.equal(state.running, false);

    state = { ...initialState(), we: 3000 / RPM_PER_RAD_S };
    for (let i = 0; i < 20000; i++) state = step(engine, null, state, emptyInputs());
    assert.equal(state.we, 0, 'friction stops an engine; it never turns it backwards');
  });
}

test('the shared physics is in the ranges it claims', () => {
  // Friction at 20 m/s piston speed, about 2 bar, as modern petrol engines measure.
  const at20 = SHARED.frictionA + SHARED.frictionC * 20 + SHARED.frictionD * 400;
  assert.ok(at20 > 1.5e5 && at20 < 3e5);
  // Pumping with the throttle shut cannot exceed the atmosphere the pistons pull against.
  assert.ok(SHARED.pumpingClosed < 1.0e5);
});
