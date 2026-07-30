// Turning a click into "which object is under the cursor", and into "where on
// the ground did that land".
//
// Pure module. No DOM, no WebGL. Boxes rather than exact cubes: a bounding box
// is accurate enough to grab a house or a car, it costs nothing, and it keeps
// every part of this testable in Node. Reading object ids back from the GPU
// would be pixel-exact and would need a second render pass to get there.

import { FOV_Y, ASPECT, framingToView } from './camera.js';

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
function normalise(v) {
  const n = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / n, v[1] / n, v[2] / n];
}

/**
 * Where a point in the frame is, as -1..1 on each axis.
 *
 * `view` is the letterboxed rectangle in CSS pixels, not the whole canvas, so a
 * click in a black bar correctly falls outside the frame.
 */
export function toNdc(clientX, clientY, view) {
  return [
    ((clientX - view.x) / view.w) * 2 - 1,
    1 - ((clientY - view.y) / view.h) * 2,
  ];
}

export const insideFrame = ([x, y]) => x >= -1 && x <= 1 && y >= -1 && y <= 1;

/** The ray leaving the eye through a point in the frame. */
export function rayThrough(framing, ndc) {
  const { eye, target } = framingToView(framing);
  const forward = normalise(sub(target, eye));
  const right = normalise(cross(forward, [0, 1, 0]));
  const up = cross(right, forward);

  const tanY = Math.tan(FOV_Y / 2);
  const tanX = tanY * ASPECT;
  const [nx, ny] = ndc;

  const direction = normalise([
    forward[0] + right[0] * nx * tanX + up[0] * ny * tanY,
    forward[1] + right[1] * nx * tanX + up[1] * ny * tanY,
    forward[2] + right[2] * nx * tanX + up[2] * ny * tanY,
  ]);
  return { origin: eye, direction };
}

/** Slab method. Returns the distance along the ray, or null for a miss. */
export function intersectBox(ray, box) {
  let near = -Infinity;
  let far = Infinity;
  for (let a = 0; a < 3; a++) {
    const d = ray.direction[a];
    if (Math.abs(d) < 1e-9) {
      if (ray.origin[a] < box.min[a] || ray.origin[a] > box.max[a]) return null;
      continue;
    }
    const t1 = (box.min[a] - ray.origin[a]) / d;
    const t2 = (box.max[a] - ray.origin[a]) / d;
    near = Math.max(near, Math.min(t1, t2));
    far = Math.min(far, Math.max(t1, t2));
  }
  if (far < Math.max(near, 0)) return null;
  return near >= 0 ? near : far;
}

/** The nearest object the ray meets, or null. */
export function pick(ray, boxes) {
  let best = null;
  for (let i = 0; i < boxes.length; i++) {
    const distance = intersectBox(ray, boxes[i]);
    if (distance === null) continue;
    if (!best || distance < best.distance) best = { index: i, distance };
  }
  return best;
}

/** Where the ray meets the ground, which is where a dragged object goes. */
export function groundPoint(ray, height = 0) {
  const dy = ray.direction[1];
  if (Math.abs(dy) < 1e-6) return null;
  const t = (height - ray.origin[1]) / dy;
  if (t <= 0) return null;
  return [
    ray.origin[0] + ray.direction[0] * t,
    height,
    ray.origin[2] + ray.direction[2] * t,
  ];
}

/**
 * Move an object so the point that was grabbed stays under the cursor.
 *
 * Dragging from the object's centre would make it jump the moment you took
 * hold of an edge, which reads as the tool fighting you.
 */
export function dragTo(placement, grabOffset, ground) {
  if (!ground) return placement;
  return {
    ...placement,
    at: [ground[0] + grabOffset[0], placement.at[1], ground[2] + grabOffset[2]],
  };
}

export const rotateBy = (placement, degrees) => ({
  ...placement,
  rot: (((placement.rot ?? 0) + degrees) % 360 + 360) % 360,
});
