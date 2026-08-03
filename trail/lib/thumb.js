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

  // The isometric footprint of the whole grid, fitted to the tile.
  const isoW = nx + nz;
  const isoH = (nx + nz) / 2 + ny;
  const scale = Math.min((size - pad * 2) / isoW, (size - pad * 2) / isoH);
  if (!(scale > 0)) return pixels;
  const cell = Math.max(1, Math.round(scale));

  const shiftX = (size - isoW * scale) / 2 + nz * scale;
  const shiftY = (size - isoH * scale) / 2 + ny * scale;

  // Painter's order, back to front.
  const order = [];
  for (let k = 0; k < nz; k++) {
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        if (grid.cells[at(i, j, k)]) order.push([i, j, k]);
      }
    }
  }
  order.sort((a, b) => (a[0] + a[1] + a[2]) - (b[0] + b[1] + b[2]));

  for (const [i, j, k] of order) {
    const [r, g, b] = colourOf(grid.palette[grid.cells[at(i, j, k)] - 1]);
    const lit = j + 1 >= ny || !grid.cells[at(i, j + 1, k)] ? 1 : 0.66;

    const sx = Math.round(shiftX + (i - k) * scale);
    const sy = Math.round(shiftY - (i + k) * scale * 0.5 - j * scale);

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
