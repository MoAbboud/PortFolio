// How much of each gauge face the engine has earned.
//
// Each gauge is cut into bins - the tachometer one per 100 rpm, the speedometer one per mph -
// and each bin holds a development value from 0 (not there) to 1 (fully built). Time spent at
// some revs builds those revs, faster under load; a little spills to the neighbours so the
// face grows smoothly rather than in stripes. The redline appears the first time the revs
// reach it. The dyno strip plots only torque the engine has actually made flat out.
//
// Display only: the simulation never reads any of this. A replay rebuilds the same faces
// because it produces the same states.

// Development per second of dwell, before the spill. Tuned so three or four full-throttle
// pulls in neutral complete a tachometer, and a steady speed builds its part of the
// speedometer in about a second.
const TACH_RATE = 6;
const SPEED_RATE = 2.5;
const SPILL_TACH = 4; // bins either side
const SPILL_SPEED = 3;
// How fast the faces dissolve, build all at once, or break apart: per second.
const SETTLE_RATE = 1.2;
// The redline arc pixelates in over this long once first reached.
const REDLINE_FADE = 0.8;

export function createDevelopment(layout) {
  return {
    tach: new Float32Array(layout.tach.bins),
    speed: new Float32Array(layout.speed.bins),
    redlineSeen: false,
    redline: 0,
    dyno: new Float32Array(layout.tach.bins), // largest full-throttle torque per bin, Nm
    shiftSeen: [],
  };
}

function deposit(bins, at, amount, spill) {
  const centre = Math.round(at);
  for (let k = -spill; k <= spill; k++) {
    const i = centre + k;
    if (i < 0 || i >= bins.length) continue;
    const weight = Math.exp(-(k * k) / (spill * 0.8));
    bins[i] = Math.min(1, Math.max(0, bins[i] + amount * weight));
  }
}

// sample: { running, rpm, load, mph, gear, torque } from the latest state.
export function grow(dev, layout, sample, dt) {
  if (sample.running && sample.rpm > 0) {
    deposit(dev.tach, sample.rpm / layout.tach.binSize, TACH_RATE * dt * (0.3 + sample.load), SPILL_TACH);
    if (sample.rpm >= layout.tach.redline) dev.redlineSeen = true;
    if (sample.load > 0.95 && sample.torque > 0) {
      const i = Math.round(sample.rpm / layout.tach.binSize);
      if (i < dev.dyno.length && sample.torque > dev.dyno[i]) dev.dyno[i] = sample.torque;
    }
    const g = sample.gear;
    if (g >= 1 && g <= layout.tach.shiftMarks.length && sample.load > 0.5
      && sample.rpm >= layout.tach.shiftMarks[g - 1]) {
      dev.shiftSeen[g - 1] = true;
    }
  }
  const mph = Math.abs(sample.mph);
  if (mph > 0.5) deposit(dev.speed, mph / layout.speed.binSize, SPEED_RATE * dt, SPILL_SPEED);
  if (dev.redlineSeen) dev.redline = Math.min(1, dev.redline + dt / REDLINE_FADE);
}

// Moves every bin toward `target` (0 to dissolve or break apart, 1 to build it all).
// Returns true once everything has arrived.
export function settle(dev, target, dt) {
  const step = SETTLE_RATE * dt;
  let done = true;
  for (const bins of [dev.tach, dev.speed]) {
    for (let i = 0; i < bins.length; i++) {
      const d = bins[i];
      bins[i] = target > d ? Math.min(target, d + step) : Math.max(target, d - step);
      if (bins[i] !== target) done = false;
    }
  }
  if (target === 0) {
    dev.redline = Math.max(0, dev.redline - step);
    if (dev.redline === 0) dev.redlineSeen = false;
  } else {
    dev.redlineSeen = true;
    dev.redline = Math.min(1, dev.redline + step);
  }
  return done && dev.redline === target;
}

// The share of a gauge built so far: 0 to 1.
export function builtShare(bins) {
  let sum = 0;
  for (const d of bins) sum += d;
  return sum / bins.length;
}
