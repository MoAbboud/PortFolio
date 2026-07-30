// Roaming: turning mouse and key input into framings.
//
// Pure module. No DOM, no events, no state. Every function takes a framing and
// returns a new one, so free roaming produces exactly the same kind of value
// the route is made of - which is what lets any angle you find be saved as a
// step, with no conversion and nothing lost.

export const PITCH_MIN = 1.5;
export const PITCH_MAX = 89;
export const WIDTH_MIN = 1.2;
export const WIDTH_MAX = 400;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const rad = (deg) => (deg * Math.PI) / 180;

/** Keep yaw in -180..180 so it reads sensibly and never grows without bound. */
export const wrapYaw = (deg) => {
  let a = (deg + 180) % 360;
  if (a < 0) a += 360;
  return a - 180;
};

export const centreOf = (framing) => [framing.x + framing.w / 2, framing.z + framing.d / 2];

export const withCentre = (framing, cx, cz) => ({
  ...framing,
  x: cx - framing.w / 2,
  z: cz - framing.d / 2,
});

/** Swing around the point being looked at. */
export function orbit(framing, dYaw, dPitch) {
  return {
    ...framing,
    yaw: wrapYaw((framing.yaw ?? 0) + dYaw),
    pitch: clamp((framing.pitch ?? 25) + dPitch, PITCH_MIN, PITCH_MAX),
  };
}

/** Move closer or further, keeping the same point in the middle of the frame. */
export function zoom(framing, factor) {
  const [cx, cz] = centreOf(framing);
  const aspect = framing.d / framing.w;
  const w = clamp(framing.w * factor, WIDTH_MIN, WIDTH_MAX);
  return withCentre({ ...framing, w, d: w * aspect }, cx, cz);
}

/**
 * Drag the ground.
 *
 * Screen pixels become world units through the frame's own width, so a drag
 * moves the scene by roughly the distance under the pointer however far out you
 * are. The vertical axis is divided by the pitch, because a shallow camera sees
 * the ground heavily foreshortened and would otherwise feel stuck.
 */
export function panScreen(framing, dxPixels, dyPixels, viewportWidth) {
  const perPixel = framing.w / Math.max(1, viewportWidth);
  const yaw = rad(framing.yaw ?? 0);
  const pitch = rad(framing.pitch ?? 25);

  const right = [Math.cos(yaw), -Math.sin(yaw)];
  const forward = [-Math.sin(yaw), -Math.cos(yaw)];

  const acrossFrame = dxPixels * perPixel;
  const intoFrame = (dyPixels * perPixel) / Math.max(Math.sin(pitch), 0.25);

  const [cx, cz] = centreOf(framing);
  return withCentre(
    framing,
    cx - right[0] * acrossFrame + forward[0] * intoFrame,
    cz - right[1] * acrossFrame + forward[1] * intoFrame,
  );
}

/** Walk on the ground, relative to where the camera is facing. */
export function walk(framing, forwardAmount, rightAmount) {
  const yaw = rad(framing.yaw ?? 0);
  const [cx, cz] = centreOf(framing);
  const step = framing.w * 0.06;
  return withCentre(
    framing,
    cx + (-Math.sin(yaw) * forwardAmount + Math.cos(yaw) * rightAmount) * step,
    cz + (-Math.cos(yaw) * forwardAmount - Math.sin(yaw) * rightAmount) * step,
  );
}

/** A framing that takes in everything, for when you have roamed off somewhere. */
export function fit(bounds, { pitch = 42, yaw = 0, margin = 1.25 } = {}) {
  const w = Math.max(WIDTH_MIN, (bounds.max[0] - bounds.min[0]) * margin);
  const d = Math.max(WIDTH_MIN, (bounds.max[2] - bounds.min[2]) * margin);
  const cx = (bounds.min[0] + bounds.max[0]) / 2;
  const cz = (bounds.min[2] + bounds.max[2]) / 2;
  return { x: cx - w / 2, z: cz - d / 2, w, d, pitch, yaw };
}

/** Round a framing to something worth pasting into a route. */
export function tidy(framing, places = 2) {
  const round = (v) => Number(v.toFixed(places));
  return {
    x: round(framing.x),
    z: round(framing.z),
    w: round(framing.w),
    d: round(framing.d),
    pitch: round(framing.pitch ?? 25),
    yaw: round(framing.yaw ?? 0),
  };
}
