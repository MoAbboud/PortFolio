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
// Stage 0: the step only moves the clock. The engine, the couplings and the car arrive in
// stages 1 and 2, and each one that changes what this returns moves SIM_VERSION.

export const SIM_VERSION = 0;

// 1000 steps a second. The clutch and the tyres are friction couplings that either stick
// or slip, and with a light flywheel a longer step makes them chatter.
export const STEPS_PER_SECOND = 1000;
export const DT = 1 / STEPS_PER_SECOND;

export function initialState() {
  return {
    step: 0,
    running: false, // engine turning under its own power
    we: 0, // engine speed, rad/s
    v: 0, // car speed, m/s, negative in reverse
    gear: 0, // -1 reverse, 0 neutral, 1 and up
  };
}

// Pure: the state passed in is never changed. A ghost, a replay and the live car can each
// hold their own state and step it without touching the others.
export function step(engine, chassis, state, inputs) {
  return { ...state, step: state.step + 1 };
}
