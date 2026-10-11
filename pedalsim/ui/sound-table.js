// One engine cycle of sound: the pressure pulses its cylinders send down the exhaust, over two
// turns of the crank.
//
// Each cylinder fires once every 720 degrees, evenly spaced, and each firing is a short, sharp
// pulse. The table holds one engine cycle, so played back at the speed the crank is turning it
// repeats rpm / 120 times a second, and its pulses arrive cylinders / 2 times a revolution -
// the firing frequency every engine note is built on. A V4's four pulses stand apart and buzz;
// a V12's twelve run together into a howl. No two cylinders are quite alike, so each pulse is a little different in strength,
// the same way every time - which is what gives a V8 its burble.
//
// Display code: Math.exp and Math.sin are fine here.

export const TABLE_SIZE = 2048;

// A small, repeatable difference per cylinder, from the engine's name, so every V8 sounds
// like the V8 and not like a random one.
function unevenness(seed, cylinders) {
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  const out = [];
  for (let c = 0; c < cylinders; c++) {
    h = Math.imul(h ^ (c + 1), 2654435761) >>> 0;
    out.push(0.82 + 0.18 * ((h % 1000) / 1000));
  }
  return out;
}

// The table, and the angle of each pulse - for the tests.
export function engineTable(engine) {
  const n = engine.cylinders;
  const gap = 720 / n;
  const width = 9 + 36 / n; // degrees: narrower pulses for fewer cylinders, so a V4 cracks
  const strength = unevenness(engine.id, n);
  const table = new Float32Array(TABLE_SIZE);
  for (let i = 0; i < TABLE_SIZE; i++) {
    const deg = (i / TABLE_SIZE) * 720;
    let p = 0;
    for (let c = 0; c < n; c++) {
      // The nearest copy of this cylinder's pulse, wrapping round the cycle.
      let d = deg - c * gap;
      d -= 720 * Math.round(d / 720);
      p += strength[c] * Math.exp(-((d / width) ** 2));
    }
    table[i] = p;
  }
  // Centred on zero and scaled to a peak of one, so the level is the same for every engine and
  // only the shape differs.
  let mean = 0;
  for (const v of table) mean += v;
  mean /= TABLE_SIZE;
  let peak = 0;
  for (let i = 0; i < TABLE_SIZE; i++) {
    table[i] -= mean;
    peak = Math.max(peak, Math.abs(table[i]));
  }
  for (let i = 0; i < TABLE_SIZE; i++) table[i] /= peak;
  return { table, firingAngles: Array.from({ length: n }, (_, c) => c * gap) };
}

// The firing frequency at an rpm, in hertz: what the ear hears as the engine's pitch.
export function firingHz(engine, rpm) {
  return (rpm / 60) * (engine.cylinders / 2);
}
