// The driver's inputs, as the simulation sees them.
//
// Pedals are whole numbers from 0 to PEDAL_MAX, never fractions. A keyboard ramp, a mouse
// drag and a controller trigger all produce fractions; they are rounded once, here, at the
// step boundary, and the rounded number is what the step uses and what a run log stores.
// So a live run and its replay see exactly the same inputs - which is the whole of what a
// replay is.

export const PEDAL_MAX = 1023;

export const PEDALS = ['thr', 'brake', 'clutch'];

// Every channel and the values it accepts. gear: -1 reverse, 0 neutral, 1 to 6 for a manual,
// P R N D for an automatic. key: the start key, held (1) or released (0).
export const CHANNELS = {
  thr: (v) => Number.isInteger(v) && v >= 0 && v <= PEDAL_MAX,
  brake: (v) => Number.isInteger(v) && v >= 0 && v <= PEDAL_MAX,
  clutch: (v) => Number.isInteger(v) && v >= 0 && v <= PEDAL_MAX,
  gear: (v) => (Number.isInteger(v) && v >= -1 && v <= 6) || ['P', 'R', 'N', 'D'].includes(v),
  key: (v) => v === 0 || v === 1,
};

export function emptyInputs() {
  return { thr: 0, brake: 0, clutch: 0, gear: 0, key: 0 };
}

// A pedal position from 0 to 1, as any input device produces it, to the integer the
// simulation uses. Out-of-range values are clamped: a controller axis that reads 1.0002
// is a fully pressed pedal, not an error.
export function quantise(fraction) {
  const clamped = fraction < 0 ? 0 : fraction > 1 ? 1 : fraction;
  return Math.round(clamped * PEDAL_MAX);
}

// The step reads pedals as fractions; this is the only place that turns them back.
export function pedal(inputs, name) {
  return inputs[name] / PEDAL_MAX;
}

// Returns a new inputs object with one channel changed. Throws on an unknown channel or a
// value the channel does not accept: a run log with a bad event is a broken log, and
// replaying it quietly would produce a run nobody drove.
export function applyEvent(inputs, channel, value) {
  const accepts = CHANNELS[channel];
  if (!accepts) throw new Error(`unknown input channel "${channel}"`);
  if (!accepts(value)) throw new Error(`${channel} cannot be ${JSON.stringify(value)}`);
  return { ...inputs, [channel]: value };
}
