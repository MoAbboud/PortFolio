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

  // A city, which is what the modern packs are made of. Without these a
  // building's facets come back as the hash fallback - stable, but arbitrary -
  // and a street of them reads as confetti.
  ['concrete', '#a8a49b'], ['asphalt', '#3c3f45'], ['tarmac', '#3c3f45'],
  ['sidewalk', '#b0aca4'], ['pavement', '#b0aca4'], ['kerb', '#b5b1a8'],
  ['curb', '#b5b1a8'], ['redbrick', '#a8412f'], ['brick', '#9c4a38'],
  ['slate', '#4e535a'], ['marble', '#e0dcd4'], ['plaster', '#ded6c8'],
  ['stucco', '#d6ccb8'], ['ornament', '#c4bda9'], ['decal', '#e2ded2'],
  ['trimdark', '#8d8578'], ['trim', '#c9c3b4'],
  // A "fake interior" is the dark room a shop window looks into, which is a
  // different thing from an interior wall, and the two are named alike.
  ['fakeinterior', '#26272c'], ['interiorwall', '#cfc7b8'],
  ['interiorfloor', '#8a7f70'], ['interiorroof', '#6e675c'],
  ['interior', '#2e2f35'], ['curtain', '#b6a893'], ['blind', '#cfc6b4'],

  // Materials that turn up across the furniture, food and character packs.
  ['chair', '#8a5f3c'], ['sheet', '#e6e2d8'], ['pillow', '#e8e2d2'],
  ['cloth', '#b9a48c'], ['fabric', '#b9a48c'], ['leather', '#6b4630'],
  ['denim', '#3f5a80'], ['paper', '#e5e0d4'], ['cardboard', '#b08c5c'],
  ['plastic', '#c9c9cf'], ['chrome', '#b8bec4'], ['gold', '#d4af37'],
  ['silver', '#c0c4c8'], ['copper', '#b06a3b'], ['bronze', '#96703c'],
  ['water', '#4a86a8'], ['sand', '#d8c79a'], ['snow', '#eef2f6'],
  ['flesh', '#c98f74'], ['bone', '#ded6c0'], ['zombie', '#7f9463'],

  // Things this library actually holds. These are reached through a model's own
  // filename when its materials say nothing, so they are named for the objects
  // rather than for materials.
  ['cookie', '#b07a3f'], ['cupcake', '#e2b7c4'], ['icecream', '#f0e2d0'],
  ['donut', '#c98a5e'], ['doughnut', '#c98a5e'], ['burger', '#a86a35'],
  ['hotdog', '#c26a3a'], ['pizza', '#c98b40'], ['cake', '#e6d2b8'],
  ['soda', '#c0392f'], ['fries', '#e0b552'], ['blood', '#7e1d18'],
  ['sofa', '#6d5a4a'], ['couch', '#6d5a4a'], ['vase', '#8fa6b5'],
  ['barrel', '#6b4a2f'], ['crate', '#a87a4b'], ['chest', '#7a5636'],
  ['pallet', '#a3763f'], ['cinder', '#9a9a94'], ['container', '#3f6f5a'],
  ['hydrant', '#b5342c'], ['pipe', '#8a8f96'], ['sign', '#5d6b78'],
  ['wheel', '#22242a'], ['guitar', '#8a5a30'],
];

// Longest needle first, so a specific name always beats a general one that
// happens to sit inside it. Without this the answer depended on the order of
// the list above, which is a trap: "Chair" matched "hair" and came out the
// colour of a head, and "FakeInterior" would have matched "interior" and been
// lit rather than dark.
const BY_LENGTH = [...NAMED].sort((a, b) => b[0].length - a[0].length);

// Separators are noise. "MI_Trim_Dark", "trim-dark" and "TrimDark" are one
// material as far as this is concerned.
const plain = (name) => String(name).toLowerCase().replace(/[^a-z0-9]+/g, '');

// Exported because the glTF path needs exactly the same answer: both formats
// hit the same wall, where the colour is in a texture and the name is all that
// is left. Two tables would drift, and a bed would be one brown in one format
// and another in the other.
export const fromName = (name) => {
  const lower = plain(name);
  for (const [needle, hex] of BY_LENGTH) if (lower.includes(needle)) return hex;
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

// Names an exporter invents when nobody chose one. They say nothing about what
// the material is, so the model's own name is a better label than any of them.
const ANONYMOUS = /^(material|default|none|untitled|atlas|texture|lambert|blinn|phong|standardsurface|surface)([._\s-]*\d+)?$/i;

// The greys an exporter writes when nobody picked a colour: white, and
// Blender's two defaults. Matched tightly rather than as "any pale grey",
// because plenty of things - concrete, a kerb - really are a pale grey, and
// those should keep the colour somebody chose for them.
const DEFAULTS = [1, 0.8, 0.64];
const untouched = (r, g, b) => Math.max(r, g, b) - Math.min(r, g, b) < 0.02
  && DEFAULTS.some((grey) => Math.abs(r - grey) < 0.02);

/**
 * Diffuse colours by material name, from an MTL file.
 *
 * `Kd` is only the colour when the material has no texture. Once `map_Kd` is
 * present, `Kd` is a multiplier the texture is tinted by, and it is almost
 * always left at white or Blender's 0.8 grey - so taking it literally paints
 * the model white. That is one root cause with three faces, and all three were
 * in this library at once:
 *
 *   - one material, textured: the whole Zombie kit, every model white
 *   - one material, untextured, never named or coloured: the Junk Food pack
 *   - several materials where one has a real colour, so "they are all the same"
 *     was false and the textured ones stayed white: the vehicles
 *
 * When a colour cannot be believed the name is read instead, and when the name
 * is one an exporter invented - `Atlas`, `Material.001` - the model's own name
 * is the last thing left that means anything. A file called `Cookie.obj` is
 * better evidence about a cookie than a grey nobody chose.
 */
export function readMtl(text, { model = '' } = {}) {
  const materials = new Map();
  const diffuse = new Map();
  const textured = new Set();
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
        diffuse.set(current, [r, g, b]);
      }
    } else if (current && /^map_Kd\s/i.test(trimmed)) {
      textured.add(current);
    }
  }

  // Every material sharing one colour is not a scheme, it is a texture that was
  // not exported. Kept from before, and now only one of several reasons.
  const distinct = new Set([...diffuse.values()].map((kd) => kd.join(',')));
  const allAlike = materials.size > 1 && distinct.size <= 1;

  for (const name of materials.keys()) {
    const kd = diffuse.get(name);
    const anonymous = ANONYMOUS.test(name.trim());
    const believable = kd && !textured.has(name) && !allAlike && !untouched(...kd);
    if (believable) continue;
    // The material's own name first, then the model's. Both go through the
    // same table, so a material called Sheets and a model called Couch are
    // read the same way.
    materials.set(name, fromName(anonymous && model ? model : name));
  }
  return materials;
}

const clamp255 = (v) => Math.max(0, Math.min(255, Math.round(v * 255)));
const toHex = (r, g, b) => `#${[r, g, b].map((v) => clamp255(v).toString(16).padStart(2, '0')).join('')}`;

// An MTL's Kd is linear light, and everything downstream treats colours as
// sRGB. Without this every imported material comes out far too dark: a brown
// that should read as wood arrives almost black.
const toSrgb = (v) => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);
// glTF's `baseColorFactor` is linear for the same reason and needs the same
// conversion, so this is shared rather than written twice.
export const linearHex = (r, g, b) => toHex(toSrgb(r), toSrgb(g), toSrgb(b));

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

/**
 * The same grid, sized so that it stands a given number of units tall.
 *
 * The cube size normally follows the model's own extent, which is right when a
 * pack was modelled at real scale - and every pack here is, at one unit to the
 * metre, matching the hand-authored figure at 1.89. It is wrong when a pack
 * normalised each model to fill the same box before exporting, because then a
 * dog and a bull arrive the same size and no amount of care in the voxeliser
 * can recover the difference. The real height is data the model no longer
 * carries, so it is written in the manifest and applied here.
 */
export function atHeight(grid, height) {
  const tall = grid.dims[1] * grid.unit;
  if (!(height > 0) || !(tall > 0)) return grid;
  const scale = height / tall;
  return { ...grid, unit: grid.unit * scale, offset: grid.offset.map((v) => v * scale) };
}

/** An OBJ and its MTL, all the way to a grid. */
export function importObj(objText, mtlText = '', options = {}) {
  return voxeliseMesh(readObj(objText, readMtl(mtlText, { model: options.id })), options);
}
