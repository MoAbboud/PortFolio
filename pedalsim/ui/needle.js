// A needle has mass: it does not jump to its value, it is a damped spring chasing it.
//
//   acc = wn^2 * (target - angle) - 2 * zeta * wn * vel
//
// wn sets how quickly it follows, zeta how much it overshoots: below 1, a hair past the mark
// on a blip before settling. Display only - the simulation never sees a needle.

export const TACH = { wn: 32, zeta: 0.55 };
export const SPEEDO = { wn: 14, zeta: 0.85 };

export function createNeedle(spec, angle = 0) {
  return { ...spec, angle, vel: 0 };
}

// Steps the spring over dt seconds in small pieces, so a slow frame does not make it unstable.
export function chase(needle, target, dt) {
  const pieces = Math.max(1, Math.ceil(dt / 0.004));
  const h = dt / pieces;
  for (let i = 0; i < pieces; i++) {
    const acc = needle.wn * needle.wn * (target - needle.angle) - 2 * needle.zeta * needle.wn * needle.vel;
    needle.vel += acc * h;
    needle.angle += needle.vel * h;
  }
  return needle.angle;
}
