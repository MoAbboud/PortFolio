// The film strip.
//
// Pure module. A canvas is an ordered list of **pieces**, each one a minute of
// the story with its own objects and its own weather, laid side by side like
// frames of film. Moving along the strip plays the event; cutting a piece out
// splices the strip shorter.
//
//     +------+ +------+ +------+
//     | 8  8 | |  8   | |  8   |
//     | [car]| | [car]| |      |
//     +------+ +------+ +------+
//      12:00    12:30    13:00
//
// **Only the minutes you author take up room.** Two pieces half an hour apart
// and two a minute apart are the same distance, because a piece of film is a
// piece of film. Time and distance are therefore *not* proportional, and the
// hour is a label a piece carries rather than the thing that positions it.
//
// **An object's piece is when it happens**, which is why no object carries a
// time, a step range or a visibility rule. What replaced ghosting is being
// somewhere else along the strip.
//
// Nothing here knows about WebGL, the DOM, or how a piece is drawn.

import { FOV_Y, ASPECT } from './camera.js';

/**
 * How big a piece of film is.
 *
 * `width` runs along the strip and has to hold a scene - two people and a car
 * is roughly twenty to thirty units - and `gap` is the join between pieces,
 * which is what makes a strip read as separate frames rather than as one long
 * floor. `depth` is across the strip, and is the same for every piece for the
 * same reason every frame of film is the same size.
 */
export const DEFAULT_PIECE = { width: 30, depth: 20, gap: 2.5 };

const isNumber = (v) => typeof v === 'number' && Number.isFinite(v);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** The piece geometry, with anything missing filled in. */
export function geometryOf(geometry = {}) {
  return {
    width: Math.max(1, isNumber(geometry.width) ? geometry.width : DEFAULT_PIECE.width),
    depth: Math.max(1, isNumber(geometry.depth) ? geometry.depth : DEFAULT_PIECE.depth),
    gap: Math.max(0, isNumber(geometry.gap) ? geometry.gap : DEFAULT_PIECE.gap),
  };
}

/** Centre to centre, which is the only distance the strip is measured in. */
export const pitchOf = (geometry) => {
  const { width, gap } = geometryOf(geometry);
  return width + gap;
};

// --- where a piece is -------------------------------------------------------

/**
 * The middle of piece `index`, along the strip.
 *
 * The first piece sits at nought, so a one-piece canvas is centred on the
 * origin and the camera has somewhere sensible to be before anything has been
 * built.
 */
export function pieceX(index, geometry) {
  return (isNumber(index) ? index : 0) * pitchOf(geometry);
}

/**
 * Where an object actually stands, given the piece it belongs to.
 *
 * **Objects are stored relative to their own piece**, and this is the only
 * place that is undone. Storing them absolutely would mean that cutting a piece
 * out of the middle had to rewrite the position of everything after it - which
 * is a rewrite of the whole canvas to express what splicing film expresses by
 * being shorter.
 */
export function placeInPiece(at, index, geometry) {
  const [x = 0, y = 0, z = 0] = Array.isArray(at) ? at : [];
  return [x + pieceX(index, geometry), y, z];
}

/** The ground the whole strip covers, for the pull-back at the end. */
export function stripExtent(count, geometry) {
  const pieces = Math.max(0, Math.floor(isNumber(count) ? count : 0));
  if (!pieces) return null;
  const { width } = geometryOf(geometry);
  return {
    min: -width / 2,
    max: pieceX(pieces - 1, geometry) + width / 2,
  };
}

// --- moving along it --------------------------------------------------------
//
// `at` is a position along the strip measured in pieces, so 0 is the first
// piece, 1 is the second and 1.5 is halfway between them. It is the primary
// thing the app scrubs, and the hour is read back from it rather than the other
// way round - because pieces are evenly spaced and the times they carry are not.

/** Along the strip, in world units. */
export function xAt(at, geometry) {
  return (isNumber(at) ? at : 0) * pitchOf(geometry);
}

/** The inverse, for dropping something on the ground and asking where it landed. */
export function atOfX(x, geometry) {
  return (isNumber(x) ? x : 0) / pitchOf(geometry);
}

/** Never off the end of the film. */
export function clampAt(at, count) {
  const last = Math.max(0, (isNumber(count) ? count : 0) - 1);
  return clamp(isNumber(at) ? at : 0, 0, last);
}

/**
 * Which piece is in front of the camera, and how far between two it is.
 *
 * The same shape a flight used to hand back - a piece, the one after it, and
 * how far through - so the weather cross-fade and the daylight read it exactly
 * as they read a scrub. There is no second code path, which is the property the
 * clock bar was built on and the reason it survived two redesigns.
 */
export function pieceAt(pieces = [], at) {
  if (!pieces.length) return null;
  const held = clampAt(at, pieces.length);
  const index = Math.min(pieces.length - 1, Math.floor(held));
  const into = held - index;
  const next = index + 1 < pieces.length ? index + 1 : index;
  return { index, next, into: next === index ? 0 : into };
}

/**
 * What time it is, part way along the strip.
 *
 * Interpolated between the times the two pieces either side carry, so crossing
 * a join moves the sun from one to the other rather than snapping it. Two
 * adjacent pieces can be half an hour apart, so this is where the compression
 * of time actually shows: a step across a join can be a step across an
 * afternoon, and the light moves accordingly.
 */
export function hourAt(pieces = [], at) {
  const where = pieceAt(pieces, at);
  if (!where) return null;
  const from = nearestHour(pieces, where.index);
  const to = nearestHour(pieces, where.next);
  if (!isNumber(from)) return isNumber(to) ? to : null;
  if (!isNumber(to)) return from;
  return from + (to - from) * where.into;
}

/**
 * The time of the nearest piece that has one, searching outward.
 *
 * A piece is allowed to carry no time - the clock has always been optional -
 * and **absent is not midnight**, which is a line this project has had to hold
 * once already. Reading only the piece itself and the one after it leaves an
 * untimed piece at the end of the strip with nothing to borrow from, which is
 * exactly the hole the test found: it reported no time at all, and a caller
 * asking the sky where it is would have got midnight by default.
 */
function nearestHour(pieces, index) {
  for (let reach = 0; reach < pieces.length; reach++) {
    const before = pieces[index - reach]?.hour;
    if (isNumber(before)) return before;
    const after = pieces[index + reach]?.hour;
    if (isNumber(after)) return after;
  }
  return null;
}

/** A time of day as a whole number of minutes, which is the finest a piece gets. */
export function toMinute(hour) {
  if (!isNumber(hour)) return 0;
  const minutes = Math.round(hour * 60);
  return ((minutes % 1440) + 1440) % 1440;
}

/** Minutes back to the hour the daylight module wants. */
export const fromMinute = (minute) => (isNumber(minute) ? minute : 0) / 60;

/** A piece's time, written the way the bar shows it. */
export function clockOfPiece(piece) {
  const minute = toMinute(piece?.hour);
  const h = Math.floor(minute / 60);
  const m = minute % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// --- cutting the film -------------------------------------------------------

/**
 * Take a section out, and let the strip close up.
 *
 * The whole reason a piece is a container rather than a position. Everything
 * after a cut simply renders at a lower index, so nothing is rewritten, nothing
 * points at a piece by number, and there is no class of silent re-timing bug of
 * the kind `reorder` existed to prevent.
 */
export function spliceOut(pieces = [], from, count = 1) {
  const start = clamp(Math.floor(isNumber(from) ? from : 0), 0, pieces.length);
  const many = Math.max(0, Math.floor(isNumber(count) ? count : 0));
  return [...pieces.slice(0, start), ...pieces.slice(start + many)];
}

/** Put a piece in, keeping the strip in the order its times run. */
export function insertPiece(pieces = [], piece) {
  const next = [...pieces, piece];
  return next
    .map((p, index) => ({ p, index }))
    .sort((a, b) => {
      const at = isNumber(a.p?.hour) ? a.p.hour : Infinity;
      const bt = isNumber(b.p?.hour) ? b.p.hour : Infinity;
      return at - bt || a.index - b.index;
    })
    .map(({ p }) => p);
}

// --- the camera -------------------------------------------------------------

/**
 * How deep a ground rectangle has to be to fill the frame at a given pitch.
 *
 * The camera is a rectangle and a pitch, and the rectangle is foreshortened by
 * that pitch - so a wide shot from low down needs a much deeper rectangle than
 * the same width from overhead. Deriving the depth rather than storing it is
 * what lets the rig be four numbers instead of five, and it means tilting never
 * leaves part of the frame empty.
 *
 * The floor under the sine matches the one `framingToView` already applies, so
 * the two agree at a pitch of nearly nothing instead of dividing by it.
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
    width: Math.max(1.2, isNumber(rig.width) ? rig.width : 34),
    height: Math.max(0, isNumber(rig.height) ? rig.height : 0),
  };
}

/**
 * Where the camera is looking, at a position along the strip.
 *
 * **This is the whole camera.** It never travels of its own accord: the strip
 * decides which piece is in front of it and the rig decides how that piece is
 * being looked at. Moving along the film therefore changes where the camera is
 * and never what it is doing - which is the rule the clock bar was built on.
 */
export function framingOf(rig, at, geometry) {
  const { yaw, pitch, width, height } = rigOf(rig);
  const depth = depthFor(width, pitch);
  return {
    x: xAt(at, geometry) - width / 2,
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
 * Keeps the yaw it was composed with and lifts the pitch, because a strip read
 * end to end is read from above - at the angle a close shot was composed at,
 * the far end of a long strip is a smear on the horizon.
 */
export function revealFraming(rig, count, geometry, { margin = 1.15, pitch = 52 } = {}) {
  const base = rigOf(rig);
  const extent = stripExtent(count, geometry);
  const lifted = clamp(pitch, 1.5, 89);
  if (!extent) return framingOf({ ...base, pitch: lifted }, 0, geometry);
  const width = Math.max(base.width, (extent.max - extent.min) * margin);
  const depth = depthFor(width, lifted);
  const centre = (extent.min + extent.max) / 2;
  return {
    x: centre - width / 2,
    z: -depth / 2,
    w: width,
    d: depth,
    y: base.height,
    pitch: lifted,
    yaw: base.yaw,
  };
}

/**
 * How far the fog may be pushed back for a given shot.
 *
 * **Fog measured in fixed world units is what would ruin the ending.** It runs
 * 26 to 180 units, which is right for a scene in a room and shorter than a
 * strip of any length - so pulling back to reveal the whole event would show it
 * fading into the sky exactly when it is meant to be readable.
 *
 * Tying it to the width of the shot fixes both ends at once: close in the fog
 * is where it always was and still gives depth; pulled back it opens up ahead
 * of the strip rather than swallowing it.
 */
export function fogFor(width, { near = 26, far = 180, reference = 26 } = {}) {
  const scale = Math.max(1, (isNumber(width) ? width : reference) / reference);
  return { near: near * scale, far: far * scale };
}

// --- playback ---------------------------------------------------------------

/** Seconds spent crossing one join, when the film is running. */
export const DEFAULT_SECONDS_PER_PIECE = 2;

/**
 * Playback: the film running through the projector.
 *
 * A take used to be a route of framings with a composed flight between each
 * pair. It is now a position along the strip moving at a steady rate, because
 * every piece is the same width - which is the film metaphor doing real work,
 * not decoration. The caller asks `framingOf` where that position puts the
 * camera.
 *
 * `hold` is a rest **at** a piece, and is the one field of the old step that
 * survived: it is how a shot is paced against a narration.
 *
 * Past the end it rests on the last piece rather than wrapping, because a story
 * that runs backwards through itself is not an ending.
 */
export function runAt(pieces = [], seconds, { secondsPerPiece = DEFAULT_SECONDS_PER_PIECE } = {}) {
  if (!pieces.length) return null;
  const rate = Math.max(1e-6, secondsPerPiece);
  let t = Math.max(0, isNumber(seconds) ? seconds : 0);

  for (let i = 0; i < pieces.length; i++) {
    const rest = Math.max(0, pieces[i]?.hold ?? 0) / 1000;
    if (t < rest) return { at: i, piece: i, resting: true, done: false };
    t -= rest;

    if (i === pieces.length - 1) return { at: i, piece: i, resting: false, done: true };
    if (t < rate) return { at: i + t / rate, piece: i, resting: false, done: false };
    t -= rate;
  }

  const last = pieces.length - 1;
  return { at: last, piece: last, resting: false, done: true };
}

/** How long a take runs, in seconds, so it can be checked against a narration. */
export function runDuration(pieces = [], { secondsPerPiece = DEFAULT_SECONDS_PER_PIECE } = {}) {
  if (!pieces.length) return 0;
  const rate = Math.max(1e-6, secondsPerPiece);
  const holds = pieces.reduce((total, piece) => total + Math.max(0, piece?.hold ?? 0) / 1000, 0);
  return holds + rate * (pieces.length - 1);
}

// Re-exported so a caller composing a shot does not have to import two modules
// to find out what shape the frame is.
export { FOV_Y, ASPECT };
