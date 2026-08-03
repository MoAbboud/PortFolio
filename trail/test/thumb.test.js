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

test('nothing is ever drawn outside the tile', () => {
  // A very tall model and a very wide one both have to be fitted, not clipped.
  for (const dims of [[1, 40, 1], [40, 1, 40], [3, 3, 3]]) {
    const pixels = thumbnail(block(dims), 48);
    assert.equal(pixels.length, 48 * 48 * 4);
    assert.ok(coverage(pixels) > 0, `${dims.join('x')} drew nothing`);
  }
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
