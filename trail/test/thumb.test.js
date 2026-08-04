import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { thumbnail, coverage } from '../lib/thumb.js';
import { voxelise, hollow } from '../lib/voxel.js';

const model = (name) => JSON.parse(
  readFileSync(fileURLToPath(new URL(`../models/${name}.json`, import.meta.url)), 'utf8')
);

const block = (size = [4, 4, 4], colour = '#ff0000') => voxelise({
  id: 'block', unit: 1, anchor: 'base',
  parts: [{ solid: 'box', at: [0, size[1] / 2, 0], size, color: colour }],
});

const pixelAt = (pixels, size, x, y) => {
  const p = (y * size + x) * 4;
  return [pixels[p], pixels[p + 1], pixels[p + 2], pixels[p + 3]];
};

test('a thumbnail is a square of RGBA pixels of the size asked for', () => {
  for (const size of [32, 64, 96]) {
    assert.equal(thumbnail(block(), size).length, size * size * 4);
  }
});

test('a model actually appears, and does not fill the whole tile', () => {
  const shown = coverage(thumbnail(block(), 64));
  assert.ok(shown > 0.1, `almost nothing was drawn: ${(shown * 100).toFixed(1)}%`);
  assert.ok(shown < 0.85, `the model overflowed its tile: ${(shown * 100).toFixed(1)}%`);
});

test('everywhere the model is not stays transparent', () => {
  const size = 64;
  const pixels = thumbnail(block([2, 2, 2]), size);
  // The corners of an isometric tile are always outside the shape.
  for (const [x, y] of [[0, 0], [size - 1, 0], [0, size - 1], [size - 1, size - 1]]) {
    assert.equal(pixelAt(pixels, size, x, y)[3], 0, `pixel ${x},${y} should be clear`);
  }
});

/** The box the drawn pixels actually occupy, and the gap to each edge. */
const bounds = (pixels, size) => {
  let x0 = Infinity; let y0 = Infinity; let x1 = -1; let y1 = -1;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (pixels[(y * size + x) * 4 + 3]) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  return { top: y0, bottom: size - 1 - y1, left: x0, right: size - 1 - x1 };
};

test('nothing is ever drawn outside the tile', () => {
  // A very tall model and a very wide one both have to be fitted, not clipped.
  // This used to check only that something was drawn, which is why every
  // preview in the library was running off the top of its tile unnoticed.
  for (const dims of [[1, 40, 1], [40, 1, 40], [3, 3, 3], [40, 40, 2]]) {
    const size = 48;
    const pixels = thumbnail(block(dims), size);
    assert.equal(pixels.length, size * size * 4);
    assert.ok(coverage(pixels) > 0, `${dims.join('x')} drew nothing`);

    const { top, bottom, left, right } = bounds(pixels, size);
    for (const [edge, gap] of Object.entries({ top, bottom, left, right })) {
      assert.ok(gap >= 1,
        `${dims.join('x')} touches the ${edge} of its tile, so it is clipped`);
    }
  }
});

test('a preview looks down at a model rather than up at its underside', () => {
  // A slab with a red top layer over a blue bottom one. Seen from above the
  // red face is most of the picture; seen from below it is the blue one. This
  // is the whole difference between the two signs in the projection, and the
  // module got it wrong from the day it was written: it *lit* the top while
  // *showing* the bottom, so no shading test noticed.
  const [nx, ny, nz] = [8, 2, 8];
  const cells = new Uint8Array(nx * ny * nz);
  for (let k = 0; k < nz; k++) {
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) cells[(k * ny + j) * nx + i] = j === ny - 1 ? 1 : 2;
    }
  }
  const grid = { dims: [nx, ny, nz], cells, palette: [{ hex: '#ff0000' }, { hex: '#0000ff' }] };

  const pixels = thumbnail(grid, 96);
  let top = 0;
  let underneath = 0;
  for (let p = 0; p < pixels.length; p += 4) {
    if (!pixels[p + 3]) continue;
    if (pixels[p] > pixels[p + 2]) top++;
    else underneath++;
  }
  assert.ok(top > underneath * 2,
    `the underside is ${underneath} pixels against ${top} on top, so the view is from below`);
});

test('a nearer voxel covers the one behind it', () => {
  // Painter's order and the projection have to agree. If the depth term is
  // flipped they disagree, and a far voxel paints over a near one.
  const [nx, ny, nz] = [3, 1, 3];
  const cells = new Uint8Array(nx * ny * nz);
  for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) cells[(k * ny + 0) * nx + i] = 1;
  // The near corner of the ground is the one with the largest i and k.
  cells[((nz - 1) * ny + 0) * nx + (nx - 1)] = 2;
  const grid = { dims: [nx, ny, nz], cells, palette: [{ hex: '#101010' }, { hex: '#f0f0f0' }] };

  const size = 64;
  const pixels = thumbnail(grid, size);
  // The near corner sits at the bottom of the diamond, so the lowest drawn row
  // must belong to it.
  let lowest = -1;
  let lowestIsNear = false;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const p = (y * size + x) * 4;
      if (!pixels[p + 3]) continue;
      if (y > lowest) { lowest = y; lowestIsNear = pixels[p] > 128; }
    }
  }
  assert.ok(lowestIsNear,
    'the bottom of the picture is not the near corner, so depth runs the wrong way');
});

test('a preview sits in the middle of its tile', () => {
  // The model is centred on what is drawn, not on the box the grid occupies,
  // because a shape rarely reaches the corners of its own bounding box.
  for (const dims of [[1, 40, 1], [40, 1, 40], [3, 3, 3], [6, 20, 4], [30, 4, 8]]) {
    const size = 64;
    const { top, bottom, left, right } = bounds(thumbnail(block(dims), size), size);
    // One pixel of slack, because a voxel lands on a whole pixel or it blurs.
    assert.ok(Math.abs(top - bottom) <= 1,
      `${dims.join('x')} sits ${top} from the top and ${bottom} from the bottom`);
    assert.ok(Math.abs(left - right) <= 1,
      `${dims.join('x')} sits ${left} from the left and ${right} from the right`);
  }
});

test('a preview uses the tile it is given rather than a corner of it', () => {
  // Fitting to the grid's box rather than to the model left a building using a
  // third of its tile and a street tile using a sixth.
  const shown = coverage(thumbnail(block([8, 8, 8]), 64));
  assert.ok(shown > 0.35, `a solid cube filled only ${(shown * 100).toFixed(1)}% of its tile`);
});

test('neighbouring voxels leave no gaps between them', () => {
  // A cell narrower than the spacing draws a solid shape as a sieve. The face
  // of a large block should be continuous, not stippled.
  const size = 64;
  const pixels = thumbnail(block([12, 12, 12]), size);
  const { top, left } = bounds(pixels, size);
  // Walk a horizontal line across the middle of the shape and count runs of
  // transparent pixels inside it.
  const y = Math.round(top + (size - top * 2) / 2);
  let holes = 0;
  let inside = false;
  for (let x = left; x < size - left; x++) {
    const solid = pixels[(y * size + x) * 4 + 3] > 0;
    if (solid) inside = true;
    else if (inside && x < size - left - 1) holes++;
  }
  assert.ok(holes <= 2, `a solid block has ${holes} gaps across its middle`);
});

test('a model keeps its own colours', () => {
  const pixels = thumbnail(block([4, 4, 4], '#20c040'), 64);
  let found = false;
  for (let i = 0; i < pixels.length; i += 4) {
    if (!pixels[i + 3]) continue;
    // Lit faces are the colour itself; shaded ones are the same hue, darker.
    if (pixels[i] < pixels[i + 1] && pixels[i + 2] < pixels[i + 1]) found = true;
  }
  assert.ok(found, 'a green model produced no green pixels');
});

test('a tint slot shows the model\'s own colour rather than nothing', () => {
  // A preview has no placement, so it cannot know a character's colours.
  const grid = voxelise({
    id: 'tinted', unit: 1, anchor: 'base',
    tints: { primary: '#3f6fb5' },
    parts: [{ solid: 'box', at: [0, 1, 0], size: [2, 2, 2], color: '#primary' }],
  });
  const pixels = thumbnail(grid, 48);
  let blue = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i + 3] && pixels[i + 2] > pixels[i]) blue++;
  }
  assert.ok(blue > 0, 'a tinted model previewed with no colour at all');
});

test('the top of a shape is brighter than its side', () => {
  // The only shading there is, and without it a cube reads as a flat hexagon.
  const pixels = thumbnail(block([6, 6, 6], '#808080'), 64);
  const shades = new Set();
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i + 3]) shades.add(pixels[i]);
  }
  assert.ok(shades.size >= 2, 'every face came out the same brightness');
});

test('an empty or broken grid gives an empty tile rather than throwing', () => {
  assert.equal(coverage(thumbnail(null, 32)), 0);
  assert.equal(coverage(thumbnail({}, 32)), 0);
  assert.equal(coverage(thumbnail({ dims: [2, 2, 2], cells: new Uint8Array(8), palette: [] }, 32)), 0);
});

test('the same model always draws the same thumbnail', () => {
  const grid = hollow(voxelise(model('person')));
  assert.deepEqual([...thumbnail(grid, 64)], [...thumbnail(grid, 64)]);
});

test('every model in the library previews to something visible', () => {
  for (const name of ['person', 'house', 'car', 'tree']) {
    const shown = coverage(thumbnail(hollow(voxelise(model(name))), 64));
    assert.ok(shown > 0.05, `${name} previewed to almost nothing: ${(shown * 100).toFixed(1)}%`);
  }
});

test('a thumbnail is cheap enough to draw a panel full of them', () => {
  const grid = hollow(voxelise(model('house')));
  const started = process.hrtime.bigint();
  for (let i = 0; i < 60; i++) thumbnail(grid, 64);
  const ms = Number(process.hrtime.bigint() - started) / 1e6;
  assert.ok(ms < 1200, `sixty thumbnails took ${ms.toFixed(0)}ms`);
});
