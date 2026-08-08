// The time of day: where the sun is, whether the moon is up, and what that
// does to the light.
//
// Pure module. One number goes in - the hour, 0 to 24 - and the sky comes out.
// 6 is sunrise, 12 is noon, 18 is sunset, and the sun is below the horizon
// either side of that.
//
// **This is not weather, and the two are deliberately separate.** The hour says
// where the light comes from and what colour it is; the weather says how much
// of it gets through, how far you can see, whether it is raining, and what that
// leaves on the ground. A storm at nine in the morning and a storm at nine at
// night are the same weather at two different hours, and before this there was
// no way to say so - `dusk` and `night` were presets, which meant the time of
// day was a fixed choice from a list of six rather than a dial.
//
// Nothing here knows about WebGL, and nothing runs per frame: an hour resolves
// to a handful of numbers that go into uniforms, exactly as a weather preset
// already did.

const TAU = Math.PI * 2;

// The sky at a given sun elevation, from below the horizon to overhead.
// Elevation is the sine of the sun's angle: 1 straight up, 0 on the horizon,
// -1 straight down. The keys are chosen where the sky actually changes rather
// than at even intervals - almost everything interesting happens within a
// tenth of the horizon, which is why sunrise is worth watching and noon is not.
const SKY = [
  {
    at: -0.35,                          // properly night
    sky: [0.04, 0.06, 0.14],
    horizon: [0.09, 0.13, 0.24],
    floor: [0.07, 0.10, 0.18],
    sunColour: [0.42, 0.52, 0.82],
    ambient: 0.40,
  },
  {
    at: -0.10,                          // the last of the light
    sky: [0.12, 0.14, 0.30],
    horizon: [0.38, 0.28, 0.40],
    floor: [0.16, 0.18, 0.30],
    sunColour: [0.72, 0.52, 0.62],
    ambient: 0.55,
  },
  {
    at: 0.0,                            // the sun exactly on the horizon
    sky: [0.31, 0.30, 0.52],
    horizon: [0.98, 0.56, 0.30],
    floor: [0.44, 0.36, 0.44],
    sunColour: [1.00, 0.62, 0.34],
    ambient: 0.74,
  },
  {
    at: 0.18,                           // an hour or so in, still golden
    sky: [0.40, 0.56, 0.84],
    horizon: [0.96, 0.78, 0.62],
    floor: [0.46, 0.60, 0.80],
    sunColour: [1.00, 0.86, 0.68],
    ambient: 0.90,
  },
  {
    at: 1.0,                            // overhead
    sky: [0.34, 0.60, 0.92],
    horizon: [0.76, 0.88, 0.98],
    floor: [0.42, 0.68, 0.90],
    sunColour: [1.00, 0.96, 0.86],
    ambient: 1.00,
  },
];

const mix = (a, b, t) => a * (1 - t) + b * t;
const mixAll = (a, b, t) => a.map((v, i) => mix(v, b[i], t));
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/** Read the table at an elevation, interpolating between its keys. */
function skyAt(elevation) {
  const e = clamp(elevation, SKY[0].at, SKY[SKY.length - 1].at);
  let i = 0;
  while (i < SKY.length - 2 && e > SKY[i + 1].at) i++;
  const a = SKY[i];
  const b = SKY[i + 1];
  const t = b.at === a.at ? 0 : (e - a.at) / (b.at - a.at);
  return {
    sky: mixAll(a.sky, b.sky, t),
    horizon: mixAll(a.horizon, b.horizon, t),
    floor: mixAll(a.floor, b.floor, t),
    sunColour: mixAll(a.sunColour, b.sunColour, t),
    ambient: mix(a.ambient, b.ambient, t),
  };
}

/**
 * Where the sun is at a given hour.
 *
 * It rises in the east at 6, is overhead at 12 and sets in the west at 18,
 * which is a day at an equinox rather than at a latitude. That is the right
 * amount of astronomy for this: the point is a sun that moves and an hour that
 * means something, not a model of the Earth.
 *
 * The path is tilted slightly so the sun never passes exactly through the
 * camera's own axis at noon, which would put a flat highlight over everything
 * at once and read as a mistake.
 */
export function sunAt(hour) {
  const h = ((Number(hour) || 0) % 24 + 24) % 24;
  // Zero at sunrise, a half turn at sunset, so the sun sweeps the sky in the
  // twelve hours between them and is under it for the other twelve.
  const angle = (Math.PI * (h - 6)) / 12;
  const tilt = 0.22;
  const y = Math.sin(angle);
  const x = -Math.cos(angle);
  const z = tilt * Math.cos(angle * 0.5);
  const length = Math.hypot(x, y, z) || 1;
  return [x / length, y / length, z / length];
}

/**
 * Everything the hour decides.
 *
 * `sun` and `moon` are directions toward each body. `sunUp` and `moonUp` are
 * how far above the horizon each is, clamped to zero below it, which is what
 * the sky uses to decide how brightly to draw them - a moon that snaps on at
 * six o'clock is worse than no moon at all.
 */
export function atHour(hour) {
  const sun = sunAt(hour);
  // The moon opposes the sun, which is a full moon every night. A phase would
  // be one more number for a shape a viewer sees for two seconds at a time.
  const moon = [-sun[0], -sun[1], -sun[2]];
  const look = skyAt(sun[1]);

  // Both fade across the horizon rather than switching. The width of that fade
  // is what makes dusk last a little while instead of an instant.
  //
  // Measured and then widened: at the first widths, the sun went from full to
  // nearly gone between six o'clock and ten past, which is faithful to a real
  // sunset and useless as a shot. These give about forty minutes of handover
  // either side, where the sun is low and the moon is already up - which is the
  // part of the day worth pointing a camera at.
  const sunUp = clamp((sun[1] + 0.10) / 0.22, 0, 1);
  const moonUp = clamp((moon[1] + 0.04) / 0.20, 0, 1);

  return {
    hour: ((Number(hour) || 0) % 24 + 24) % 24,
    sun,
    moon,
    sunUp,
    moonUp,
    // How much of the sky is dark enough for stars. They come in later than the
    // moon does, because a sky with the sun just under it is still bright.
    night: clamp((-sun[1] - 0.08) / 0.25, 0, 1),
    ...look,
  };
}

/** The hour, as a label a person reads. Used by the panel and nothing else. */
export function clockOf(hour) {
  const h = ((Number(hour) || 0) % 24 + 24) % 24;
  const whole = Math.floor(h);
  const minutes = Math.round((h - whole) * 60);
  const carried = minutes === 60 ? 0 : minutes;
  const shown = minutes === 60 ? (whole + 1) % 24 : whole;
  return `${String(shown).padStart(2, '0')}:${String(carried).padStart(2, '0')}`;
}

/**
 * The shortest way round the clock from one hour to another.
 *
 * A flight from 23:00 to 01:00 is two hours forward, not twenty-two hours
 * back, and interpolating the raw numbers would run the sun backwards across
 * the whole sky in the middle of a shot.
 */
export function lerpHour(from, to, t) {
  const a = ((Number(from) || 0) % 24 + 24) % 24;
  const b = ((Number(to) || 0) % 24 + 24) % 24;
  let delta = b - a;
  if (delta > 12) delta -= 24;
  if (delta < -12) delta += 24;
  return ((a + delta * clamp(t, 0, 1)) % 24 + 24) % 24;
}

export { TAU };
