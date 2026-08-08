// The weather, as plain numbers.
//
// Pure module. Presets are starting points rather than a closed set: what a
// step actually stores is the numbers, so a scene can be nudged without
// inventing a preset. Nothing here knows about WebGL.
//
// **A step may also carry an `hour`**, and then the time of day decides where
// the sun is and what colour the sky is, while the weather decides how much of
// that gets through. See `daylight.js`. Without an hour nothing changes at all:
// a preset resolves to exactly the numbers it always did, which is what keeps
// every canvas built before the clock existed opening unchanged.
//
// `dull` is how far a weather pulls the sky back toward its own colours: clear
// lets the hour through untouched, a storm is a storm whatever time it is.

import { atHour, lerpHour } from './daylight.js';

// A preset with no hour has a fixed sun and no moon, which is what these three
// say. They are written into each preset rather than filled in afterwards so
// that resolving a preset is still exactly the preset.
const NO_MOON = { moon: [0, -1, 0], sunUp: 1, moonUp: 0, night: 0 };

export const PRESETS = {
  clear: {
    sky: [0.36, 0.62, 0.92],
    horizon: [0.76, 0.88, 0.98],
    floor: [0.42, 0.68, 0.90],
    sun: [0.45, 0.85, 0.35],
    sunColour: [1.00, 0.95, 0.82],
    ambient: 1.00,
    fogNear: 26,
    fogFar: 190,
    rain: 0,
    scar: null,
    dull: 0,
    ...NO_MOON,
  },
  overcast: {
    sky: [0.55, 0.60, 0.67],
    horizon: [0.78, 0.80, 0.83],
    floor: [0.48, 0.56, 0.63],
    sun: [0.30, 0.90, 0.20],
    sunColour: [0.85, 0.87, 0.90],
    ambient: 0.86,
    fogNear: 20,
    fogFar: 150,
    rain: 0,
    scar: null,
    dull: 0.70,
    ...NO_MOON,
  },
  storm: {
    sky: [0.19, 0.22, 0.29],
    horizon: [0.38, 0.41, 0.47],
    floor: [0.20, 0.25, 0.31],
    sun: [-0.35, 0.60, 0.25],
    sunColour: [0.62, 0.66, 0.78],
    ambient: 0.62,
    fogNear: 14,
    fogFar: 110,
    rain: 1,
    scar: 'wet',
    dull: 0.88,
    ...NO_MOON,
  },
  fog: {
    sky: [0.72, 0.74, 0.76],
    horizon: [0.80, 0.81, 0.82],
    floor: [0.66, 0.69, 0.72],
    sun: [0.20, 0.95, 0.10],
    sunColour: [0.88, 0.89, 0.90],
    ambient: 0.78,
    fogNear: 6,
    fogFar: 55,
    rain: 0.18,
    scar: 'pale',
    dull: 0.82,
    ...NO_MOON,
  },
  dusk: {
    sky: [0.29, 0.26, 0.50],
    horizon: [0.95, 0.55, 0.32],
    floor: [0.42, 0.34, 0.46],
    sun: [-0.80, 0.22, 0.30],
    sunColour: [1.00, 0.68, 0.42],
    ambient: 0.80,
    fogNear: 22,
    fogFar: 170,
    rain: 0,
    scar: null,
    dull: 0.35,
    ...NO_MOON,
  },
  night: {
    sky: [0.06, 0.09, 0.19],
    horizon: [0.14, 0.19, 0.32],
    floor: [0.10, 0.14, 0.24],
    sun: [-0.30, 0.75, -0.40],
    sunColour: [0.55, 0.66, 0.95],
    ambient: 0.52,
    fogNear: 18,
    fogFar: 130,
    rain: 0,
    scar: null,
    dull: 0.30,
    ...NO_MOON,
  },
};

/** Whatever a step names, as numbers. */
export function resolve(weather) {
  if (!weather) return PRESETS.clear;
  if (typeof weather === 'string') {
    const preset = PRESETS[weather];
    if (!preset) throw new Error(`unknown weather "${weather}"`);
    return preset;
  }
  const base = { ...PRESETS.clear, ...weather };
  // No hour means no clock, and the preset answers on its own exactly as it
  // always did. This is the line that keeps every canvas built before the
  // clock existed looking identical.
  return typeof base.hour === 'number' && Number.isFinite(base.hour)
    ? underSky(base, base.hour)
    : base;
}

/**
 * A weather at an hour.
 *
 * The hour owns where the light comes from and what colour the sky is; the
 * weather owns how much of it survives. `dull` is the whole of the
 * negotiation: at 0 the sky is exactly the hour's, at 1 it is exactly the
 * preset's, and a storm sits near the top of that because a storm looks like a
 * storm at any hour while a clear sky looks like whatever time it is.
 *
 * Ambient light multiplies rather than mixes, because the two are saying
 * different things: the hour says how much light there is and the weather says
 * what fraction of it gets through. Overcast at midnight is darker than either
 * on its own, which is correct.
 */
export function underSky(base, hour) {
  const day = atHour(hour);
  const dull = Math.min(1, Math.max(0, base.dull ?? 0));
  return {
    ...base,
    hour: day.hour,
    sun: day.sun,
    moon: day.moon,
    sunUp: day.sunUp,
    moonUp: day.moonUp,
    night: day.night,
    sky: mixAll(day.sky, base.sky, dull),
    horizon: mixAll(day.horizon, base.horizon, dull),
    floor: mixAll(day.floor, base.floor, dull),
    sunColour: mixAll(day.sunColour, base.sunColour, dull),
    ambient: day.ambient * base.ambient,
  };
}

// The precise form, rather than a + (b - a) * t. It returns exactly `a` at 0
// and exactly `b` at 1, which matters because a settled step must be its own
// weather and not a value a rounding error away from it.
const mix = (a, b, t) => a * (1 - t) + b * t;
const mixAll = (a, b, t) => a.map((v, i) => mix(v, b[i], t));

/**
 * Cross-fade, for the flight between two steps.
 *
 * Everything numeric interpolates. `scar` does not, because a mark on the
 * ground is a thing that either happened or did not; it belongs to the step
 * being arrived at, and it lands when that step does.
 */
export function lerpWeather(from, to, t) {
  const a = resolve(from);
  const b = resolve(to);
  const k = Math.min(1, Math.max(0, t));
  const blended = {
    sky: mixAll(a.sky, b.sky, k),
    horizon: mixAll(a.horizon, b.horizon, k),
    floor: mixAll(a.floor, b.floor, k),
    sun: mixAll(a.sun, b.sun, k),
    moon: mixAll(a.moon ?? PRESETS.clear.moon, b.moon ?? PRESETS.clear.moon, k),
    sunColour: mixAll(a.sunColour, b.sunColour, k),
    ambient: mix(a.ambient, b.ambient, k),
    sunUp: mix(a.sunUp ?? 1, b.sunUp ?? 1, k),
    moonUp: mix(a.moonUp ?? 0, b.moonUp ?? 0, k),
    night: mix(a.night ?? 0, b.night ?? 0, k),
    fogNear: mix(a.fogNear, b.fogNear, k),
    fogFar: mix(a.fogFar, b.fogFar, k),
    rain: mix(a.rain ?? 0, b.rain ?? 0, k),
    dull: mix(a.dull ?? 0, b.dull ?? 0, k),
    scar: k >= 0.5 ? b.scar : a.scar,
  };

  // **The hour crosses the clock, not the numbers.** Two hours are two
  // directions, and mixing the vectors sends the sun through the middle of the
  // world rather than across the sky - at six in the morning against six in
  // the evening they are exactly opposite, and the midpoint has no direction at
  // all. Interpolating the hour and asking the sky again is the only thing that
  // produces a sun that travels.
  const hourA = typeof a.hour === 'number' ? a.hour : null;
  const hourB = typeof b.hour === 'number' ? b.hour : null;
  if (hourA === null && hourB === null) return blended;
  return underSky(blended, lerpHour(hourA ?? hourB, hourB ?? hourA, k));
}

/** Which steps leave a mark, and where. Used to build the scar map. */
export function stampsUpTo(steps, index) {
  const stamps = [];
  for (let i = 0; i <= Math.min(index, steps.length - 1); i++) {
    const { scar } = resolve(steps[i].weather);
    if (scar) stamps.push({ frame: steps[i].framing, kind: scar });
  }
  return stamps;
}
