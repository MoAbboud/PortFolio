// The weather, as plain numbers.
//
// Pure module. Presets are starting points rather than a closed set: what a
// step actually stores is the numbers, so a scene can be nudged without
// inventing a preset. Nothing here knows about WebGL.

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
  return { ...PRESETS.clear, ...weather };
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
  return {
    sky: mixAll(a.sky, b.sky, k),
    horizon: mixAll(a.horizon, b.horizon, k),
    floor: mixAll(a.floor, b.floor, k),
    sun: mixAll(a.sun, b.sun, k),
    sunColour: mixAll(a.sunColour, b.sunColour, k),
    ambient: mix(a.ambient, b.ambient, k),
    fogNear: mix(a.fogNear, b.fogNear, k),
    fogFar: mix(a.fogFar, b.fogFar, k),
    rain: mix(a.rain ?? 0, b.rain ?? 0, k),
    scar: k >= 0.5 ? b.scar : a.scar,
  };
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
