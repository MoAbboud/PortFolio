// Recipes to voxel grids.
//
// Pure module: no DOM, no WebGL, no globals, no file access. Takes a recipe
// object, returns a grid. Everything here is testable in Node.
//
// A grid is one byte per cell. 0 means empty; any other value v refers to
// palette[v - 1]. See requirements/04-data-model.md.

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
const AXIS = { x: 0, y: 1, z: 2 };

/** A colour like "#primary" that is filled in per instance rather than fixed. */
export function isTintSlot(colour) {
  return typeof colour === 'string' && colour.startsWith('#') && !HEX.test(colour);
}

// --- solids -----------------------------------------------------------------
// Each takes a point in the part's local space and the part's full extents.

const perpendicular = (a) => (a === 0 ? [1, 2] : a === 1 ? [0, 2] : [0, 1]);

function inBox(p, s) {
  return Math.abs(p[0]) <= s[0] / 2
    && Math.abs(p[1]) <= s[1] / 2
    && Math.abs(p[2]) <= s[2] / 2;
}

function inSphere(p, s) {
  const a = p[0] / (s[0] / 2), b = p[1] / (s[1] / 2), c = p[2] / (s[2] / 2);
  return a * a + b * b + c * c <= 1;
}

function inCylinder(p, s, ai) {
  if (Math.abs(p[ai]) > s[ai] / 2) return false;
  const [u, v] = perpendicular(ai);
  const a = p[u] / (s[u] / 2), b = p[v] / (s[v] / 2);
  return a * a + b * b <= 1;
}

function inCone(p, s, ai) {
  const half = s[ai] / 2;
  if (Math.abs(p[ai]) > half) return false;
  // Full radius at the negative end, a point at the positive end.
  const taper = 1 - (p[ai] + half) / (2 * half);
  if (taper <= 0) return false;
  const [u, v] = perpendicular(ai);
  const a = p[u] / ((s[u] / 2) * taper), b = p[v] / ((s[v] / 2) * taper);
  return a * a + b * b <= 1;
}

function inCapsule(p, s, ai) {
  const half = s[ai] / 2;
  const [u, v] = perpendicular(ai);
  const ru = s[u] / 2, rv = s[v] / 2;
  const cap = Math.min(ru, rv);
  const body = Math.max(0, half - cap);
  const d = Math.abs(p[ai]);
  if (d > half) return false;
  let shrink = 1;
  if (d > body) {
    const k = (d - body) / cap;
    shrink = Math.sqrt(Math.max(0, 1 - k * k));
    if (shrink <= 0) return false;
  }
  const a = p[u] / (ru * shrink), b = p[v] / (rv * shrink);
  return a * a + b * b <= 1;
}

// A gable: full width at the base, an apex along the centre line, extruded on z.
function inWedge(p, s) {
  if (!inBox(p, s)) return false;
  const up = (p[1] + s[1] / 2) / s[1];
  const across = Math.abs(p[0]) / (s[0] / 2);
  return up <= 1 - across;
}

const SOLIDS = {
  box: (p, s) => inBox(p, s),
  sphere: (p, s) => inSphere(p, s),
  cylinder: (p, s, ai) => inCylinder(p, s, ai),
  cone: (p, s, ai) => inCone(p, s, ai),
  capsule: (p, s, ai) => inCapsule(p, s, ai),
  wedge: (p, s) => inWedge(p, s),
};

export const SOLID_NAMES = Object.keys(SOLIDS);

// --- geometry helpers -------------------------------------------------------

/** World-space bounds of one part, accounting for its rotation about Y. */
function partBounds(part) {
  const [sx, sy, sz] = part.size;
  const rot = ((part.rot ?? 0) * Math.PI) / 180;
  const c = Math.abs(Math.cos(rot)), s = Math.abs(Math.sin(rot));
  // A rotated box's extent on x and z is the projection of both half-extents.
  const ex = (sx / 2) * c + (sz / 2) * s;
  const ez = (sx / 2) * s + (sz / 2) * c;
  const [ax, ay, az] = part.at;
  return {
    min: [ax - ex, ay - sy / 2, az - ez],
    max: [ax + ex, ay + sy / 2, az + ez],
  };
}

// --- voxelising -------------------------------------------------------------

/**
 * Turn a recipe into a grid.
 *
 * Parts are painted in order and later parts overwrite earlier ones, so detail
 * can be laid over bulk. The result is cropped to its occupied cells.
 */
export function voxelise(recipe) {
  const unit = recipe.unit;
  const parts = recipe.parts ?? [];
  if (!(unit > 0)) throw new Error(`recipe "${recipe.id}": unit must be positive`);
  if (parts.length === 0) throw new Error(`recipe "${recipe.id}": no parts`);

  for (const part of parts) {
    if (!SOLIDS[part.solid]) {
      throw new Error(`recipe "${recipe.id}": unknown solid "${part.solid}"`);
    }
  }

  // One grid large enough for every part.
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (const part of parts) {
    const b = partBounds(part);
    for (let a = 0; a < 3; a++) {
      lo[a] = Math.min(lo[a], b.min[a]);
      hi[a] = Math.max(hi[a], b.max[a]);
    }
  }

  const dims = [0, 0, 0];
  for (let a = 0; a < 3; a++) dims[a] = Math.max(1, Math.ceil((hi[a] - lo[a]) / unit) + 1);
  const [nx, ny, nz] = dims;
  const cells = new Uint8Array(nx * ny * nz);
  const motionOf = new Uint8Array(nx * ny * nz);

  const palette = [];
  const paletteKey = new Map();
  const motions = [];

  const colourIndex = (colour) => {
    const key = colour ?? '#bbbbbb';
    if (paletteKey.has(key)) return paletteKey.get(key);
    if (palette.length >= 255) {
      throw new Error(`recipe "${recipe.id}": more than 255 colours`);
    }
    palette.push(isTintSlot(key) ? { slot: key.slice(1) } : { hex: key });
    const index = palette.length; // cell values are 1-based
    paletteKey.set(key, index);
    return index;
  };

  const at = (i, j, k) => (k * ny + j) * nx + i;

  for (const part of parts) {
    const value = colourIndex(part.color);
    const ai = AXIS[part.axis ?? 'y'];
    const test = SOLIDS[part.solid];
    const rot = ((part.rot ?? 0) * Math.PI) / 180;
    const cos = Math.cos(-rot), sin = Math.sin(-rot);

    let motionValue = 0;
    if (part.motion && part.pivot) {
      motions.push({
        pivot: part.pivot.slice(),
        type: part.motion.type,
        axis: part.motion.axis ?? 'x',
        amp: part.motion.amp ?? 4,
        phase: part.motion.phase ?? 0,
      });
      motionValue = motions.length; // 0 means static
    }

    // Only walk the cells this part could possibly occupy.
    const b = partBounds(part);
    const from = [0, 0, 0], to = [0, 0, 0];
    for (let a = 0; a < 3; a++) {
      from[a] = Math.max(0, Math.floor((b.min[a] - lo[a]) / unit));
      to[a] = Math.min(dims[a] - 1, Math.ceil((b.max[a] - lo[a]) / unit));
    }

    const local = [0, 0, 0];
    for (let k = from[2]; k <= to[2]; k++) {
      const wz = lo[2] + (k + 0.5) * unit - part.at[2];
      for (let j = from[1]; j <= to[1]; j++) {
        local[1] = lo[1] + (j + 0.5) * unit - part.at[1];
        for (let i = from[0]; i <= to[0]; i++) {
          const wx = lo[0] + (i + 0.5) * unit - part.at[0];
          // Rotate the sample point into the part's own frame.
          local[0] = wx * cos - wz * sin;
          local[2] = wx * sin + wz * cos;
          if (!test(local, part.size, ai)) continue;
          const index = at(i, j, k);
          cells[index] = value;
          motionOf[index] = motionValue;
        }
      }
    }
  }

  const grid = {
    id: recipe.id,
    unit,
    dims,
    origin: lo,
    cells,
    motion: motions.length ? motionOf : null,
    motions,
    palette,
  };
  return anchor(crop(grid), recipe.anchor ?? 'base');
}

/** Trim empty margins so a grid is exactly as large as what it contains. */
export function crop(grid) {
  const [nx, ny, nz] = grid.dims;
  const lo = [nx, ny, nz], hi = [-1, -1, -1];
  for (let k = 0; k < nz; k++) {
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        if (!grid.cells[(k * ny + j) * nx + i]) continue;
        if (i < lo[0]) lo[0] = i; if (i > hi[0]) hi[0] = i;
        if (j < lo[1]) lo[1] = j; if (j > hi[1]) hi[1] = j;
        if (k < lo[2]) lo[2] = k; if (k > hi[2]) hi[2] = k;
      }
    }
  }
  if (hi[0] < 0) throw new Error(`recipe "${grid.id}": voxelised to nothing`);

  const dims = [hi[0] - lo[0] + 1, hi[1] - lo[1] + 1, hi[2] - lo[2] + 1];
  const cells = new Uint8Array(dims[0] * dims[1] * dims[2]);
  const motion = grid.motion ? new Uint8Array(cells.length) : null;
  for (let k = 0; k < dims[2]; k++) {
    for (let j = 0; j < dims[1]; j++) {
      for (let i = 0; i < dims[0]; i++) {
        const src = ((k + lo[2]) * ny + (j + lo[1])) * nx + (i + lo[0]);
        const dst = (k * dims[1] + j) * dims[0] + i;
        cells[dst] = grid.cells[src];
        if (motion) motion[dst] = grid.motion[src];
      }
    }
  }
  return {
    ...grid,
    dims,
    cells,
    motion,
    origin: [
      grid.origin[0] + lo[0] * grid.unit,
      grid.origin[1] + lo[1] * grid.unit,
      grid.origin[2] + lo[2] * grid.unit,
    ],
  };
}

/**
 * Work out where the model's origin sits, so placing it on the canvas is an
 * addition rather than a calculation. `offset` is the world position of the low
 * corner of cell (0,0,0) relative to that origin.
 */
export function anchor(grid, mode) {
  const [nx, ny, nz] = grid.dims;
  const u = grid.unit;
  // Written so a base anchor yields 0 rather than -0, which is a nuisance
  // to compare against and reads badly in a saved file.
  const offset = [
    -(nx * u) / 2,
    mode === 'center' ? -(ny * u) / 2 : 0,
    -(nz * u) / 2,
  ];
  return { ...grid, anchor: mode, offset };
}

/**
 * Drop cells that are completely enclosed. They are never visible, and this is
 * the largest single saving available: a figure loses about two thirds of its
 * cubes and looks identical.
 */
export function hollow(grid) {
  const [nx, ny, nz] = grid.dims;
  const src = grid.cells;
  const out = new Uint8Array(src.length);
  out.set(src);
  const at = (i, j, k) => (k * ny + j) * nx + i;

  for (let k = 1; k < nz - 1; k++) {
    for (let j = 1; j < ny - 1; j++) {
      for (let i = 1; i < nx - 1; i++) {
        const index = at(i, j, k);
        if (!src[index]) continue;
        if (src[at(i - 1, j, k)] && src[at(i + 1, j, k)]
          && src[at(i, j - 1, k)] && src[at(i, j + 1, k)]
          && src[at(i, j, k - 1)] && src[at(i, j, k + 1)]) {
          out[index] = 0;
        }
      }
    }
  }

  const motion = grid.motion ? new Uint8Array(src.length) : null;
  if (motion) for (let n = 0; n < out.length; n++) motion[n] = out[n] ? grid.motion[n] : 0;
  return { ...grid, cells: out, motion };
}

/** How many cubes a grid actually draws. */
export function count(grid) {
  let n = 0;
  for (let i = 0; i < grid.cells.length; i++) if (grid.cells[i]) n++;
  return n;
}

// --- encoding ---------------------------------------------------------------
// Run-length pairs, then base64. Runs are one byte of value and two of length.

const MAX_RUN = 0xffff;

export function encodeRLE(bytes) {
  const runs = [];
  let i = 0;
  while (i < bytes.length) {
    const value = bytes[i];
    let n = 1;
    while (i + n < bytes.length && bytes[i + n] === value && n < MAX_RUN) n++;
    runs.push(value, n & 0xff, (n >> 8) & 0xff);
    i += n;
  }
  return toBase64(Uint8Array.from(runs));
}

export function decodeRLE(text, length) {
  const runs = fromBase64(text);
  const out = new Uint8Array(length);
  let at = 0;
  for (let i = 0; i + 2 < runs.length; i += 3) {
    const value = runs[i];
    const n = runs[i + 1] | (runs[i + 2] << 8);
    if (value !== 0) out.fill(value, at, at + n);
    at += n;
  }
  return out;
}

function toBase64(bytes) {
  let text = '';
  for (let i = 0; i < bytes.length; i += 8192) {
    text += String.fromCharCode(...bytes.subarray(i, i + 8192));
  }
  return btoa(text);
}

function fromBase64(text) {
  const raw = atob(text);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

/**
 * A grid, ready to be written into the library.
 *
 * **Pack the solid grid, not the hollowed one.** Hollowing breaks long runs of
 * identical cells into short ones, so it makes the encoded form larger - three
 * times larger for a house. Hollowing is one cheap pass, so it belongs at load
 * rather than in storage.
 */
export function pack(grid) {
  return {
    id: grid.id,
    unit: grid.unit,
    dims: [...grid.dims],
    offset: [...grid.offset],
    anchor: grid.anchor,
    palette: grid.palette,
    motions: grid.motions,
    cells: encodeRLE(grid.cells),
    motion: grid.motion ? encodeRLE(grid.motion) : null,
  };
}

export function unpack(entry) {
  const length = entry.dims[0] * entry.dims[1] * entry.dims[2];
  return {
    ...entry,
    cells: decodeRLE(entry.cells, length),
    motion: entry.motion ? decodeRLE(entry.motion, length) : null,
  };
}

/** A library entry, ready to draw. */
export function load(entry) {
  const grid = hollow(unpack(entry));
  return { ...grid, count: count(grid) };
}

/** A recipe, all the way to something drawable. */
export function build(recipe) {
  const grid = hollow(voxelise(recipe));
  return { ...grid, count: count(grid) };
}
