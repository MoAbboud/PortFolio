// Measure an engine the way a test bench would: by running it.
//
// Used by tools/figures.js to print each engine's numbers and by the tests to hold them to
// the published figures. Everything that runs the engine goes through sim/ - the same step
// the page will use - so what is measured is what a driver gets.

import { airLoad, crankTorque } from '../sim/engine.js';
import { replay } from '../sim/replay.js';
import { RPM_PER_RAD_S, STEPS_PER_SECOND } from '../sim/clock.js';
import { PEDAL_MAX } from '../sim/inputs.js';

const KEY_HELD_STEPS = 800;

// The full-throttle curve, steady state: the manifold settled at what a wide-open throttle
// gives at each speed. Brake torque, as a dynamometer reports it.
export function fullThrottleCurve(engine, step = 50) {
  const points = [];
  for (let rpm = 1000; rpm <= engine.redlineRpm; rpm += step) {
    const load = airLoad(engine, 1, rpm);
    const torque = crankTorque(engine, load, rpm, true);
    points.push({ rpm, torque, kw: (torque * rpm) / RPM_PER_RAD_S / 1000 });
  }
  return points;
}

export function peaks(engine) {
  const curve = fullThrottleCurve(engine);
  const byTorque = curve.reduce((a, b) => (b.torque > a.torque ? b : a));
  const byPower = curve.reduce((a, b) => (b.kw > a.kw ? b : a));
  return {
    peakTorque: byTorque.torque,
    peakTorqueRpm: byTorque.rpm,
    peakPower: byPower.kw,
    peakPowerRpm: byPower.rpm,
  };
}

// Run a script that starts with the key held for 0.8 s, and record the rpm every step.
export function run(engine, steps, events = []) {
  const rpms = [];
  const states = [];
  replay(engine, null, {
    steps,
    events: [[0, 'key', 1], [KEY_HELD_STEPS, 'key', 0], ...events],
  }, (state) => {
    rpms.push(state.we * RPM_PER_RAD_S);
    states.push(state);
  });
  return { rpms, states };
}

const seconds = (s) => Math.round(s * STEPS_PER_SECOND);
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

// Turn the key from cold and let it settle: the highest flare, and where it idles.
export function startUp(engine) {
  const { rpms, states } = run(engine, seconds(6));
  return {
    running: states.at(-1).running,
    flare: Math.max(...rpms),
    idle: mean(rpms.slice(-seconds(1))),
    idleSpread: Math.max(...rpms.slice(-seconds(1))) - Math.min(...rpms.slice(-seconds(1))),
  };
}

// Hold a throttle in neutral after the engine has settled, and see where the revs go.
//
// Ten seconds, because part throttle settles slowly: the air the engine gets falls as it
// speeds up, so near the settling point the push and the losses are almost balanced, and a
// heavy flywheel takes its time over the last few hundred rpm. Most of the rise is in the
// first two or three seconds.
export function freeRev(engine, pedal) {
  const from = seconds(4);
  const { rpms } = run(engine, from + seconds(10), [[from, 'thr', Math.round(pedal * PEDAL_MAX)]]);
  const last = rpms.slice(-seconds(1));
  return { mean: mean(last), min: Math.min(...last), max: Math.max(...last) };
}

// Floor it in neutral from idle: how long until the needle reaches the redline.
export function revTime(engine) {
  const from = seconds(4);
  const { rpms } = run(engine, from + seconds(3), [[from, 'thr', PEDAL_MAX]]);
  const at = rpms.findIndex((rpm, i) => i >= from && rpm >= engine.redlineRpm);
  return at < 0 ? Infinity : (at - from) / STEPS_PER_SECOND;
}

// Floor it, then lift: the revs fall under friction and pumping alone. Seconds from the
// limiter back to 1.5 times idle.
export function fallTime(engine) {
  const on = seconds(4);
  const off = on + seconds(2);
  const { rpms } = run(engine, off + seconds(4), [[on, 'thr', PEDAL_MAX], [off, 'thr', 0]]);
  const at = rpms.findIndex((rpm, i) => i >= off && rpm <= engine.idleRpm * 1.5);
  return at < 0 ? Infinity : (at - off) / STEPS_PER_SECOND;
}
