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
const IDLE_MAX_PEDAL = 0.25;
// Falling faster than this (rad/s per second, about 300 rpm a second) counts as coming down
// from a blip rather than sitting near idle.
const IDLE_SETTLED_DECEL = 30;

// Below this the airflow sums divide by a nearly stopped engine. Air cannot be more than all
// the engine can swallow anyway, so the load is the same either side of it.
const MIN_RPM_FOR_AIRFLOW = 100;

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

// One step of the engine. Returns only the fields it changes.
export function engineStep(engine, state, inputs) {
  let { we, running, load, idleI, cut } = state;
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
  const pedal = inputs.thr / PEDAL_MAX;
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

  const torque = crankTorque(engine, load, rpm, running && !cut) + starter;
  we += (torque / engine.inertia) * DT;
  // Friction can stop an engine; it cannot turn it backwards.
  if (we < 0) we = 0;

  return { we, running, load, idleI, cut };
}
