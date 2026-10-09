// The engine, turning on its own: what the throttle, the key and the engine's own friction do
// to its speed. The clutch, the gearbox and the car arrive in stage 2; until then the engine
// is always in neutral, and this is the whole of what moves the rev counter.
//
// The engine object is one of the generated files in engines/, built from measurements by
// tools/build-engines.js. Nothing here knows which engine it is running.

import { lookup, clamp } from './curves.js';
import { DT, RPM_PER_RAD_S } from './clock.js';
import { PEDAL_MAX } from './inputs.js';

// The idle controller: a proportional-integral loop that opens the throttle a little when
// the revs drop below idle. It is why the revs dip and recover when something loads the
// engine, and why it settles after starting rather than racing or dying.
const IDLE_KP = 0.3;
const IDLE_KI = 1.2; // per second
const IDLE_MAX_PEDAL = 0.1; // idle needs about 0.06 on every engine; more would be an engine, not an idle valve
// Falling faster than this (rad/s per second, about 300 rpm a second) counts as coming down
// from a blip rather than sitting near idle.
const IDLE_SETTLED_DECEL = 30;

// Traction control: trims the driver's throttle while the rear tyres spin faster than the car
// by more than TC_SPIN (m/s) - the point past which a spinning tyre starts losing grip - and
// gives it back as they recover. An integral loop: the trim moves at TC_RATE per second for
// each m/s of error. Never trims below TC_FLOOR, so the engine is never shut off entirely.
const TC_SPIN = 1.0;
const TC_RATE = 1;
const TC_FLOOR = 0.05;
const TC_GAIN = 0.3; // and this much straight off per m/s of spin over, so it reacts at once

// Below this the airflow sums divide by a nearly stopped engine. Air cannot be more than all
// the engine can swallow anyway, so the load is the same either side of it.
const MIN_RPM_FOR_AIRFLOW = 100;

// Friction fades in over the first few rpm either way, as static friction does.
const FRICTION_FADE_RPM = 20;

// The fraction of a full cylinder of air the engine gets, for a throttle position and a speed.
//
// Air through the throttle plate is roughly fixed for a given opening; the engine's appetite
// grows with its speed. Their ratio r is how full each cylinder gets - but never more than
// full, so the result is a smooth minimum of r and 1: r / (1 + r^8)^(1/8), with the eighth
// root taken as three square roots. This is why a little throttle revs a free engine a lot,
// and why the same throttle in gear at high revs gives far less.
export function airLoad(engine, pedal, rpm) {
  const area = lookup(engine.throttleArea, pedal);
  const n = rpm < MIN_RPM_FOR_AIRFLOW ? MIN_RPM_FOR_AIRFLOW : rpm;
  const r = (area * engine.throttleFlow * engine.redlineRpm) / n;
  const r2 = r * r;
  const r4 = r2 * r2;
  return r / Math.sqrt(Math.sqrt(Math.sqrt(1 + r4 * r4)));
}

// Torque at the crank with the manifold settled at `load`: combustion, less friction, less
// the pumping loss that a part-closed throttle causes. Negative when the engine is being
// slowed by its own losses - engine braking.
export function crankTorque(engine, load, rpm, firing) {
  const combustion = firing ? load * lookup(engine.combustion, rpm) : 0;
  const losses = lookup(engine.friction, rpm) + engine.pumpingNm * (1 - load);
  return combustion - losses;
}

// One step of the engine's own decisions - firing, stalling, the limiter, the idle controller,
// the manifold - and the torque it puts on its crank this step, starter included. It does not
// move the engine's speed: once the clutch grips, the engine and the car move as one, so the
// drivetrain (sim/drivetrain.js) does that for everything at once.
export function engineControl(engine, state, inputs) {
  const { we } = state;
  let { running, load, idleI, cut } = state;
  const rpm = we * RPM_PER_RAD_S;
  const cranking = inputs.key === 1;

  // Firing and stalling. While the key is held the starter is still helping, so a stall is
  // only declared once it is let go.
  if (!running && cranking && rpm >= engine.fireRpm) running = true;
  if (running && !cranking && rpm < engine.stallRpm) running = false;

  // The rev limiter cuts the fuel at the limit and restores it a margin below. The bounce on
  // the needle comes from this, not from an animation.
  if (!running) cut = false;
  else if (rpm >= engine.limiterRpm) cut = true;
  else if (rpm < engine.limiterRpm - engine.limiterHysteresisRpm) cut = false;

  // The driver's throttle, unless the idle controller wants more.
  let tc = state.tc;
  let trim = 1;
  if (state.tractionControl) {
    const spin = state.ww * engine.gearing.wheelRadius - state.v;
    tc = clamp(tc + TC_RATE * (TC_SPIN - spin) * DT, TC_FLOOR, 1);
    trim = clamp(tc - TC_GAIN * (spin - TC_SPIN), TC_FLOOR, 1);
  }
  const pedal = (inputs.thr / PEDAL_MAX) * trim;
  let throttle = pedal;
  if (running) {
    const error = (engine.idleRpm - rpm) / engine.idleRpm;
    const wanted = clamp(IDLE_KP * error + idleI, 0, IDLE_MAX_PEDAL);
    // The integral learns only with the driver off the pedal, and not while the revs are
    // falling fast. If it learned during the fall from a blip it would unlearn the idle
    // throttle on the way down and the revs would dip toward a stall; if it never learned
    // above idle, a start-up flare would leave the engine idling high for good.
    const falling = crankTorque(engine, load, rpm, !cut) / engine.inertia < -IDLE_SETTLED_DECEL;
    if (pedal === 0 && rpm < engine.idleRpm * 1.5 && !falling) {
      idleI = clamp(idleI + IDLE_KI * error * DT, 0, IDLE_MAX_PEDAL);
    }
    if (wanted > throttle) throttle = wanted;
  } else {
    idleI = 0;
  }

  // The manifold fills or empties toward what the throttle allows. It takes about
  // manifoldRatio engine cycles - two turns each - so a blip at idle is slower than one at
  // speed, as it is in a real engine.
  const target = airLoad(engine, throttle, rpm);
  const n = rpm < MIN_RPM_FOR_AIRFLOW ? MIN_RPM_FOR_AIRFLOW : rpm;
  const fill = DT / ((engine.manifoldRatio * 120) / n);
  load += (target - load) * (fill > 1 ? 1 : fill);

  // The starter pushes hardest at a standstill and freewheels once the engine outruns it.
  const starter = cranking && rpm < engine.starterFreeRpm
    ? engine.starterNm * (1 - rpm / engine.starterFreeRpm)
    : 0;

  // Friction and pumping oppose the way the crank is turning, and fade to nothing over the last
  // few rpm. At rest they are static friction: they resist being turned but push nothing, so a
  // stalled engine in gear holds a car rather than pushing it backwards. A car rolling
  // backwards in gear turns the engine backwards, and the friction then pushes the other way.
  const combustion = running && !cut ? load * lookup(engine.combustion, rpm) : 0;
  const losses = lookup(engine.friction, rpm < 0 ? -rpm : rpm) + engine.pumpingNm * (1 - load);
  const torque = combustion + starter - losses * clamp(rpm / FRICTION_FADE_RPM, -1, 1);

  return { running, load, idleI, cut, tc, torque };
}
