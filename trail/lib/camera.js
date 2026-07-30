// The camera language: a rectangle drawn on the plan, and a pitch.
//
// Pure module. Given a framing, work out where the eye goes so that the
// rectangle fills the 16:9 frame. Nothing here knows about WebGL.
//
// A framing is { x, z, w, d, pitch, yaw, y }. x and z are the rectangle's near
// corner on the ground; pitch is degrees above the horizon, so 0 is standing on
// the ground and 90 is straight down. `y` lifts the point being looked at off
// the ground, which is how the camera climbs without tilting further down.

import { lookAt, perspective, multiply } from './mat4.js';

export const FOV_Y = (45 * Math.PI) / 180;
export const ASPECT = 16 / 9;
export const MARGIN = 1.08;

const rad = (deg) => (deg * Math.PI) / 180;

/**
 * Where the camera has to sit for this rectangle to fill the frame.
 *
 * The rectangle is foreshortened by the pitch, so its apparent height is its
 * depth times sin(pitch). Fit both axes and take whichever needs more distance.
 */
export function framingToView(framing) {
  const { x, z, w, d } = framing;
  const pitch = rad(framing.pitch ?? 25);
  const yaw = rad(framing.yaw ?? 0);

  const target = [x + w / 2, framing.y ?? 0, z + d / 2];

  const tanY = Math.tan(FOV_Y / 2);
  const tanX = tanY * ASPECT;
  const apparentHeight = Math.max(d * Math.sin(pitch), d * 0.12);

  const forWidth = (w / 2) / tanX;
  const forDepth = (apparentHeight / 2) / tanY;
  const distance = Math.max(forWidth, forDepth) * MARGIN;

  const eye = [
    target[0] + Math.sin(yaw) * Math.cos(pitch) * distance,
    target[1] + Math.sin(pitch) * distance,
    target[2] + Math.cos(yaw) * Math.cos(pitch) * distance,
  ];
  return { eye, target, distance };
}

/** The matrix a renderer actually wants. */
export function viewProjection(framing, near = 0.1, far = 800) {
  const { eye, target } = framingToView(framing);
  return {
    matrix: multiply(perspective(FOV_Y, ASPECT, near, far), lookAt(eye, target)),
    eye,
    target,
  };
}

// --- movement ---------------------------------------------------------------

export const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

// The precise form, so a flight lands exactly on its destination framing rather
// than a rounding error away from it.
const mix = (a, b, t) => a * (1 - t) + b * t;

/**
 * Interpolate the framing rather than the eye.
 *
 * This is the reason flights never clip through the ground or arrive somewhere
 * the composition did not ask for: every intermediate frame is a valid framing.
 * `arc` widens the rectangle mid-flight, which pulls the camera back and up, so
 * a move between two close shots lifts to show the ground in between.
 */
export function lerpFraming(a, b, t, arc = 0.35) {
  const e = easeInOut(Math.min(1, Math.max(0, t)));
  const lift = 1 + arc * Math.sin(Math.PI * e);
  const w = mix(a.w, b.w, e) * lift;
  const d = mix(a.d, b.d, e) * lift;
  const cx = mix(a.x + a.w / 2, b.x + b.w / 2, e);
  const cz = mix(a.z + a.d / 2, b.z + b.d / 2, e);
  return {
    x: cx - w / 2,
    z: cz - d / 2,
    w,
    d,
    y: mix(a.y ?? 0, b.y ?? 0, e),
    pitch: mix(a.pitch ?? 25, b.pitch ?? 25, e),
    yaw: mix(a.yaw ?? 0, b.yaw ?? 0, e),
  };
}

/**
 * The slow sway that runs under every shot, including a hold.
 * Small enough to be felt rather than noticed. Without it, a held framing on a
 * static world is a photograph.
 */
export function drift(framing, seconds, amount = 1) {
  const swing = 0.9 * amount;
  const breathe = 1 + 0.012 * amount * Math.sin(seconds * 0.31);
  const w = framing.w * breathe;
  const d = framing.d * breathe;
  return {
    ...framing,
    x: framing.x + (framing.w - w) / 2,
    z: framing.z + (framing.d - d) / 2,
    w,
    d,
    yaw: (framing.yaw ?? 0) + swing * Math.sin(seconds * 0.19),
    pitch: (framing.pitch ?? 25) + 0.5 * amount * Math.sin(seconds * 0.23 + 1.7),
  };
}

/**
 * Walk a route: hold on each framing, fly to the next.
 *
 * Returns the framing for a moment in time, which step it belongs to, and how
 * far through that phase it is. `into` is what the weather cross-fade and the
 * canvas solidifying are both driven by, so the two land together.
 */
export function routeAt(steps, seconds) {
  let t = seconds;
  for (let i = 0; i < steps.length; i++) {
    const hold = steps[i].hold / 1000;
    if (t < hold) {
      return { framing: steps[i].framing, step: i, phase: 'hold', into: hold ? t / hold : 1 };
    }
    t -= hold;
    const next = steps[i + 1];
    if (!next) return { framing: steps[i].framing, step: i, phase: 'end', into: 1 };
    const fly = (next.approachTime ?? 2500) / 1000;
    if (t < fly) {
      return {
        framing: lerpFraming(steps[i].framing, next.framing, t / fly),
        step: i,
        phase: 'fly',
        into: fly ? t / fly : 1,
      };
    }
    t -= fly;
  }
  const last = steps[steps.length - 1];
  return { framing: last.framing, step: steps.length - 1, phase: 'end', into: 1 };
}

export function routeDuration(steps) {
  return steps.reduce((total, step, i) => {
    const fly = i < steps.length - 1 ? (steps[i + 1].approachTime ?? 2500) : 0;
    return total + step.hold + fly;
  }, 0);
}
