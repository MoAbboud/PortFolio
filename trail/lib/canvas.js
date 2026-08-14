// The whole state of a video, as plain text.
//
// Pure module. Validates, fills in defaults, and migrates old files forward.
// There is nothing else to back up and nothing else to lose: if this file is
// safe, the video is safe.

import { pieceX, pitchOf, DEFAULT_PIECE, OLD_PITCH } from './timeline.js';

export const VERSION = 7;

const isNumber = (v) => typeof v === 'number' && Number.isFinite(v);
const isTriple = (v) => Array.isArray(v) && v.length === 3 && v.every(isNumber);
// A path is a place on the ground, so two numbers rather than three.
const isPair = (v) => Array.isArray(v) && v.length === 2 && v.every(isNumber);

class Refused extends Error {}

/** Everything currently on the canvas, ready to be written to disk. */
/**
 * Everything currently on the canvas, ready to be written to disk.
 *
 * **A canvas with no steps is a canvas.** It is a place at a time of day with
 * nothing laid over it yet, which is where every canvas starts and what an
 * empty route means. Refusing one used to be a rule here, and it made removing
 * the last step impossible for no reason anybody could name.
 */
export function serialise({ layout, route, areas = [], look = {}, title = 'untitled' }) {
  return {
    trail: VERSION,
    title,
    look: {
      surface: look.surface ?? 'mesh',
      roundness: round(look.roundness ?? 0),
      smoothing: round(look.smoothing ?? 0),
      cubeScale: round(look.cubeScale ?? 1),
    },
    objects: layout.map((p) => ({
      model: p.model,
      at: p.at.map(round),
      ...(p.rot ? { rot: round(p.rot) } : {}),
      ...(p.scale && p.scale !== 1 ? { scale: round(p.scale) } : {}),
      ...(p.from ? { from: p.from } : {}),
      ...(p.until !== undefined ? { until: p.until } : {}),
      ...(p.label ? { label: p.label } : {}),
      ...(p.tints && Object.keys(p.tints).length ? { tints: { ...p.tints } } : {}),
      // Where this object walks to, and the step it arrives at. The object
      // itself never moves in the buffers - the offset is added in the shader -
      // so this is two numbers and a step rather than a position per frame.
      ...(isPair(p.path?.to) ? { path: { to: p.path.to.map(round), step: p.path.step ?? 0 } } : {}),
      // Which pose a rigged model is frozen in. One model in the library can be
      // stood, sat, walking or fallen, and which it is belongs to the placement
      // rather than to the library.
      ...(p.pose?.clip ? { pose: { clip: p.pose.clip, time: round(p.pose.time ?? 0) } } : {}),
    })),
    // Named rectangles of ground: the bar, the car park. Not objects - they
    // have no model and no height - so they are their own list rather than
    // placements with a flag on them.
    ...(areas.length ? {
      areas: areas.map((a) => ({
        at: a.at.map(round),
        size: a.size.map(round),
        ...(a.label ? { label: a.label } : {}),
        ...(a.from ? { from: a.from } : {}),
        ...(a.until !== undefined ? { until: a.until } : {}),
      })),
    } : {}),
    // Steps are written in full rather than relying on defaults. A file meant
    // to be read and edited by hand should say what it means, and it also keeps
    // saving twice from producing two different files.
    steps: route.map((s) => ({
      framing: Object.fromEntries(Object.entries(s.framing).map(([k, v]) => [k, round(v)])),
      weather: s.weather ?? 'clear',
      // The time of day, if this step has one. Absent is not midnight: it means
      // the step takes whatever light its weather preset carries, which is what
      // every canvas did before there was a clock.
      ...(isNumber(s.hour) ? { hour: round(s.hour) } : {}),
      ...(s.text ? { text: s.text } : {}),
    })),
  };
}

/**
 * Read a file back.
 *
 * Refuses with a reason rather than loading something half-formed: a canvas
 * that partly applied would be worse than one that did not load at all.
 */
export function parse(input) {
  let data = input;
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data);
    } catch (error) {
      throw new Refused(`that is not a canvas file: ${error.message}`);
    }
  }
  if (!data || typeof data !== 'object') throw new Refused('that file is empty');
  if (!isNumber(data.trail)) throw new Refused('that file is not a Trail canvas');
  if (data.trail > VERSION) {
    throw new Refused(
      `that canvas was made by a newer Trail (version ${data.trail}, this is ${VERSION})`
    );
  }

  const migrated = migrate(data);

  if (!Array.isArray(migrated.objects)) throw new Refused('the canvas has no objects list');
  if (!Array.isArray(migrated.steps)) throw new Refused('the canvas has no steps list');

  migrated.objects.forEach((o, i) => {
    if (typeof o.model !== 'string' || !o.model) {
      throw new Refused(`object ${i + 1} does not say what it is`);
    }
    if (!isTriple(o.at)) throw new Refused(`object ${i + 1} ("${o.model}") has no position`);
  });

  migrated.steps.forEach((s, i) => {
    const f = s.framing;
    if (!f || typeof f !== 'object') throw new Refused(`step ${i + 1} has no framing`);
    for (const key of ['x', 'z', 'w', 'd']) {
      if (!isNumber(f[key])) throw new Refused(`step ${i + 1} has no ${key} in its framing`);
    }
    if (!(f.w > 0) || !(f.d > 0)) throw new Refused(`step ${i + 1} has a frame with no size`);
    // **A step no longer has to say how long it is held.** Nothing plays, so
    // there is nothing for a duration to pace, and refusing a canvas for the
    // absence of a field nothing reads would be refusing it for nothing.
  });

  return {
    title: migrated.title ?? 'untitled',
    look: {
      surface: migrated.look?.surface === 'cubes' ? 'cubes' : 'mesh',
      roundness: clamp01(migrated.look?.roundness ?? 0),
      smoothing: clamp01(migrated.look?.smoothing ?? 0),
      cubeScale: Math.min(4, Math.max(0.25, migrated.look?.cubeScale ?? 1)),
    },
    layout: migrated.objects.map((o) => ({
      model: o.model,
      at: [...o.at],
      rot: o.rot ?? 0,
      scale: o.scale ?? 1,
      from: o.from ?? 0,
      ...(o.until !== undefined ? { until: o.until } : {}),
      ...(o.label ? { label: o.label } : {}),
      ...(o.tints && typeof o.tints === 'object' ? { tints: { ...o.tints } } : {}),
      ...(isPair(o.path?.to)
        ? { path: { to: [o.path.to[0], o.path.to[1]], step: Number(o.path.step) || 0 } }
        : {}),
      ...(typeof o.pose?.clip === 'string'
        ? { pose: { clip: o.pose.clip, time: Number(o.pose.time) || 0 } }
        : {}),
    })),
    areas: (Array.isArray(migrated.areas) ? migrated.areas : [])
      .filter((a) => isPair(a?.at) && isPair(a?.size))
      .map((a) => ({
        at: [a.at[0], a.at[1]],
        size: [Math.abs(a.size[0]), Math.abs(a.size[1])],
        label: typeof a.label === 'string' ? a.label : '',
        from: Number(a.from) || 0,
        ...(a.until !== undefined ? { until: a.until } : {}),
      })),
    route: migrated.steps.map((s) => ({
      framing: { pitch: 25, yaw: 0, y: 0, ...s.framing },
      weather: s.weather ?? 'clear',
      // Wrapped rather than refused, because an hour outside the clock is a
      // typo in a hand-edited file and 25:00 plainly means one in the morning.
      ...(isNumber(s.hour) ? { hour: ((s.hour % 24) + 24) % 24 } : {}),
      ...(s.text ? { text: s.text } : {}),
    })),
  };
}

/**
 * Forward only, one version at a time.
 *
 * A canvas built today has to keep opening in a Trail built in three years, and
 * the way that stays true is by never rewriting history, only adding to it.
 */
function migrate(data) {
  let out = data;
  if (out.trail < 2) {
    // Version 1 had no step ranges: everything was solid the whole way through.
    out = { ...out, trail: 2, objects: (out.objects ?? []).map((o) => ({ from: 0, ...o })) };
  }
  if (out.trail < 3) {
    // Version 2 had no look block, and always drew cubes.
    out = { ...out, trail: 3, look: { surface: 'cubes', roundness: 0, smoothing: 0, cubeScale: 1 } };
  }
  if (out.trail < 4) {
    // Version 3 had no clock, no labelled ground areas and no object able to
    // travel. All three are absences rather than changes: a step with no hour
    // takes its weather's own light, a canvas with no areas has none, and an
    // object with no path stays where it was put. So there is nothing to
    // rewrite, and saying so is the migration.
    out = { ...out, trail: 4 };
  }
  if (out.trail < 5) {
    // **Version 4 was one place; version 5 is a strip.** A step used to be a
    // camera angle on the same patch of ground, so every object in a four-step
    // story sat in one heap and `from` decided when it faded in. A step is a
    // piece of film now and stands in its own place, so opening an old canvas
    // untouched would leave the whole story piled onto the first piece with
    // empty pieces after it - which is exactly what the user saw.
    //
    // `from` already says which piece an object belongs to, so it is read one
    // last time and turned into a position. Guarded by the version, so a canvas
    // is never pushed along the strip twice.
    const along = (from) => pieceX(Math.max(0, Math.floor(Number(from) || 0)), DEFAULT_PIECE);
    out = {
      ...out,
      trail: 5,
      objects: (out.objects ?? []).map((o) => (
        Array.isArray(o?.at) && o.at.length === 3
          ? { ...o, at: [o.at[0] + along(o.from), o.at[1], o.at[2]] }
          : o
      )),
      ...(Array.isArray(out.areas) ? {
        areas: out.areas.map((a) => (
          Array.isArray(a?.at) && a.at.length === 2
            ? { ...a, at: [a.at[0] + along(a.from), a.at[1]] }
            : a
        )),
      } : {}),
    };
  }
  if (out.trail < 6) {
    // **The join was widened so the veil had somewhere to sit.** At the old
    // spacing a piece was 34 across with 3 between, so the next one began 20
    // units from the middle of this one - inside it. Nothing centred on a piece
    // could separate them.
    //
    // Objects keep their place *on* their piece and the pieces move apart. The
    // piece is read back from the position rather than from `from`, because a
    // position is what was actually drawn and `from` may have been edited since.
    const now = pitchOf(DEFAULT_PIECE);
    const spread = (x) => {
      const piece = Math.round(x / OLD_PITCH);
      return (x - piece * OLD_PITCH) + piece * now;
    };
    out = {
      ...out,
      trail: 6,
      objects: (out.objects ?? []).map((o) => (
        Array.isArray(o?.at) && o.at.length === 3
          ? { ...o, at: [spread(o.at[0]), o.at[1], o.at[2]] }
          : o
      )),
      ...(Array.isArray(out.areas) ? {
        areas: out.areas.map((a) => (
          Array.isArray(a?.at) && a.at.length === 2
            ? { ...a, at: [spread(a.at[0]), a.at[1]] }
            : a
        )),
      } : {}),
    };
  }
  if (out.trail < 7) {
    /**
     * **Version 6 was a film that played; version 7 is a drawing board.**
     *
     * A step carried `hold` - how long a take rested on it - and `approachTime`
     * - how long the camera took to fly to it. Trail does not play anything any
     * more, so neither has anything to pace: *"there is no such thing as a
     * countdown before a take, not even a take is a thing. Just steps."*
     *
     * Dropped rather than rewritten. They are absences, not changes: every
     * other field of a version 6 step means exactly what it did, and an old
     * canvas opens looking identical because nothing was ever drawn from these
     * two. `parse` simply stops reading them, so this says so and moves on.
     */
    out = {
      ...out,
      trail: 7,
      steps: (out.steps ?? []).map(({ hold, approachTime, ...rest }) => rest),
    };
  }
  return out;
}

/**
 * Rearrange the route, and drag everything that points at a step with it.
 *
 * **This is the part that is easy to get wrong and impossible to see.** A step
 * is referred to by its position, in four places: an object's `from` and
 * `until`, the step an object walks its line on, and a place's own range.
 * Moving step 3 above step 2 without touching those does not fail, or warn, or
 * look broken - it quietly re-times the whole video, and the only way to find
 * out is to play it and notice that somebody arrives in the wrong shot.
 *
 * `order` is the old positions in their new order. Dropping one is leaving it
 * out. Anything pointing at a step that is gone falls back to the nearest
 * surviving step before it, which is the reading that keeps an object on screen
 * rather than making it vanish.
 */
export function reorder({ route, layout = [], areas = [] }, order) {
  const where = new Map();
  // **A step may appear twice, and the first copy wins.** Adding a step splices
  // a copy of the one it follows in after it, so the order names that step at
  // both positions - and a reference means "from this moment on", which is
  // where the original still is.
  //
  // Letting the later copy win is what made adding a step silently reassign
  // every object already placed to the new one: with one step and one object,
  // the order is [0, 0], the second entry overwrote the first, and every
  // `from: 0` became `from: 1`. The object then ghosted blue on the step it had
  // been put on, which is what the failure looked like from the outside.
  order.forEach((old, at) => {
    if (!where.has(old)) where.set(old, at);
  });

  const remap = (index) => {
    if (!isNumber(index)) return index;
    if (where.has(index)) return where.get(index);
    // The step it named is gone. Walk back to the nearest one that survived,
    // and if none did, the beginning.
    for (let i = index - 1; i >= 0; i--) if (where.has(i)) return where.get(i);
    return 0;
  };

  const last = order.length - 1;
  const clamp = (v) => Math.max(0, Math.min(last, v));

  /**
   * The far end of a range.
   *
   * Measured against the route as it **was**, not as it is about to be. A value
   * past the old end is the "runs to the end of the route" sentinel and has to
   * stay untouched; a value inside it is a real step and has to move with that
   * step, including when that step is the one being dropped. Comparing against
   * the new length confuses the two, and an object that ended on the last step
   * is left ending past the end of a shorter route.
   */
  const far = (until) => {
    if (until === undefined) return {};
    if (!isNumber(until) || until >= route.length) return { until };
    return { until: clamp(remap(until)) };
  };

  return {
    route: order.map((old) => route[old]).filter(Boolean),
    layout: layout.map((o) => ({
      ...o,
      from: clamp(remap(o.from ?? 0)),
      ...far(o.until),
      ...(o.path ? { path: { ...o.path, step: clamp(remap(o.path.step ?? 0)) } } : {}),
    })),
    areas: areas.map((a) => ({
      ...a,
      from: clamp(remap(a.from ?? 0)),
      ...far(a.until),
    })),
  };
}

/**
 * Which piece of the strip a thing is standing on.
 *
 * Read from **where it is**, not from what it says. An object carries `from`,
 * which was the step it arrived at and is now the piece it belongs to - but the
 * two can disagree the moment somebody drags it, and where a thing is is the
 * thing that was actually drawn.
 */
export const pieceOf = (x, pitch) => Math.round((isNumber(x) ? x : 0) / Math.max(1e-6, pitch));

/**
 * Make room for a piece at `index`.
 *
 * **Everything after it moves one piece along the strip.** This is the half
 * that was missing, and it is why inserting a step in the middle looked like it
 * replaced one: a new piece pushes every later piece's *camera* one place
 * along, and if what stands on them does not go too, the contents of step three
 * are left sitting on step two's ground.
 */
export function openPiece({ route, layout = [], areas = [] }, index, pitch) {
  const shift = (i) => (isNumber(i) && i >= index ? i + 1 : i);
  const far = (until) => {
    if (until === undefined) return {};
    if (!isNumber(until) || until >= route.length) return { until };
    return { until: shift(until) };
  };
  const move = (thing, on) => (on >= index ? on + 1 : on);

  return {
    layout: layout.map((o) => {
      const on = pieceOf(o.at?.[0], pitch);
      const to = move(o, on);
      return {
        ...o,
        at: [o.at[0] + (to - on) * pitch, o.at[1], o.at[2]],
        from: to,
        ...far(o.until),
        ...(o.path ? { path: { ...o.path, step: shift(o.path.step ?? 0) } } : {}),
      };
    }),
    areas: areas.map((a) => {
      const on = pieceOf(a.at?.[0], pitch);
      const to = move(a, on);
      return { ...a, at: [a.at[0] + (to - on) * pitch, a.at[1]], from: to, ...far(a.until) };
    }),
  };
}

/**
 * Cut a piece out, and let the strip close up.
 *
 * **What stood on it goes with it.** Leaving the objects behind is what made a
 * deleted step come back: nothing hides them any more - being elsewhere on the
 * strip is what hiding means - so they simply sat past the end of a shorter
 * film, out of reach, and reappeared the moment a step was added and the strip
 * grew back over them.
 */
export function cutPiece({ route, layout = [], areas = [] }, index, pitch) {
  const shift = (i) => {
    if (!isNumber(i)) return i;
    if (i > index) return i - 1;
    // A reference to the piece that went falls back to the one before it, which
    // keeps whatever pointed at it on screen rather than making it vanish.
    return i === index ? Math.max(0, index - 1) : i;
  };
  const far = (until) => {
    if (until === undefined) return {};
    if (!isNumber(until) || until >= route.length) return { until };
    return { until: shift(until) };
  };
  const survives = (at) => pieceOf(at?.[0], pitch) !== index;
  const closed = (at, extra) => {
    const on = pieceOf(at?.[0], pitch);
    const to = on > index ? on - 1 : on;
    return { at: [at[0] + (to - on) * pitch, ...extra], from: to };
  };

  return {
    layout: layout.filter((o) => survives(o.at)).map((o) => ({
      ...o,
      ...closed(o.at, [o.at[1], o.at[2]]),
      ...far(o.until),
      ...(o.path ? { path: { ...o.path, step: shift(o.path.step ?? 0) } } : {}),
    })),
    areas: areas.filter((a) => survives(a.at)).map((a) => ({
      ...a,
      ...closed(a.at, [a.at[1]]),
      ...far(a.until),
    })),
  };
}

/**
 * Copy what stands on one piece onto another.
 *
 * **This is the answer to the only genuinely tedious thing in the app.** An
 * event is remembered as differences - "then the car pulls up" - and a strip of
 * film made of independent pieces asks you to restate everything that stayed the
 * same. `examples/the-corner.json` is 59 objects across three pieces of one
 * street corner, and the street never changed: three facts, paid for with
 * fifty-nine placements.
 *
 * **A copy is a copy.** It is independent the moment it exists and is edited
 * like anything placed by hand, which is the whole difference between this and
 * the repeat rule that was rejected twice - an object carrying a range of time
 * has to be a thing on the ground and a rule about time at once, and brings a
 * copy-and-override model with it.
 *
 * Which piece a thing is on is read from **where it is**, like `openPiece` and
 * `cutPiece`, because `from` and the position disagree the moment somebody drags
 * something.
 */
export function copyPiece({ layout = [], areas = [] }, from, to, pitch) {
  if (!isNumber(from) || !isNumber(to) || from === to) return { layout, areas };
  const step = (to - from) * pitch;
  const on = (at) => pieceOf(at?.[0], pitch) === from;
  // A path is a place on the ground the object walks to, so it moves with the
  // copy - and it is walked on the piece the copy stands on, not the original's.
  const path = (o) => (o.path
    ? { path: { ...o.path, to: [o.path.to[0] + step, o.path.to[1]], step: to } }
    : {});

  return {
    layout: [
      ...layout,
      ...layout.filter((o) => on(o.at)).map((o) => ({
        ...o,
        at: [o.at[0] + step, o.at[1], o.at[2]],
        from: to,
        ...path(o),
      })),
    ],
    areas: [
      ...areas,
      ...areas.filter((a) => on(a.at)).map((a) => ({
        ...a,
        at: [a.at[0] + step, a.at[1]],
        from: to,
      })),
    ],
  };
}

/** The order that moves one step, keeping everything else where it was. */
export function moved(length, from, to) {
  const order = Array.from({ length }, (_, i) => i);
  if (from < 0 || from >= length || to < 0 || to >= length) return order;
  const [taken] = order.splice(from, 1);
  order.splice(to, 0, taken);
  return order;
}

/**
 * The order that puts the route in the order it happens.
 *
 * A step is named by its hour and the route is walked in array order, so the
 * two have to agree: dragging a step earlier on the clock would otherwise leave
 * it playing in its old place. Steps with no hour are not on the clock at all,
 * so they keep their positions relative to each other and sit at the end.
 */
export function byTime(route) {
  return route
    .map((step, index) => ({ step, index }))
    .sort((a, b) => {
      const at = typeof a.step.hour === 'number' ? a.step.hour : Infinity;
      const bt = typeof b.step.hour === 'number' ? b.step.hour : Infinity;
      return at - bt || a.index - b.index;
    })
    .map(({ index }) => index);
}

/** The order that drops one step. */
export function dropped(length, index) {
  return Array.from({ length }, (_, i) => i).filter((i) => i !== index);
}

export const isRefusal = (error) => error instanceof Refused;

const round = (v) => (isNumber(v) ? Number(v.toFixed(3)) : v);
const clamp01 = (v) => Math.min(1, Math.max(0, isNumber(v) ? v : 0));
