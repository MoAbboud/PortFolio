// Tables instead of formulas.
//
// The engine's curves are computed once, by tools/build-engines.js, with whatever maths it
// likes, and stored as numbers. At runtime they are only ever read back by straight-line
// interpolation, which is plain arithmetic and gives the same answer on every machine.
//
// A table is evenly spaced: { start, step, values }, where values[i] is the curve at
// start + i * step. Even spacing makes a lookup one division instead of a search.

// The curve at x. Outside the table, the end value: a curve never extrapolates into numbers
// nothing computed.
export function lookup(table, x) {
  const { start, step, values } = table;
  const last = values.length - 1;
  const at = (x - start) / step;
  if (!(at > 0)) return values[0]; // also catches NaN, which should never reach a needle
  if (at >= last) return values[last];
  const i = Math.floor(at);
  const f = at - i;
  return values[i] + (values[i + 1] - values[i]) * f;
}

export function clamp(x, lo, hi) {
  return x < lo ? lo : x > hi ? hi : x;
}
