// The engine's power pulses, through one full cycle of two crank turns: what the engine lines
// draw and what makes the tachometer tremble at idle.
//
// Each cylinder fires once every 720 degrees. Its push on the crank is a hump through the
// power stroke and a smaller pull back through compression. The cylinders fire evenly spaced,
// 720 / cylinders degrees apart, alternating between the two banks of the V. A V4's pulses
// stand apart and its total is jagged; a V12's overlap and its total is nearly flat. That is
// why a V12 is smooth - and here it is computed, not drawn.
//
// Display only, so this may use Math.sin freely.

const COMPRESSION = 0.4; // compression's pull back, as a share of the power stroke's push
const PEAK_DEG = 35; // the push peaks this far past top dead centre, then fades as gas expands

// A symmetric hump was tried first and made the V8 rougher than the V6 - an artefact of the
// shape, not the engines. A real power stroke peaks early and fades, and with that shape the
// more cylinders, the smoother, at every count.
function cylinderPulse(deg) {
  const d = ((deg % 720) + 720) % 720;
  if (d < 180) return (d / PEAK_DEG) * Math.exp(1 - d / PEAK_DEG);
  if (d >= 540) return -COMPRESSION * Math.sin(((d - 540) * Math.PI) / 180);
  return 0;
}

// Torque against crank angle, sampled at `samples` points over 720 degrees, for each bank and
// the two together, scaled so that the total averages 1.
export function pulses(cylinders, samples = 360) {
  const a = new Float32Array(samples);
  const b = new Float32Array(samples);
  const sum = new Float32Array(samples);
  const gap = 720 / cylinders;
  for (let i = 0; i < samples; i++) {
    const deg = (i / samples) * 720;
    for (let c = 0; c < cylinders; c++) {
      const p = cylinderPulse(deg - c * gap);
      if (c % 2 === 0) a[i] += p;
      else b[i] += p;
    }
  }
  let mean = 0;
  for (let i = 0; i < samples; i++) {
    sum[i] = a[i] + b[i];
    mean += sum[i];
  }
  mean /= samples;
  for (let i = 0; i < samples; i++) {
    a[i] /= mean;
    b[i] /= mean;
    sum[i] /= mean;
  }
  return { a, b, sum };
}

// How rough the total is: its swing from lowest to highest, as a multiple of its average.
export function roughness(cylinders) {
  const { sum } = pulses(cylinders);
  let lo = Infinity;
  let hi = -Infinity;
  for (const s of sum) {
    if (s < lo) lo = s;
    if (s > hi) hi = s;
  }
  return hi - lo;
}

// How far the crank speed swings between firings, in rpm: the pulses' excess torque over half
// a firing gap, against the engine's inertia at its speed. Large at idle on a V4, nothing on a
// V12 at speed. `torque` is the engine's average combustion torque at the moment.
export function tremble(engine, rpm, torque) {
  if (rpm < 100 || torque <= 0) return 0;
  const omega = (rpm * Math.PI) / 30;
  const halfGap = ((720 / engine.cylinders) * Math.PI) / 360;
  const swing = (roughness(engine.cylinders) / 2) * torque * halfGap / (engine.inertia * omega);
  return Math.min(150, (swing * 30) / Math.PI);
}
