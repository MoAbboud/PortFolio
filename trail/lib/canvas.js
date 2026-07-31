// The whole state of a video, as plain text.
//
// Pure module. Validates, fills in defaults, and migrates old files forward.
// There is nothing else to back up and nothing else to lose: if this file is
// safe, the video is safe.

export const VERSION = 3;

const isNumber = (v) => typeof v === 'number' && Number.isFinite(v);
const isTriple = (v) => Array.isArray(v) && v.length === 3 && v.every(isNumber);

class Refused extends Error {}

/** Everything currently on the canvas, ready to be written to disk. */
export function serialise({ layout, route, look = {}, title = 'untitled' }) {
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
    })),
    // Steps are written in full rather than relying on defaults. A file meant
    // to be read and edited by hand should say what it means, and it also keeps
    // saving twice from producing two different files.
    steps: route.map((s) => ({
      framing: Object.fromEntries(Object.entries(s.framing).map(([k, v]) => [k, round(v)])),
      hold: s.hold,
      approachTime: s.approachTime ?? 2500,
      weather: s.weather ?? 'clear',
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
    })),
    route: migrated.steps.map((s) => ({
      framing: { pitch: 25, yaw: 0, y: 0, ...s.framing },
      hold: s.hold,
      approachTime: s.approachTime ?? 2500,
      weather: s.weather ?? 'clear',
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
  return out;
}

export const isRefusal = (error) => error instanceof Refused;

const round = (v) => (isNumber(v) ? Number(v.toFixed(3)) : v);
const clamp01 = (v) => Math.min(1, Math.max(0, isNumber(v) ? v : 0));
