// The shift coach: when to change up, when to change down, and what revs to meet.
//
// Display only - it reads the state and the engine's own figures and never touches the
// simulation. All of it comes from the engine file: the shift points the build tool worked
// out from where each gear stops pushing harder than the next, and the idle and redline.
//
//   up, at the shift point     flat out and at the coach's point for this gear
//   up, for economy            a light foot, and the revs high enough that the next gear
//                              will not lug
//   down, lugging              real throttle and the revs barely above idle
//   down, for speed            flat out, and the gear below would push harder without
//                              passing its own shift point
//   down, braking              slowing in a gear too tall to pull away from if asked
//
// With the clutch down and a gear chosen, it also gives the revs the engine must reach for that
// gear to go in without a lurch: speed over wheel radius, times the gear's ratio.

import { overallRatio } from '../sim/gearbox.js';
import { RPM_PER_RAD_S } from '../sim/clock.js';

const GEARS = 6;

export function rpmInGear(engine, v, gear) {
  return Math.abs(v / engine.gearing.wheelRadius) * Math.abs(overallRatio(engine.gearing, gear)) * RPM_PER_RAD_S;
}

// sample: { gear, rpm, v (m/s), thr, brake, clutch (0 to 1), want (the gear the stick is in) }
export function coach(engine, sample) {
  const { gear, rpm, v, thr, brake, clutch, want } = sample;
  const out = { arrow: null, reason: null, matchRpm: null, matchGear: null };
  const lug = engine.idleRpm * 1.6;
  const light = Math.max(engine.idleRpm * 1.8, engine.redlineRpm * 0.3);
  const shiftAt = (g) => engine.coach.upshiftRpm[g - 1] ?? engine.redlineRpm;

  if (gear >= 1) {
    if (gear < GEARS && thr > 0.5 && rpm >= shiftAt(gear) - 100) {
      Object.assign(out, { arrow: 'up', reason: 'shift point' });
    } else if (gear < GEARS && thr > 0.02 && thr < 0.35 && rpm >= light * 1.1
      && rpmInGear(engine, v, gear + 1) >= lug) {
      Object.assign(out, { arrow: 'up', reason: 'economy' });
    } else if (gear > 1 && thr > 0.3 && rpm < lug) {
      Object.assign(out, { arrow: 'down', reason: 'lugging' });
    } else if (gear > 1 && thr > 0.9 && rpmInGear(engine, v, gear - 1) < shiftAt(gear - 1) * 0.85) {
      Object.assign(out, { arrow: 'down', reason: 'for speed' });
    } else if (brake > 0.15 && Math.abs(v) > 3) {
      // The gear to be in: the lowest that keeps the revs under its own shift point.
      let target = GEARS;
      for (let g = 1; g < GEARS; g++) {
        if (rpmInGear(engine, v, g) <= shiftAt(g) * 0.85) {
          target = g;
          break;
        }
      }
      if (gear > target) Object.assign(out, { arrow: 'down', reason: 'braking' });
    }
  }

  // Clutch down while moving: the revs the chosen gear needs.
  if (clutch > 0.6 && Math.abs(v) > 2) {
    const g = typeof want === 'number' && want >= 1 ? want : out.arrow === 'down' ? gear - 1 : gear;
    if (g >= 1) {
      out.matchGear = g;
      out.matchRpm = rpmInGear(engine, v, g);
    }
  }
  return out;
}
