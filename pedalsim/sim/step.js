// One step of the simulation: (engine, chassis, state, inputs) in, the next state out.
//
// Everything a needle shows comes through here, and so does everything the server-less
// share link, the perfect-run solver and the ghost needle will ever compute. That only
// works if this function gives the same numbers on every machine, so the rules for
// everything under sim/ are:
//
//   - a fixed step: DT is the clock, and the step count is the time
//   - no Math.sin, cos, exp, pow, log, no **, no random, no Date, no performance:
//     curves are tables, and sqrt is the only non-arithmetic function allowed
//   - nothing from the browser: no window, no document
//
// test/rules.test.js reads every file in sim/ and fails on any of them.
//
// Stage 1: the engine runs, always in neutral. The clutch, the gearbox and the car arrive in
// stage 2. Every change to what this returns moves SIM_VERSION, and test/golden.test.js
// fails if the numbers move without it.

import { engineStep } from './engine.js';

export { STEPS_PER_SECOND, DT } from './clock.js';

export const SIM_VERSION = 1;

export function initialState() {
  return {
    step: 0,
    running: false, // engine turning under its own power
    we: 0, // engine speed, rad/s
    load: 0, // how full the intake manifold is, 0 to 1
    idleI: 0, // the idle controller's learned throttle
    cut: false, // rev limiter cutting the fuel
    v: 0, // car speed, m/s, negative in reverse
    gear: 0, // -1 reverse, 0 neutral, 1 and up
  };
}

// Pure: the state passed in is never changed. A ghost, a replay and the live car can each
// hold their own state and step it without touching the others.
//
// With no engine the step only moves the clock; the replay and trace tests use that.
export function step(engine, chassis, state, inputs) {
  const next = { ...state, step: state.step + 1 };
  if (engine) Object.assign(next, engineStep(engine, state, inputs));
  return next;
}
