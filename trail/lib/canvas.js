// The whole state of a video, as plain text.
//
// Pure module. Validates, fills in defaults, and migrates old files forward.
// There is nothing else to back up and nothing else to lose: if this file is
// safe, the video is safe.

export const VERSION = 4;

const isNumber = (v) => typeof v === 'number' && Number.isFinite(v);
const isTriple = (v) => Array.isArray(v) && v.length === 3 && v.every(isNumber);
// A path is a place on the ground, so two numbers rather than three.
const isPair = (v) => Array.isArray(v) && v.length === 2 && v.every(isNumber);

class Refused extends Error {}

/** Everything currently on the canvas, ready to be written to disk. */
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
      hold: s.hold,
      approachTime: s.approachTime ?? 2500,
      weather: s.weather ?? 'clear',
      // The time of day, if this step has one. Absent is not midnight: it means
      // the step takes whatever light its weather preset carries, which is what
      // every canvas did before there was a clock.
      ...(isNumber(s.hour) ? { hour: round(s.hour) } : {}),
      // A move the camera makes by itself while it holds here. Saved on the
      // step rather than being a live switch, so a take plays the same way
      // twice - which is the whole reason play mode carries no interface.
      ...(s.orbit ? { orbit: 1 } : {}),
      ...(s.push ? { push: 1 } : {}),
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
    if (!isNumber(s.hold) || s.hold < 0) throw new Refused(`step ${i + 1} has no hold`);
  });

  if (migrated.steps.length === 0) throw new Refused('a canvas needs at least one step');

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
      hold: s.hold,
      approachTime: s.approachTime ?? 2500,
      weather: s.weather ?? 'clear',
      // Wrapped rather than refused, because an hour outside the clock is a
      // typo in a hand-edited file and 25:00 plainly means one in the morning.
      ...(isNumber(s.hour) ? { hour: ((s.hour % 24) + 24) % 24 } : {}),
      ...(s.orbit ? { orbit: 1 } : {}),
      ...(s.push ? { push: 1 } : {}),
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
  order.forEach((old, at) => where.set(old, at));

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

/** The order that moves one step, keeping everything else where it was. */
export function moved(length, from, to) {
  const order = Array.from({ length }, (_, i) => i);
  if (from < 0 || from >= length || to < 0 || to >= length) return order;
  const [taken] = order.splice(from, 1);
  order.splice(to, 0, taken);
  return order;
}

/** The order that drops one step. */
export function dropped(length, index) {
  return Array.from({ length }, (_, i) => i).filter((i) => i !== index);
}

export const isRefusal = (error) => error instanceof Refused;

const round = (v) => (isNumber(v) ? Number(v.toFixed(3)) : v);
const clamp01 = (v) => Math.min(1, Math.max(0, isNumber(v) ? v : 0));
