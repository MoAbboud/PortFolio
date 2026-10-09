// From measurements to tables: the maths tools/build-engines.js runs.
//
// This is outside sim/ on purpose. It may use Math.cos and ** freely, because it runs once,
// on the author's machine, and what it produces is committed as plain numbers. The live
// simulation only ever reads those numbers back.

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

export function buildEngine(p, shared) {
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

  return {
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
}
