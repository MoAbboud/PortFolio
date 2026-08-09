// Time as a direction you can point a camera at.
//
// Pure module. The whole of Trail's fourth dimension is one line - a distance
// along the canvas is an hour - and everything else here is that line read
// forwards, backwards, or over a range.
//
//     x = (hour - origin) * spacing
//
// **This is what replaced step ranges.** An object used to carry `from` and
// `until` and the shader faded it in and out against the step being shown. It
// carries neither now: a thing that has not happened yet is simply further down
// the strip, and distance does the work that the ghosting fade was built for.
//
// Nothing here knows about WebGL, the DOM, or what a moment contains.

import { FOV_Y, ASPECT } from './camera.js';

/**
 * Units per hour, and the hour that sits at the origin.
 *
 * `spacing` is a control rather than a constant because a scene is roughly 20
 * to 40 units across, and how far apart two moments have to sit before they
 * stop overlapping is a judgement about the story being told. Forty units to
 * the hour puts half-hourly moments twenty apart, which is about one scene.
 */
export const DEFAULT_SPACING = 40;
export const DEFAULT_ORIGIN = 12;

// Below this the mapping stops being invertible in any useful way, and a strip
// with no length is a pile.
const MIN_SPACING = 0.01;

const isNumber = (v) => typeof v === 'number' && Number.isFinite(v);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** The two numbers that define the strip, with anything missing filled in. */
export function worldOf(world = {}) {
  return {
    spacing: Math.max(MIN_SPACING, isNumber(world.spacing) ? world.spacing : DEFAULT_SPACING),
    origin: isNumber(world.origin) ? world.origin : DEFAULT_ORIGIN,
  };
}

/** Where on the canvas an hour happens. */
export function xOf(hour, world) {
  const { spacing, origin } = worldOf(world);
  return ((isNumber(hour) ? hour : origin) - origin) * spacing;
}

/**
 * What time it is at a place on the canvas.
 *
 * The exact inverse of `xOf`, and it is used for more than symmetry: dropping
 * an object on the ground is choosing when it happens, so the panel can say so
 * while it is being dragged.
 */
export function hourOf(x, world) {
  const { spacing, origin } = worldOf(world);
  return origin + (isNumber(x) ? x : 0) / spacing;
}

/**
 * The stretch of canvas a story occupies, in hours.
 *
 * Null rather than a guess when there is nothing to measure. An empty canvas is
 * a valid canvas - that was settled a session ago - so this has to be answerable
 * with "there is no story yet" rather than with midnight to midnight.
 */
export function spanOf(moments = []) {
  const hours = moments
    .map((m) => m?.hour)
    .filter(isNumber);
  if (!hours.length) return null;
  return { from: Math.min(...hours), to: Math.max(...hours) };
}

/**
 * The extent of everything on the strip, along its own direction.
 *
 * Measured from the moments **and** from where things were actually placed,
 * because the two disagree in both directions: an object can be dropped past
 * the last moment, and a moment can be marked before anything has been placed
 * at it. The pull-back at the end has to take in whichever is wider, or it
 * cuts off the thing it exists to reveal.
 */
export function extentOf({ moments = [], objects = [], areas = [] } = {}, world) {
  const xs = [];
  for (const moment of moments) {
    if (isNumber(moment?.hour)) xs.push(xOf(moment.hour, world));
  }
  for (const object of objects) {
    if (isNumber(object?.at?.[0])) xs.push(object.at[0]);
  }
  for (const area of areas) {
    if (!isNumber(area?.at?.[0])) continue;
    const half = Math.abs(area?.size?.[0] ?? 0) / 2;
    xs.push(area.at[0] - half, area.at[0] + half);
  }
  if (!xs.length) return null;
  return { min: Math.min(...xs), max: Math.max(...xs) };
}

/**
 * How deep a ground rectangle has to be to fill the frame at a given pitch.
 *
 * The camera is expressed as a rectangle and a pitch, and the rectangle is
 * foreshortened by that pitch - so a wide shot from low down needs a much
 * deeper rectangle than the same width from overhead. Deriving the depth rather
 * than storing it is what lets the camera rig be four numbers instead of five,
 * and it means tilting never leaves the frame part empty.
 *
 * The floor under the sine matches the one `framingToView` already applies, so
 * the two agree at a pitch of nearly zero instead of dividing by it.
 */
export function depthFor(width, pitch = 25) {
  const sin = Math.max(Math.sin((pitch * Math.PI) / 180), 0.12);
  return width / (ASPECT * sin);
}

/** A camera rig, with anything missing filled in. */
export function rigOf(rig = {}) {
  return {
    yaw: isNumber(rig.yaw) ? rig.yaw : 0,
    pitch: clamp(isNumber(rig.pitch) ? rig.pitch : 22, 1.5, 89),
    width: Math.max(1.2, isNumber(rig.width) ? rig.width : 26),
    height: Math.max(0, isNumber(rig.height) ? rig.height : 0),
  };
}

/**
 * Where the camera is looking, at an hour.
 *
 * **This is the whole camera now.** It never travels: the clock decides which
 * stretch of the strip is in front of it, and the rig decides how it is being
 * looked at. Moving through time therefore changes where the camera is and
 * never what it is doing, which is the rule the clock bar was built on and the
 * reason it survived the redesign.
 *
 * The rectangle is centred across the strip - the story runs along x, so z stays
 * at nought - which is why a camera that only orbits can still see all of it.
 */
export function framingOf(rig, hour, world) {
  const { yaw, pitch, width, height } = rigOf(rig);
  const depth = depthFor(width, pitch);
  return {
    x: xOf(hour, world) - width / 2,
    z: -depth / 2,
    w: width,
    d: depth,
    y: height,
    pitch,
    yaw,
  };
}

/**
 * The framing that takes in the whole strip: the ending.
 *
 * Keeps the rig's yaw and lifts the pitch, because a timeline read end to end
 * is read from above - at the angle a close shot was composed at, the far end of
 * a long strip is a smear on the horizon.
 *
 * The width is what the extent needs plus a margin, so the reveal is fitted to
 * the story rather than to a number somebody typed.
 */
export function revealFraming(rig, extent, { margin = 1.15, pitch = 52 } = {}) {
  const base = rigOf(rig);
  if (!extent) return framingOf({ ...base, pitch }, 0, { spacing: 1, origin: 0 });
  const width = Math.max(base.width, (extent.max - extent.min) * margin);
  const depth = depthFor(width, pitch);
  const centre = (extent.min + extent.max) / 2;
  return {
    x: centre - width / 2,
    z: -depth / 2,
    w: width,
    d: depth,
    y: base.height,
    pitch,
    yaw: base.yaw,
  };
}

/**
 * How far the fog may be pushed back for a given shot.
 *
 * **Fog measured in fixed world units is what would ruin the ending.** It runs
 * from 26 to 180 units, which is right for a scene in a room and shorter than a
 * strip of a whole afternoon - so pulling back to reveal the timeline would show
 * it fading into the sky exactly when it is meant to be readable.
 *
 * Tying it to the width of the shot fixes both ends at once: close in, the fog
 * is where it always was and still gives depth; pulled back, it opens up ahead
 * of the strip rather than swallowing it.
 */
export function fogFor(width, { near = 26, far = 180, reference = 26 } = {}) {
  const scale = Math.max(1, width / reference);
  return { near: near * scale, far: far * scale };
}

/**
 * Playback: the clock running from the first moment to the last.
 *
 * A take used to be a route of framings with a flight between each pair. It is
 * now one number moving, because the camera is not routed any more - so this
 * returns the hour, and the caller asks `framingOf` where that puts the camera.
 *
 * `rate` is hours of story per second of video. `hold` is a rest **at** a
 * moment, which is what paces a shot against a narration, and it is the one
 * field of a step that survived the redesign.
 *
 * Past the end it rests on the last moment rather than wrapping, for the same
 * reason `routeAtHour` does: a story that runs backwards through itself is not
 * an ending.
 */
export function clockAt(moments = [], seconds, { rate = 0.5 } = {}) {
  const timed = moments
    .map((moment, index) => ({ moment, index }))
    .filter(({ moment }) => isNumber(moment?.hour))
    .sort((a, b) => a.moment.hour - b.moment.hour || a.index - b.index);

  if (!timed.length) return null;

  const speed = Math.max(1e-6, rate);
  let t = Math.max(0, isNumber(seconds) ? seconds : 0);

  for (let i = 0; i < timed.length; i++) {
    const { moment, index } = timed[i];
    const rest = Math.max(0, moment.hold ?? 0) / 1000;
    if (t < rest) {
      return { hour: moment.hour, moment: index, resting: true, done: false };
    }
    t -= rest;

    const next = timed[i + 1];
    if (!next) return { hour: moment.hour, moment: index, resting: false, done: true };

    const travel = Math.abs(next.moment.hour - moment.hour) / speed;
    if (t < travel) {
      const into = travel > 0 ? t / travel : 1;
      return {
        hour: moment.hour + (next.moment.hour - moment.hour) * into,
        moment: index,
        resting: false,
        done: false,
      };
    }
    t -= travel;
  }

  const last = timed[timed.length - 1];
  return { hour: last.moment.hour, moment: last.index, resting: false, done: true };
}

/** How long a take runs, in seconds, so it can be checked against a narration. */
export function takeDuration(moments = [], { rate = 0.5 } = {}) {
  const timed = moments.filter((m) => isNumber(m?.hour)).sort((a, b) => a.hour - b.hour);
  if (!timed.length) return 0;
  const speed = Math.max(1e-6, rate);
  let total = 0;
  timed.forEach((moment, i) => {
    total += Math.max(0, moment.hold ?? 0) / 1000;
    const next = timed[i + 1];
    if (next) total += Math.abs(next.hour - moment.hour) / speed;
  });
  return total;
}

// Re-exported so a caller composing a shot does not have to import two modules
// to find out what the frame is shaped like.
export { FOV_Y, ASPECT };
