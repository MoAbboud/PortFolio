// The H-pattern: where the gear knob can go, and which gear a position means.
//
//     R   1   3   5
//     |   |   |   |
//     +---+---+---+     the neutral rail
//         |   |   |
//         2   4   6
//
// The knob lives on line segments - the rail, and a slot per gate - and a dragged pointer is
// moved to the nearest point on them, so the knob goes only where a real one can. Positions
// are in gate units: x from 0 (the reverse column) to 3, y from -1 (the top of a slot) through
// 0 (the rail) to 1 (the bottom). Reverse's column has no bottom half.
//
// Pure, so the tests check it; ui/stick.js draws it and takes the pointer.

const TOP = { 0: -1, 1: 1, 2: 3, 3: 5 };
const BOTTOM = { 1: 2, 2: 4, 3: 6 };
// Past this far into a slot, the stick is asking for that gear.
export const IN_GEAR = 0.75;

const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);

// The nearest point to (x, y) that the knob can actually reach.
export function project(x, y) {
  const candidates = [{ x: clamp(x, 0, 3), y: 0 }];
  for (let c = 0; c <= 3; c++) candidates.push({ x: c, y: clamp(y, -1, c === 0 ? 0 : 1) });
  let best = candidates[0];
  let bestD = Infinity;
  for (const p of candidates) {
    const d = (p.x - x) ** 2 + (p.y - y) ** 2;
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return best;
}

// The gear a knob position asks for: 0 for neutral, -1 for reverse.
export function gearAt({ x, y }) {
  if (Math.abs(y) < IN_GEAR) return 0;
  const c = Math.round(x);
  return (y < 0 ? TOP[c] : BOTTOM[c]) ?? 0;
}

// Where the knob sits for a gear: the end of its slot, or the rail for neutral.
export function positionOf(gear, railX = 1.5) {
  for (const [c, g] of Object.entries(TOP)) if (g === gear) return { x: Number(c), y: -1 };
  for (const [c, g] of Object.entries(BOTTOM)) if (g === gear) return { x: Number(c), y: 1 };
  return { x: railX, y: 0 };
}

// One gear up or down, as a sequential shift from the keyboard or a controller: neutral sits
// between reverse and first.
export function sequential(gear, by) {
  const order = [-1, 0, 1, 2, 3, 4, 5, 6];
  const i = order.indexOf(gear);
  return order[clamp(i + by, 0, order.length - 1)];
}
