// From measurements to tables: the maths tools/build-engines.js runs.
//
// This is outside sim/ on purpose. It may use Math.cos and ** freely, because it runs once,
// on the author's machine, and what it produces is committed as plain numbers. The live
// simulation only ever reads those numbers back.

import { airLoad, crankTorque } from '../sim/engine.js';
import { RPM_PER_RAD_S } from '../sim/clock.js';

// Every rpm table runs to well past the over-rev limit, so a needle dragged past it by a bad
// downshift (stage 4) still reads a curve rather than the last number in the table.
const RPM_STEP = 50;
const RPM_HEADROOM = 1500;
const PEDAL_STEPS = 64;

const floorTo = (x, step) => Math.floor(x / step) * step;
const roundTo = (x, step) => Math.round(x / step) * step;
const round = (x, places) => Number(x.toFixed(places));

// Swept volume of all the cylinders: area of a bore times the stroke, times the count.
export function displacement(p) {
  return p.cylinders * (Math.PI / 4) * p.bore ** 2 * p.stroke;
}

// Mean piston speed in m/s: the piston covers two strokes every turn.
export function pistonSpeed(p, rpm) {
  return (2 * p.stroke * rpm) / 60;
}

// The redline is where the pistons reach the speed the engine is built to take. A shorter
// stroke means less travel per turn, so the same limit comes at more rpm. Rounded down to a
// tidy figure, as a maker would quote it.
export function redline(p) {
  return floorTo((p.pistonSpeedMax * 60) / (2 * p.stroke), 50);
}

// A four-stroke fires each cylinder once every two turns, so a mean pressure P on a swept
// volume Vd gives a torque of P * Vd / (4 * pi). This one constant turns every pressure
// below into newton metres.
export function torquePerPascal(p) {
  return displacement(p) / (4 * Math.PI);
}

// Indicated pressure across the rev range as a fraction of its peak: a smooth hump peaking at
// shape.peakAt (a fraction of the redline), falling to shape.atIdle at one tenth of the
// redline and to shape.atRedline at the redline, quadratically either side.
export function breathing(shape, x) {
  const { peakAt, atIdle, atRedline } = shape;
  const k = x < peakAt
    ? (1 - atIdle) / (peakAt - 0.1) ** 2
    : (1 - atRedline) / (1 - peakAt) ** 2;
  return Math.max(0.2, 1 - k * (x - peakAt) ** 2);
}

// Friction mean effective pressure, the simplified Chen-Flynn form.
export function frictionMep(shared, sp) {
  return shared.frictionA + shared.frictionC * sp + shared.frictionD * sp ** 2;
}

// The throttle plate's open area as a fraction of fully open, plus the leak past a shut plate.
export function throttleArea(shared, pedal) {
  return shared.throttleLeak + (1 - shared.throttleLeak) * (1 - Math.cos((pedal * Math.PI) / 2));
}

export function buildEngine(p, shared, chassis) {
  const k = torquePerPascal(p);
  const redlineRpm = redline(p);
  const limiterRpm = redlineRpm + 150;
  const overRevRpm = roundTo(redlineRpm * 1.15, 100);
  const top = overRevRpm + RPM_HEADROOM;

  const combustion = [];
  const friction = [];
  for (let rpm = 0; rpm <= top; rpm += RPM_STEP) {
    combustion.push(round(p.imepPeak * breathing(p.shape, rpm / redlineRpm) * k, 2));
    friction.push(round(frictionMep(shared, pistonSpeed(p, rpm)) * k, 2));
  }
  const area = [];
  for (let i = 0; i <= PEDAL_STEPS; i++) area.push(round(throttleArea(shared, i / PEDAL_STEPS), 6));

  const engine = {
    id: p.id,
    label: p.label,
    cylinders: p.cylinders,
    bankAngle: p.bankAngle,
    // A four-stroke fires every cylinder once in 720 degrees of crank rotation.
    firingIntervalDeg: 720 / p.cylinders,
    displacement: round(displacement(p), 7),
    bore: p.bore,
    stroke: p.stroke,
    mass: p.mass,
    inertia: round(p.flywheel + shared.inertiaPerCylinder * p.cylinders, 4),
    idleRpm: p.idleRpm,
    stallRpm: roundTo(p.idleRpm * 0.5, 50),
    fireRpm: shared.fireRpm,
    redlineRpm,
    limiterRpm,
    limiterHysteresisRpm: 200,
    overRevRpm,
    throttleFlow: shared.throttleFlow,
    manifoldRatio: shared.manifoldRatio,
    pumpingNm: round(shared.pumpingClosed * k, 2),
    starterNm: round(shared.starterFactor * (shared.frictionA + shared.pumpingClosed) * k, 2),
    starterFreeRpm: shared.starterFreeRpm,
    throttleArea: { start: 0, step: 1 / PEDAL_STEPS, values: area },
    combustion: { start: 0, step: RPM_STEP, values: combustion },
    friction: { start: 0, step: RPM_STEP, values: friction },
  };
  return { ...engine, ...drivetrainFor(engine, chassis) };
}

// Brake torque flat out, with the manifold settled: what a dynamometer reads.
function fullThrottle(engine, rpm) {
  return crankTorque(engine, airLoad(engine, 1, rpm), rpm, true);
}

const GEARS = 6;
const FINAL_DRIVE = 3.4;

// Gearing, the coach's shift points and the automatic's shift lines and converter, all
// worked out for this engine in the one car.
export function drivetrainFor(engine, chassis) {
  const r = chassis.wheelRadius;
  const mass = chassis.massWithoutEngine + engine.mass;
  const weight = mass * chassis.g;
  const toRad = (rpm) => rpm / RPM_PER_RAD_S;

  let peakPowerW = 0;
  let peakPowerRpm = 0;
  let peakTorque = 0;
  for (let rpm = 1000; rpm <= engine.redlineRpm; rpm += 10) {
    const t = fullThrottle(engine, rpm);
    if (t * toRad(rpm) > peakPowerW) {
      peakPowerW = t * toRad(rpm);
      peakPowerRpm = rpm;
    }
    if (t > peakTorque) peakTorque = t;
  }

  // Top speed: where the engine's peak power meets drag and rolling resistance. Found by
  // halving the interval; power needed rises steadily with speed, so there is one answer.
  const needed = (v) => (0.5 * chassis.airDensity * chassis.cdA * v * v + chassis.crr * weight) * v;
  let lo = 1;
  let hi = 200;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (needed(mid) < peakPowerW) lo = mid;
    else hi = mid;
  }
  const topSpeed = lo;

  // Top gear puts the engine at its power peak at top speed: the fastest the car can go.
  // First gear runs out at a quarter of top speed, as performance cars' do. Sized by grip
  // instead, first gear on the V12 would run to about 150 mph. The gears between close up
  // toward the top: a big step from first to second, a small one from fifth to sixth.
  const top = (toRad(peakPowerRpm) * r) / topSpeed;
  const first = (toRad(engine.redlineRpm) * r) / (topSpeed * 0.25);
  const ratios = [];
  for (let i = 0; i < GEARS; i++) {
    const x = i / (GEARS - 1);
    const f = 1 - (1 - x) ** 1.3;
    ratios.push(round((first * (top / first) ** f) / FINAL_DRIVE, 3));
  }
  const overall = ratios.map((g) => g * FINAL_DRIVE);

  // The coach: change up when the next gear pushes the car harder than this one. While this
  // gear is still limited by the tyres' grip, more push from the engine is no help, so the
  // crossover only counts once it is not. If the gears never cross, change at the redline.
  const grip = chassis.muStatic * weight * (chassis.rearWeightFraction + 0.1);
  const push = (G, v) => {
    const rpm = (v / r) * G * RPM_PER_RAD_S;
    if (rpm > engine.redlineRpm) return -Infinity;
    return Math.min((fullThrottle(engine, Math.max(rpm, 1000)) * G) / r, grip);
  };
  const upshiftRpm = [];
  for (let g = 1; g < GEARS; g++) {
    const here = overall[g - 1];
    const next = overall[g];
    const start = (toRad(1500) * r) / next;
    const end = (toRad(engine.redlineRpm) * r) / here;
    let at = end;
    for (let v = start; v <= end; v += 0.05) {
      const now = push(here, v);
      if (now < grip - 1 && push(next, v) >= now) {
        at = v;
        break;
      }
    }
    upshiftRpm.push(roundTo((at / r) * here * RPM_PER_RAD_S, 10));
  }

  // The automatic's shift lines, as speeds: a light foot changes up at a relaxed rpm, a
  // heavy one at the coach's point. It changes down well below where it changed up, so it
  // holds a gear across a band of speeds instead of hunting.
  const lightRpm = Math.max(engine.idleRpm * 1.8, engine.redlineRpm * 0.3);
  const speedAt = (rpm, G) => round((toRad(rpm) * r) / G, 3);
  const up = [];
  const down = [];
  for (let g = 1; g < GEARS; g++) {
    const G = overall[g - 1];
    // Flat out, 4% short of the coach's point: the converter slips a little, so the gearbox
    // side never quite reaches the engine's speed, and a line at the redline itself would
    // leave the box on the limiter in first for ever.
    const line = [speedAt(lightRpm, G), speedAt(upshiftRpm[g - 1] * 0.96, G)];
    up.push(line);
    down.push([round(line[0] * 0.7, 3), round(line[1] * 0.75, 3)]);
  }

  // The converter: loose enough that flat out against the brakes the engine settles at about
  // a third of its redline - its stall speed. Its looseness K rises toward the coupling point,
  // where it passes almost nothing, and its torque multiplication falls from 2 to 1.
  const stallRpm = roundTo(Math.min(Math.max(engine.redlineRpm / 3, 2000), 3000), 50);
  const K0 = stallRpm / Math.sqrt(fullThrottle(engine, stallRpm));
  const K = [];
  const TR = [];
  for (let i = 0; i <= 20; i++) {
    const sr = i / 20;
    K.push(round(K0 / Math.sqrt(Math.max(1 - sr ** 6, 1e-4)), 3));
    TR.push(round(sr < 0.85 ? 2 - sr / 0.85 : 1, 4));
  }

  return {
    gearing: {
      wheelRadius: r,
      finalDrive: FINAL_DRIVE,
      ratios,
      reverse: round(ratios[0] * 1.05, 3),
      clutchMaxNm: round(peakTorque * 1.4, 1),
      topSpeed: round(topSpeed, 3),
    },
    coach: { upshiftRpm },
    auto: {
      up,
      down,
      kickdown: 0.92,
      lockupFromGear: 3,
      stallRpm,
      converter: {
        K: { start: 0, step: 0.05, values: K },
        TR: { start: 0, step: 0.05, values: TR },
      },
    },
  };
}
