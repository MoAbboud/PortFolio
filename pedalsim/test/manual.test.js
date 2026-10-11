// The manual's rules: the synchromesh, grinding, reverse, the starter, over-revving and the
// heat a slipping clutch makes. Each test drives the simulation the way a person would.

import test from 'node:test';
import assert from 'node:assert/strict';

import { ENGINES } from '../engines/index.js';
import { drive } from '../tools/measure.js';
import { initialState } from '../sim/step.js';
import { PEDAL_MAX } from '../sim/inputs.js';
import { CHASSIS } from '../sim/chassis.js';
import { overallRatio } from '../sim/gearbox.js';
import { RPM_PER_RAD_S } from '../sim/clock.js';

const v8 = ENGINES.find((e) => e.id === 'v8');
const r = CHASSIS.wheelRadius;
const rpm = (s) => s.we * RPM_PER_RAD_S;

// Rolling in a gear, clutch gripping, engine turning at the matching speed.
function rolling(engine, gear, v) {
  const G = overallRatio(engine.gearing, gear);
  return {
    ...initialState(engine, null),
    running: true, load: 0.3, v, ww: v / r, we: (v / r) * G, G, gear,
    clutchStuck: true, tyreStuck: true,
  };
}

test('into a gear without the clutch, at the wrong revs, it grinds and stays in neutral', () => {
  const states = drive(v8, {
    from: rolling(v8, 2, 15), seconds: 0.5,
    policy: (s, t) => ({ gear: t < 0.1 ? 0 : 3 }),
  });
  const end = states.at(-1);
  assert.equal(end.gear, 0);
  assert.equal(end.grinding, true);

  // Clutch down, and the synchro does its job.
  const fixed = drive(v8, { from: end, seconds: 0.1, policy: () => ({ gear: 3, clutch: PEDAL_MAX }) });
  assert.equal(fixed.at(-1).gear, 3);
  assert.equal(fixed.at(-1).grinding, false);
});

test('a clutchless shift goes in when the revs already match', () => {
  // Out of second, then the engine brought to third gear's speed, then third without the clutch.
  const G3 = overallRatio(v8.gearing, 3);
  const inNeutral = { ...rolling(v8, 2, 15), gear: 0, G: 0, clutchStuck: false };
  const matched = { ...inNeutral, we: inNeutral.ww * G3 };
  const states = drive(v8, { from: matched, seconds: 0.05, policy: () => ({ gear: 3, thr: 150 }) });
  assert.equal(states.at(-1).gear, 3);
  assert.equal(states.at(-1).grinding, false);
});

test('reverse goes in only with the car all but stopped, clutch or not', () => {
  const moving = drive(v8, {
    from: { ...rolling(v8, 1, 5), gear: 0, G: 0 }, seconds: 0.2, policy: () => ({ gear: -1, clutch: PEDAL_MAX }),
  });
  assert.equal(moving.at(-1).gear, 0);
  assert.equal(moving.at(-1).grinding, true);

  const stopped = { ...initialState(v8, null), running: true, we: 650 / RPM_PER_RAD_S, load: 0.12 };
  const states = drive(v8, { from: stopped, seconds: 0.2, policy: () => ({ gear: -1, clutch: PEDAL_MAX }) });
  assert.equal(states.at(-1).gear, -1);
});

test('a manual in gear cranks only with the clutch down; an automatic only in P or N', () => {
  const inGear = { ...initialState(v8, null), gear: 1 };
  const noClutch = drive(v8, { from: inGear, seconds: 1.5, policy: () => ({ gear: 1, key: 1 }) });
  assert.equal(noClutch.at(-1).running, false);
  assert.equal(noClutch.at(-1).we, 0);
  const withClutch = drive(v8, { from: inGear, seconds: 1.5, policy: () => ({ gear: 1, key: 1, clutch: PEDAL_MAX }) });
  assert.equal(withClutch.at(-1).running, true);

  const auto = initialState(v8, null, { gearbox: 'auto' });
  assert.equal(drive(v8, { from: auto, seconds: 1.5, policy: () => ({ gear: 'D', key: 1 }) }).at(-1).running, false);
  assert.equal(drive(v8, { from: auto, seconds: 1.5, policy: () => ({ gear: 'P', key: 1 }) }).at(-1).running, true);
});

test('dropping into first at speed drags the engine past its over-rev limit and blows it', () => {
  // Fifth at 45 m/s; clutch down, first, clutch out: first gear at 45 m/s is far beyond any
  // engine's limit, and only the wheels can push it there. It is not instant: the light rear
  // wheels are slowed into a skid far more easily than the heavy engine is spun up, and then
  // the road drags the wheels - and the engine with them - back up, past the limit.
  const states = drive(v8, {
    from: rolling(v8, 5, 45), seconds: 3,
    policy: (s, t) => ({ gear: t < 0.05 ? 0 : 1, clutch: t < 0.2 ? PEDAL_MAX : 0 }),
  });
  const end = states.at(-1);
  assert.equal(end.blown, true);
  assert.equal(end.checkEngine, true);
  assert.equal(end.running, false);
  assert.ok(Math.max(...states.map(rpm)) > v8.overRevRpm);
  assert.ok(states.slice(200, 400).some((st) => !st.tyreStuck), 'the rear wheels should skid first');

  // A blown engine does not start again.
  const after = drive(v8, { from: { ...end, v: 0, ww: 0, we: 0 }, seconds: 2, policy: () => ({ gear: 0, key: 1 }) });
  assert.equal(after.at(-1).running, false);
  assert.equal(after.at(-1).we, 0);
});

test('a smaller over-rev only lights the check engine light', () => {
  // Fourth at a speed where third puts the engine between its limiter and its over-rev limit.
  const G3 = overallRatio(v8.gearing, 3);
  const target = (v8.limiterRpm + v8.overRevRpm) / 2;
  const v = (target / RPM_PER_RAD_S / G3) * r;
  const states = drive(v8, {
    from: rolling(v8, 4, v), seconds: 1,
    policy: (s, t) => ({ gear: t < 0.05 ? 0 : 3, clutch: t < 0.2 ? PEDAL_MAX : 0 }),
  });
  assert.equal(states.at(-1).checkEngine, true);
  assert.equal(states.at(-1).blown, false);
  assert.equal(states.at(-1).running, true);
});

test('a rev-matched downshift barely warms the clutch; an unmatched one heats it', () => {
  const G3 = overallRatio(v8.gearing, 3);
  const v = 20;
  const needed = (v / r) * G3 * RPM_PER_RAD_S;
  const downshift = (blip) => {
    const start = rolling(v8, 4, v);
    const states = drive(v8, {
      from: start, seconds: 1.5,
      // Clutch down, out of fourth, into third. A blip of throttle while the clutch is down
      // brings the revs up to third's speed - or not - before the clutch comes up.
      policy: (s, t) => ({
        gear: t < 0.05 ? 0 : 3,
        clutch: t < 0.6 ? PEDAL_MAX : Math.round(PEDAL_MAX * Math.max(0, 1 - (t - 0.6) / 0.2)),
        thr: blip && t > 0.1 && t < 0.6 && rpm(s) < needed ? PEDAL_MAX : 0,
      }),
    });
    return states.at(-1).slipJ - start.slipJ;
  };
  const matched = downshift(true);
  const unmatched = downshift(false);
  assert.ok(unmatched > matched * 3, `matched ${matched} J, unmatched ${unmatched} J`);
});
