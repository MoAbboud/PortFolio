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
// Stage 2: engine, gearbox, clutch or converter, tyres, car and brakes. Every change to what
// this returns moves SIM_VERSION, and test/golden.test.js fails if the numbers move without it.

import { engineControl } from './engine.js';
import { gearbox } from './gearbox.js';
import { drivetrain } from './drivetrain.js';
import { CHASSIS } from './chassis.js';

export { STEPS_PER_SECOND, DT } from './clock.js';

export const SIM_VERSION = 2;

// options.gearbox: 'manual' (the default) or 'auto'. options.tractionControl: on by default
// for the automatic, off for the manual, where the launch is the driver's own.
export function initialState(engine, chassis, options = {}) {
  const box = options.gearbox === 'auto' ? 'auto' : 'manual';
  return {
    step: 0,
    box,
    tractionControl: options.tractionControl ?? box === 'auto',
    tc: 1, // traction control's share of the driver's throttle, 0 to 1
    running: false, // engine turning under its own power
    we: 0, // engine speed, rad/s
    load: 0, // how full the intake manifold is, 0 to 1
    idleI: 0, // the idle controller's learned throttle
    cut: false, // rev limiter cutting the fuel
    ww: 0, // rear wheel speed, rad/s
    v: 0, // car speed, m/s, negative in reverse
    a: 0, // car acceleration, m/s^2
    gear: 0, // engaged gear: -1 reverse, 0 neutral (and Park), 1 and up
    G: 0, // overall ratio engaged, negative in reverse
    autoGear: 1, // the gear an automatic has chosen for Drive
    shiftHold: 0, // steps until an automatic may shift again
    clutchStuck: false,
    tyreStuck: false,
    brakeStuck: false,
    clutchNm: 0, // torque through the clutch this step
  };
}

// Pure: the state passed in is never changed. A ghost, a replay and the live car can each
// hold their own state and step it without touching the others.
//
// With no engine the step only moves the clock; the replay and trace tests use that.
export function step(engine, chassis, state, inputs) {
  const next = { ...state, step: state.step + 1 };
  if (!engine) return next;
  const car = chassis ?? CHASSIS;
  const control = engineControl(engine, state, inputs);
  const box = gearbox(engine, state, inputs);
  const moved = drivetrain(engine, car, state, inputs, control, box);
  next.running = control.running;
  next.load = control.load;
  next.idleI = control.idleI;
  next.cut = control.cut;
  next.tc = control.tc;
  next.gear = box.gear;
  next.autoGear = box.autoGear;
  next.shiftHold = box.shiftHold;
  return Object.assign(next, moved);
}
