// What each gauge face would show, worked out from the engine's own figures. Nothing on a
// face is placed by hand.
//
// Pure arithmetic: no canvas, no DOM, so the tests check it in Node. ui/ is display code and
// is not bound by the simulation's determinism rules.

import { CHASSIS } from '../sim/chassis.js';

const MPH_PER_MS = 2.23694;

// Angles in canvas terms: 0 is three o'clock, increasing clockwise. The sweep starts at
// half past seven and runs 270 degrees to half past four, like most clusters.
export const START_ANGLE = (135 * Math.PI) / 180;
export const SWEEP = (270 * Math.PI) / 180;

// The rule plotting libraries use for axis labels: of the steps 1, 2, 2.5 and 5 times a power
// of ten, the smallest that gives between `fewest` and `most` major ticks, the scale running to
// the limit rounded up to a whole number of steps.
export function niceScale(limit, fewest = 6, most = 10) {
  const power = 10 ** Math.floor(Math.log10(limit / most));
  for (const p of [power, power * 10, power * 100]) {
    for (const m of [1, 2, 2.5, 5]) {
      const step = m * p;
      const max = Math.ceil(limit / step) * step;
      const majors = max / step;
      if (majors >= fewest && majors <= most) {
        return { max, step, minor: m === 2 ? step / 4 : step / 5 };
      }
    }
  }
  throw new Error(`no tidy scale for ${limit}`);
}

export function angleOf(scale, value) {
  const clamped = value < 0 ? 0 : value > scale.max ? scale.max : value;
  return START_ANGLE + (clamped / scale.max) * SWEEP;
}

// Everything the gauges need for one engine.
export function gaugeLayout(engine) {
  const tach = niceScale(engine.overRevRpm);
  const topMph = engine.gearing.topSpeed * MPH_PER_MS;
  const speed = niceScale(topMph * 1.05);
  return {
    tach: {
      ...tach,
      unit: 'rpm x1000',
      label: (v) => String(v / 1000),
      binSize: 100, // development is kept per 100 rpm
      bins: Math.ceil(tach.max / 100) + 1,
      redline: engine.redlineRpm,
      limiter: engine.limiterRpm,
      shiftMarks: engine.coach.upshiftRpm,
    },
    speed: {
      ...speed,
      unit: 'mph',
      label: (v) => String(v),
      binSize: 1, // per mph
      bins: Math.ceil(speed.max) + 1,
    },
    lights: engine.cylinders,
    wheelRadius: CHASSIS.wheelRadius,
  };
}

// How many shift lights are lit at an rpm: they fill over the last 1500 rpm before the shift
// point, one per cylinder, and all of them at the point itself.
export function lightsLit(layout, rpm, shiftRpm) {
  const from = shiftRpm - 1500;
  if (rpm <= from) return 0;
  if (rpm >= shiftRpm) return layout.lights;
  return Math.floor(((rpm - from) / 1500) * layout.lights);
}
