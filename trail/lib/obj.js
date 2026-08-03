// Reading OBJ meshes, and turning them into voxel grids.
//
// Pure module. This is the piece that opens the CC0 mesh packs - Quaternius,
// Kenney - which is where modern subjects live: buildings, cars, furniture,
// people. They ship as OBJ with an MTL beside them, and an MTL's `Kd` is a flat
// diffuse colour per material, which is exactly what a palette wants.
//
// Only the surface is voxelised, never a solid fill, because Trail hollows
// every grid anyway. That removes the hardest part of mesh voxelisation: there
// is no inside-outside test, only triangles marking the cells they pass through.

const NUMBER = /-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?/g;

// Material names, when the diffuse colour is useless.
//
// Many packs put their colour in a texture atlas and export a flat grey
// diffuse, so every material comes back the same. The names are not useless
// though: artists call them what they are. This reads the name instead.
const NAMED = [
  ['darkgrey', '#4a4d52'], ['darkgray', '#4a4d52'], ['lightgrey', '#c2c6cb'],
  ['lightgray', '#c2c6cb'], ['grey', '#8b9096'], ['gray', '#8b9096'],
  ['darkbrown', '#4b3423'], ['lightbrown', '#a3764a'], ['brown', '#6b4a2f'],
  ['darkwood', '#5a3f28'], ['wood', '#9a6b40'], ['plank', '#a87a4b'],
  ['darkred', '#7a2320'], ['lightred', '#d9564e'], ['red', '#b5342c'],
  ['darkgreen', '#2c5230'], ['lightgreen', '#7fc06a'], ['green', '#4c7a3a'],
  ['darkblue', '#22406e'], ['lightblue', '#7fb4de'], ['blue', '#3a68a8'],
  ['yellow', '#d9b93c'], ['orange', '#d0812f'], ['purple', '#6f4a8e'],
  ['pink', '#d98ca8'], ['beige', '#d8cfc0'], ['cream', '#e6dcc6'],
  ['white', '#e9ecef'], ['black', '#1d2126'], ['metal', '#9aa3ab'],
  ['steel', '#8f979f'], ['glass', '#8fb8cf'], ['window', '#7fa8c9'],
  ['headlight', '#f2e6b8'], ['taillight', '#c23a2f'],
  ['brakelight', '#c23a2f'], ['skin', '#d9a97e'], ['hair', '#3a2b22'],
  ['leaf', '#4c7a3a'], ['grass', '#5d8f43'], ['dirt', '#7a5c3c'],
  ['stone', '#8d9095'], ['roof', '#7a3f34'], ['tyre', '#22242a'],
  ['tire', '#22242a'], ['rubber', '#22242a'], ['eye', '#f2f2f2'],
];

const fromName = (name) => {
  const lower = name.toLowerCase();
  for (const [needle, hex] of NAMED) if (lower.includes(needle)) return hex;
  // Nothing recognisable: give it a stable colour of its own so that at least
  // different materials are different, rather than one flat mass.
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  const hue = Math.abs(hash) % 360;
  return hslHex(hue, 0.32, 0.52);
};

function hslHex(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x]
    : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return toHex(r + m, g + m, b + m);
}

/**
 * Diffuse colours by material name, from an MTL file.
 *
 * If the file gives every material the same colour - which is what happens when
 * the real colours live in a texture - the names are used instead. A bed whose
 * materials are called DarkBrown, Sheets and Pillow is far better read as those
 * than as three identical greys.
 */
export function readMtl(text) {
  const materials = new Map();
  const diffuse = new Map();
  let current = null;
  for (const line of String(text).split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('newmtl ')) {
      current = trimmed.slice(7).trim();
      materials.set(current, '#bbbbbb');
    } else if (current && trimmed.startsWith('Kd ')) {
      const [r, g, b] = (trimmed.match(NUMBER) ?? []).map(Number);
      if ([r, g, b].every(Number.isFinite)) {
        materials.set(current, linearHex(r, g, b));
        diffuse.set(current, `${r},${g},${b}`);
      }
    }
  }

  const distinct = new Set(diffuse.values());
  const useless = materials.size > 1 && distinct.size <= 1;
  if (useless) {
    for (const name of materials.keys()) materials.set(name, fromName(name));
  }
  return materials;
}

const clamp255 = (v) => Math.max(0, Math.min(255, Math.round(v * 255)));
const toHex = (r, g, b) => `#${[r, g, b].map((v) => clamp255(v).toString(16).padStart(2, '0')).join('')}`;

// An MTL's Kd is linear light, and everything downstream treats colours as
// sRGB. Without this every imported material comes out far too dark: a brown
// that should read as wood arrives almost black.
const toSrgb = (v) => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);
const linearHex = (r, g, b) => toHex(toSrgb(r), toSrgb(g), toSrgb(b));

/**
 * Triangles and their colours.
 *
 * Faces may be any polygon, so they are fanned into triangles. Vertex indices
 * are one-based and may be negative, meaning "counting back from the end".
 */
export function readObj(text, materials = new Map()) {
  const vertices = [];
  const triangles = [];
  const colours = [];
  let colour = '#bbbbbb';

  for (const raw of String(text).split('\n')) {
    const line = raw.trim();
    if (line.startsWith('v ')) {
      const [x, y, z] = (line.match(NUMBER) ?? []).map(Number);
      vertices.push([x, y, z]);
    } else if (line.startsWith('usemtl ')) {
      colour = materials.get(line.slice(7).trim()) ?? '#bbbbbb';
    } else if (line.startsWith('f ')) {
      const corners = line.slice(2).trim().split(/\s+/).map((part) => {
        const index = Number.parseInt(part.split('/')[0], 10);
        return index < 0 ? vertices.length + index : index - 1;
      });
      for (let i = 1; i + 1 < corners.length; i++) {
        const tri = [corners[0], corners[i], corners[i + 1]].map((n) => vertices[n]);
        if (tri.some((v) => !v)) continue;
        triangles.push(tri);
        colours.push(colour);
      }
    }
  }
  return { triangles, colours, vertices: vertices.length };
}

/** The box a set of triangles occupies. */
export function boundsOf(triangles) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const tri of triangles) {
    for (const v of tri) {
      for (let a = 0; a < 3; a++) {
        if (v[a] < min[a]) min[a] = v[a];
        if (v[a] > max[a]) max[a] = v[a];
      }
    }
  }
  return { min, max };
}

/**
 * A mesh as a voxel grid.
 *
 * `cells` sets the longest side, so every model comes in at a comparable
 * chunkiness whatever units it was modelled in, and the cube size follows from
 * the model's real extent. Sampling is barycentric at finer than half a cell,
 * which is dense enough that a triangle never slips between two cells.
 */
export function voxeliseMesh(mesh, { id = 'imported', cells = 34, anchor = 'base' } = {}) {
  const { triangles, colours } = mesh;
  if (!triangles.length) throw new Error(`"${id}" has no triangles`);

  const { min, max } = boundsOf(triangles);
  const extent = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
  const longest = Math.max(...extent);
  if (!(longest > 0)) throw new Error(`"${id}" has no size`);

  const unit = longest / cells;
  const dims = extent.map((e) => Math.max(1, Math.ceil(e / unit) + 1));
  const [nx, ny, nz] = dims;
  const grid = new Uint8Array(nx * ny * nz);

  const palette = [];
  const byColour = new Map();
  const indexOf = (hex) => {
    if (!byColour.has(hex)) {
      if (palette.length >= 255) return 255;
      palette.push({ hex });
      byColour.set(hex, palette.length);
    }
    return byColour.get(hex);
  };

  triangles.forEach((tri, n) => {
    const value = indexOf(colours[n] ?? '#bbbbbb');
    const [a, b, c] = tri;

    // Enough samples that no step crosses more than half a cell.
    const side = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
    const steps = Math.max(1, Math.ceil(Math.max(side(a, b), side(a, c), side(b, c)) / (unit * 0.5)));

    for (let i = 0; i <= steps; i++) {
      for (let j = 0; i + j <= steps; j++) {
        const u = i / steps;
        const v = j / steps;
        const w = 1 - u - v;
        const x = Math.round((a[0] * w + b[0] * u + c[0] * v - min[0]) / unit);
        const y = Math.round((a[1] * w + b[1] * u + c[1] * v - min[1]) / unit);
        const z = Math.round((a[2] * w + b[2] * u + c[2] * v - min[2]) / unit);
        if (x < 0 || y < 0 || z < 0 || x >= nx || y >= ny || z >= nz) continue;
        grid[(z * ny + y) * nx + x] = value;
      }
    }
  });

  const midX = (nx * unit) / 2;
  const midZ = (nz * unit) / 2;
  return {
    id,
    unit,
    dims,
    origin: [min[0], min[1], min[2]],
    cells: grid,
    motion: null,
    motions: [],
    palette,
    anchor,
    offset: [-midX, anchor === 'center' ? -(ny * unit) / 2 : 0, -midZ],
  };
}

/** An OBJ and its MTL, all the way to a grid. */
export function importObj(objText, mtlText = '', options = {}) {
  return voxeliseMesh(readObj(objText, readMtl(mtlText)), options);
}
