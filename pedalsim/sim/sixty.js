// The 0 to 60 run: how it starts, when the clock starts, and how its time and its cleanness
// are read from the states it produced.
//
// Every 0 to 60 run - the perfect one the solver writes, a driver's on the page, a shared link
// re-driven in someone else's browser - begins the same way, so that their times compare:
//
//   step 0       the page turns the key for the driver (PRELUDE), engine cold, in neutral
//   step 3000    the countdown: the driver may push the clutch, pick a gear and build revs,
//                but the car must not move
//   step 5000    GO. The clock starts here
//
// The car leaves in first. These engines are geared so that first runs out at a quarter of top
// speed, and the bigger ones spin their tyres in first and second alike, so the quickest run
// for a V8, V10 or V12 would leave in second and never shift - and a run scored on shifting
// would have nothing to score. A run that sets off in any other gear does not count.
//
// The time is from GO to the moment the car passes 60 mph, interpolated between the two steps
// either side, so it is not a staircase of whole milliseconds. That is what makes it smooth
// enough for tools/solve.js to search, and fair to the thousandth on the score card.

import { STEPS_PER_SECOND } from './clock.js';

export const MPH_60 = 26.8224; // m/s
export const PRELUDE = [[0, 'key', 1], [800, 'key', 0]];
export const COUNTDOWN_STEP = 3 * STEPS_PER_SECOND;
export const GO_STEP = 5 * STEPS_PER_SECOND;
// A run that has not reached 60 mph twenty seconds after GO is over.
export const MAX_STEPS = GO_STEP + 20 * STEPS_PER_SECOND;
// Rolling faster than this before GO is a false start.
const FALSE_START_SPEED = 0.1; // m/s
export const START_GEAR = 1;

// Watches a run step by step. Feed it every state from step 1 on; it stops caring once the car
// has passed 60 mph. done is true from then on, and result() says how it went.
export function createWatch() {
  let last = null;
  let crossed = null; // seconds after GO, interpolated
  let falseStart = false;
  let startGear = 0; // the first gear engaged from the countdown on
  let grind = false;
  let checkEngine = false;
  let blown = false;
  let stalled = false;
  let slipJ = 0;

  return {
    get done() {
      return crossed !== null || blown || stalled;
    },
    see(state) {
      if (this.done) return;
      if (state.step <= GO_STEP && state.v > FALSE_START_SPEED) falseStart = true;
      if (startGear === 0 && state.step > COUNTDOWN_STEP && state.gear !== 0) startGear = state.gear;
      if (state.grinding) grind = true;
      if (state.checkEngine) checkEngine = true;
      if (state.blown) blown = true;
      if (state.step > GO_STEP && !state.running) stalled = true;
      slipJ = state.slipJ;
      if (state.step > GO_STEP && last && last.v < MPH_60 && state.v >= MPH_60) {
        // The state after step n is at time n / STEPS_PER_SECOND; the car passed 60 mph a
        // fraction of the way through that step.
        const frac = (MPH_60 - last.v) / (state.v - last.v);
        crossed = (last.step + frac - GO_STEP) / STEPS_PER_SECOND;
      }
      last = state;
    },
    result() {
      const finished = crossed !== null && !falseStart && startGear === START_GEAR;
      return {
        finished,
        time: finished ? crossed : Infinity,
        falseStart,
        startGear,
        grind,
        checkEngine,
        blown,
        stalled,
        slipJ,
        // The author's clean run: no grind, no over-rev, no blown engine. How gentle the clutch
        // was is the slip energy, judged on the score card rather than here.
        clean: finished && !grind && !checkEngine && !blown,
      };
    },
  };
}
