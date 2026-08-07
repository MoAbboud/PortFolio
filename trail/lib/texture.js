// Painting a model from its texture rather than from its material's name.
//
// Pure module. Both readers hand back the same three things - a colour per
// face, a texture coordinate per corner, and which image each face belongs to -
// and this turns them into the colour the artist actually painted.
//
// **A face becomes one colour, not a picture.** Trail draws flat-shaded facets,
// so there is nowhere for a gradient to go, and the palette is 255 entries of
// one byte per vertex. The question is therefore not "what does this texture
// look like" but "what colour is this triangle", and the answer is the average
// over the piece of the image the triangle covers. That is a better answer than
// a single sampled texel as well as a cheaper one: a texel can land on a mortar
// line and paint a whole brick wall grey.
//
// Colours out of an image need no conversion. A PNG holds sRGB and glTF states
// that a base colour texture is sRGB, which is what the rest of Trail works in.
// This is the opposite of an MTL's `Kd` and a glTF's `baseColorFactor`, which
// are linear light and are converted on the way in.

// Where to sample inside a triangle: every point on a barycentric lattice.
// Fifteen samples is enough that a face reads as its own average rather than as
// whatever happens to sit at its middle, and few enough that a five thousand
// triangle model costs a fraction of what reading it did.
const ORDER = 4;
const LATTICE = (() => {
  const points = [];
  for (let i = 0; i <= ORDER; i++) {
    for (let j = 0; i + j <= ORDER; j++) {
      points.push([i / ORDER, j / ORDER, (ORDER - i - j) / ORDER]);
    }
  }
  return points;
})();

// Below this a texel is a hole rather than a colour. Leaf and foliage textures
// are cut-outs on a transparent field, and averaging that field in drags every
// leaf toward whatever the exporter left in the empty pixels - which is usually
// black, and produces exactly the dark, dead-looking canopy this is meant to
// avoid.
const SOLID = 16;

const clamp = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);
const hex = (r, g, b) => `#${[r, g, b].map((v) => clamp(Math.round(v)).toString(16).padStart(2, '0')).join('')}`;

/**
 * The average colour of the region a triangle covers, or null if there is none.
 *
 * Coordinates outside the image repeat, which is what a texture does by default
 * and what tiling geometry - a wall, a road - relies on.
 */
export function sample(image, uv) {
  const { width, height, pixels } = image;
  let r = 0;
  let g = 0;
  let b = 0;
  let weight = 0;

  for (const [wa, wb, wc] of LATTICE) {
    const u = uv[0][0] * wa + uv[1][0] * wb + uv[2][0] * wc;
    const v = uv[0][1] * wa + uv[1][1] * wb + uv[2][1] * wc;
    let x = Math.floor((u - Math.floor(u)) * width);
    let y = Math.floor((v - Math.floor(v)) * height);
    if (x >= width) x = width - 1;
    if (y >= height) y = height - 1;
    const at = (y * width + x) * 4;
    const alpha = pixels[at + 3];
    if (alpha < SOLID) continue;
    r += pixels[at] * alpha;
    g += pixels[at + 1] * alpha;
    b += pixels[at + 2] * alpha;
    weight += alpha;
  }

  if (!weight) return null;
  return hex(r / weight, g / weight, b / weight);
}

/**
 * The same mesh, with every face that has a texture painted from it.
 *
 * `images` is aligned with the mesh's own `images` list, holding a decoded
 * picture or null. A face keeps the colour it already had wherever there is no
 * image, no coordinate, or nothing but transparent pixels behind it - so this
 * can never make a model worse than the material-name guess it improves on.
 */
export function paint(mesh, images = []) {
  const faces = mesh?.faceImage;
  if (!faces || !mesh.uvs) return mesh;

  const colours = mesh.colours.slice();
  // One triangle at a time, but a mesh reuses its texture coordinates heavily -
  // measured across the library, 397,694 textured faces ask only 106,878
  // distinct questions, so remembering the answer skips three quarters of the
  // sampling.
  const seen = new Map();
  let painted = 0;

  for (let f = 0; f < faces.length; f++) {
    const image = images[faces[f]];
    const uv = mesh.uvs[f];
    if (!image || !uv) continue;
    const key = `${faces[f]}|${uv[0][0].toFixed(4)},${uv[0][1].toFixed(4)}`
      + `|${uv[1][0].toFixed(4)},${uv[1][1].toFixed(4)}`
      + `|${uv[2][0].toFixed(4)},${uv[2][1].toFixed(4)}`;
    let colour = seen.get(key);
    if (colour === undefined) {
      colour = sample(image, uv);
      seen.set(key, colour);
    }
    if (colour) { colours[f] = colour; painted++; }
  }

  return { ...mesh, colours, painted };
}

/**
 * The same colours, reduced to at most `most` of them.
 *
 * Sampling gives nearly every face its own shade, and a model carries one byte
 * per vertex indexing a palette of 255 - so without this, everything past the
 * 255th colour collapses onto whichever one happened to be last. Which faces
 * those are depends on the order they were read in, so the failure is both
 * ugly and arbitrary.
 *
 * The colours covering the most faces are kept and the rest are moved to the
 * nearest kept one. This does drop rare colours - a car has six faces of
 * headlight - so the cap is deliberately high rather than tidy, and it earns
 * its keep by rarely firing: measured across the library, 23 of 363 models
 * exceed it, and they are the ones whose detail textures produced several
 * hundred shades of one brown. The furthest any single face moved was 42 of a
 * possible 441, on a building. A low cap would be a different and far more
 * destructive operation, and it is not what this is for.
 */
export function quantise(colours, most = 250) {
  const counts = new Map();
  for (const colour of colours) counts.set(colour, (counts.get(colour) ?? 0) + 1);
  if (counts.size <= most) return colours;

  const ranked = [...counts.keys()].sort((a, b) => counts.get(b) - counts.get(a));
  const kept = ranked.slice(0, most).map((c) => [c, rgb(c)]);

  const moved = new Map();
  for (const colour of ranked.slice(most)) {
    const [r, g, b] = rgb(colour);
    let best = kept[0][0];
    let closest = Infinity;
    for (const [candidate, [cr, cg, cb]] of kept) {
      // Squared distance, which orders the same as distance and avoids a root
      // per comparison across what can be thousands of them.
      const d = (r - cr) ** 2 + (g - cg) ** 2 + (b - cb) ** 2;
      if (d < closest) { closest = d; best = candidate; }
    }
    moved.set(colour, best);
  }

  return colours.map((colour) => moved.get(colour) ?? colour);
}

function rgb(hexColour) {
  let h = String(hexColour).slice(1);
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) || 0);
}
