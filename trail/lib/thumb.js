// A small picture of a model.
//
// Pure module: takes a voxel grid, returns pixels. No canvas, no DOM, so the
// same code draws contact sheets in Node and thumbnails in the panel, and both
// can be tested without a browser.
//
// Isometric and painter's order. Voxels nearer the camera have a larger
// x + y + z, so drawing in ascending order lets nearer ones cover the rest. A
// voxel with nothing above it is lit more brightly, which is enough shading to
// tell a barrel from a crate at sixty pixels.

const parseHex = (hex) => {
  let h = (hex ?? '#bbbbbb').slice(1);
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
};

const colourOf = (entry) => {
  if (!entry) return [187, 187, 187];
  // A tint slot shows the model's own colour, since a preview has no placement.
  return parseHex(entry.slot ? entry.hex ?? '#c8c8c8' : entry.hex);
};

/**
 * Draw a grid into a square of RGBA pixels, transparent where nothing is.
 *
 * `pad` leaves room so a model never touches the edge of its tile.
 */
export function thumbnail(grid, size = 64, { pad = 4 } = {}) {
  const pixels = new Uint8ClampedArray(size * size * 4);
  if (!grid || !grid.cells) return pixels;

  const [nx, ny, nz] = grid.dims;
  const at = (i, j, k) => (k * ny + j) * nx + i;

  // Painter's order, back to front.
  const order = [];
  for (let k = 0; k < nz; k++) {
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        if (grid.cells[at(i, j, k)]) order.push([i, j, k]);
      }
    }
  }
  if (!order.length) return pixels;
  order.sort((a, b) => (a[0] + a[1] + a[2]) - (b[0] + b[1] + b[2]));

  // Where each voxel lands, before any scaling. The vertical axis carries both
  // the depth of the isometric floor and the height of the model, which is why
  // it cannot be derived from the grid's dimensions on their own.
  //
  // **The two terms pull opposite ways, and this is the whole of the viewpoint.**
  // Going further into the picture moves a voxel *down* the screen and going
  // up moves it *up*, which is what looking down at something means. Adding
  // them instead - which is what this did originally - puts the near corner of
  // the ground at the top of the tile and shows the underside of everything.
  const across = (i, k) => i - k;
  const down = (i, j, k) => (i + k) / 2 - j;

  // Fitted to what is actually drawn, not to the box the grid occupies. A cow
  // fills nothing like its own bounding box - the corners of that box are
  // empty air - so fitting the box leaves a picture that is off-centre and
  // small. This is two passes over a few thousand voxels for a 96 pixel tile.
  let minU = Infinity; let maxU = -Infinity;
  let minV = Infinity; let maxV = -Infinity;
  for (const [i, j, k] of order) {
    const u = across(i, k);
    const v = down(i, j, k);
    if (u < minU) minU = u;
    if (u > maxU) maxU = u;
    if (v < minV) minV = v;
    if (v > maxV) maxV = v;
  }

  // A voxel is drawn as a square, so it takes up room past its own corner:
  // the span plus one cell has to fit, not the span alone.
  const room = size - pad * 2;
  const scale = Math.min(room / (maxU - minU + 1), room / (maxV - minV + 1));
  if (!(scale > 0)) return pixels;
  // Ceiling, not rounding. A cell narrower than the spacing leaves gaps between
  // neighbouring voxels and the model comes out looking like a sieve.
  const cell = Math.max(1, Math.ceil(scale));

  // Centre on the drawn extent, including that trailing cell.
  const shiftX = (size - ((maxU - minU) * scale + cell)) / 2 - minU * scale;
  const shiftY = (size - ((maxV - minV) * scale + cell)) / 2 - minV * scale;

  for (const [i, j, k] of order) {
    const [r, g, b] = colourOf(grid.palette[grid.cells[at(i, j, k)] - 1]);
    const lit = j + 1 >= ny || !grid.cells[at(i, j + 1, k)] ? 1 : 0.66;

    const sx = Math.round(shiftX + across(i, k) * scale);
    const sy = Math.round(shiftY + down(i, j, k) * scale);

    for (let py = 0; py < cell; py++) {
      const y = sy + py;
      if (y < 0 || y >= size) continue;
      for (let px = 0; px < cell; px++) {
        const x = sx + px;
        if (x < 0 || x >= size) continue;
        const p = (y * size + x) * 4;
        pixels[p] = r * lit;
        pixels[p + 1] = g * lit;
        pixels[p + 2] = b * lit;
        pixels[p + 3] = 255;
      }
    }
  }
  return pixels;
}

/** How much of a thumbnail was actually drawn on, for tests and for sanity. */
export function coverage(pixels) {
  let drawn = 0;
  for (let i = 3; i < pixels.length; i += 4) if (pixels[i]) drawn++;
  return drawn / (pixels.length / 4);
}

/**
 * A small picture of a model that was never cubes.
 *
 * The same isometric view and the same tile rules as `thumbnail`, drawn from
 * triangles instead of voxels: project each corner, fill the triangle, keep the
 * nearest fragment. A depth buffer rather than painter's order, because
 * triangles from an artist's mesh overlap in ways a lattice of cubes never
 * does and no sort order is correct for all of them.
 *
 * Takes what `fromTriangles` returns, so a preview is drawn from exactly the
 * geometry the renderer will draw, rather than from an approximation of it.
 */
export function preview(mesh, size = 64, { pad = 4 } = {}) {
  const pixels = new Uint8ClampedArray(size * size * 4);
  if (!mesh?.positions || !mesh.count) return pixels;

  const { positions, normals, values, count } = mesh;
  // The same projection the voxel tile uses: depth pushes down the picture and
  // height lifts it, which is what looking down at something means.
  const across = (x, z) => x - z;
  const down = (x, y, z) => (x + z) / 2 - y;

  let minU = Infinity; let maxU = -Infinity;
  let minV = Infinity; let maxV = -Infinity;
  for (let v = 0; v < count; v++) {
    const x = positions[v * 3]; const y = positions[v * 3 + 1]; const z = positions[v * 3 + 2];
    const u = across(x, z); const w = down(x, y, z);
    if (u < minU) minU = u;
    if (u > maxU) maxU = u;
    if (w < minV) minV = w;
    if (w > maxV) maxV = w;
  }
  const room = size - pad * 2;
  const spanU = maxU - minU;
  const spanV = maxV - minV;
  const scale = Math.min(spanU > 0 ? room / spanU : Infinity, spanV > 0 ? room / spanV : Infinity);
  if (!(scale > 0) || !Number.isFinite(scale)) return pixels;
  const shiftX = (size - spanU * scale) / 2 - minU * scale;
  const shiftY = (size - spanV * scale) / 2 - minV * scale;

  const depth = new Float32Array(size * size).fill(-Infinity);
  // Light from above and slightly toward the viewer, wrapped rather than cut,
  // which is the same treatment the renderer gives the world.
  const LIGHT = [0.33, 0.82, 0.46];

  const sx = new Float32Array(3);
  const sy = new Float32Array(3);
  const sd = new Float32Array(3);

  for (let f = 0; f * 3 < count; f++) {
    for (let k = 0; k < 3; k++) {
      const v = f * 3 + k;
      const x = positions[v * 3]; const y = positions[v * 3 + 1]; const z = positions[v * 3 + 2];
      sx[k] = shiftX + across(x, z) * scale;
      sy[k] = shiftY + down(x, y, z) * scale;
      // Toward the camera, which sits off the far corner and above.
      sd[k] = x + y + z;
    }

    const area = (sx[1] - sx[0]) * (sy[2] - sy[0]) - (sx[2] - sx[0]) * (sy[1] - sy[0]);
    if (area === 0) continue;

    const n0 = f * 3 * 3;
    const lit = Math.max(0, normals[n0] * LIGHT[0] + normals[n0 + 1] * LIGHT[1] + normals[n0 + 2] * LIGHT[2]);
    const shade = 0.55 + 0.45 * lit;
    const [r, g, b] = colourOf(mesh.palette?.[values[f * 3] - 1]);

    const x0 = Math.max(0, Math.floor(Math.min(sx[0], sx[1], sx[2])));
    const x1 = Math.min(size - 1, Math.ceil(Math.max(sx[0], sx[1], sx[2])));
    const y0 = Math.max(0, Math.floor(Math.min(sy[0], sy[1], sy[2])));
    const y1 = Math.min(size - 1, Math.ceil(Math.max(sy[0], sy[1], sy[2])));

    for (let py = y0; py <= y1; py++) {
      for (let px = x0; px <= x1; px++) {
        const cx = px + 0.5; const cy = py + 0.5;
        // Barycentric, so a pixel belongs to the triangle that covers it.
        const w0 = ((sx[1] - cx) * (sy[2] - cy) - (sx[2] - cx) * (sy[1] - cy)) / area;
        const w1 = ((sx[2] - cx) * (sy[0] - cy) - (sx[0] - cx) * (sy[2] - cy)) / area;
        const w2 = 1 - w0 - w1;
        if (w0 < 0 || w1 < 0 || w2 < 0) continue;

        const here = w0 * sd[0] + w1 * sd[1] + w2 * sd[2];
        const slot = py * size + px;
        if (here <= depth[slot]) continue;
        depth[slot] = here;
        const p = slot * 4;
        pixels[p] = r * shade;
        pixels[p + 1] = g * shade;
        pixels[p + 2] = b * shade;
        pixels[p + 3] = 255;
      }
    }
  }
  return pixels;
}
